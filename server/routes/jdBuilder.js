import { Router } from 'express'
import fs from 'fs'
import multer from 'multer'
import {
  createJdBuilderSession,
  detectFileType,
  getSession,
  updateSession,
  readFile,
} from '../store/sessionStore.js'
import { createBuildJob, getBuildJob } from '../store/buildJobStore.js'
import { runJdBuildJob } from '../services/jdBuildWorker.js'
import { requireUser, checkUsage, consumeUsage, optionalUser } from '../middleware/userAuth.js'
import { extractResumeText } from '../services/resumeExtract.js'
import { parseResumeLocally } from '../services/localResumeParse.js'
import { parseResume } from '../services/openaiService.js'
import { mapJdBasicsFromResume, sanitizeBasics } from '../services/jdBasicsExtract.js'

const router = Router()

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const type = detectFileType(file.originalname, file.mimetype)
    cb(type ? null : new Error('Only .docx and .pdf files are allowed'), !!type)
  },
})

function validateFormData(formData) {
  if (!formData || typeof formData !== 'object') {
    return 'formData is required'
  }
  if (!String(formData.name || '').trim()) return 'Name is required'
  if (!String(formData.email || '').trim()) return 'Email is required'
  if (!String(formData.phone || '').trim()) return 'Phone number is required'
  if (!String(formData.city || '').trim()) return 'City is required'
  if (!String(formData.state || '').trim()) return 'State is required'
  if (!String(formData.role || '').trim()) return 'Role is required'
  if (!String(formData.templateId || '').trim()) return 'Template is required'
  if (!String(formData.jdText || '').trim()) return 'Job description is required'
  if (String(formData.jdText || '').trim().length < 80) {
    return 'Paste a fuller job description (at least a few sentences)'
  }

  const years = Number(formData.yearsOfExperience)
  // Years may be computed from company dates; allow 0+
  if (!Number.isFinite(years) || years < 0) {
    // soft: derive later from companies — only reject negative non-numeric
    if (formData.yearsOfExperience !== undefined && formData.yearsOfExperience !== '' && !Number.isFinite(years)) {
      return 'Years of experience is invalid'
    }
  }

  const companyCount = Number(formData.companyCount)
  if (!Number.isFinite(companyCount) || companyCount < 1 || companyCount > 6) {
    return 'Number of companies must be between 1 and 6'
  }

  const companies = formData.companies
  if (!Array.isArray(companies) || companies.length !== companyCount) {
    return `Expected ${companyCount} compan${companyCount === 1 ? 'y' : 'ies'}`
  }

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i] || {}
    if (!String(c.name || '').trim()) return `Company ${i + 1}: name is required`
    if (!String(c.role || '').trim()) return `Company ${i + 1}: role is required`
    if (!String(c.startDate || '').trim()) return `Company ${i + 1}: start date is required`
    if (!String(c.city || '').trim()) return `Company ${i + 1}: city is required`
    if (!String(c.state || '').trim()) return `Company ${i + 1}: state is required`
    const bullets = Number(c.bulletCount)
    if (!Number.isFinite(bullets) || bullets < 3 || bullets > 15) {
      return `Company ${i + 1}: points/bullets must be between 3 and 15`
    }
  }

  return null
}

/**
 * Extract contact + education only from an uploaded resume (DOCX/PDF).
 * Text-first: always parse plain text for Basics; AI only fills missing contact gaps.
 * Does not consume usage. Works signed-out or signed-in.
 */
router.post('/extract-basics', optionalUser, upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const fileType = detectFileType(req.file.originalname, req.file.mimetype)
    if (!fileType) return res.status(400).json({ error: 'Only .docx and .pdf files are allowed' })

    const resumeText = await extractResumeText(req.file.buffer, fileType)
    if (!String(resumeText || '').trim()) {
      return res.status(400).json({ error: 'Could not read text from that document. Try a .docx resume.' })
    }

    // 1) Always extract from plain text first (accurate Basics only)
    let basics = mapJdBasicsFromResume({}, resumeText)
    let method = 'text'

    const contactWeak = !basics.fullName || (!basics.email && !basics.phone)
    const educationWeak = !basics.education?.length

    // 2) Optional AI only to fill gaps — never trust AI location/education blindly
    if (contactWeak || educationWeak) {
      try {
        const local = parseResumeLocally(resumeText)
        let resumeData = local.data
        if (local.confidence < 0.75 || contactWeak || educationWeak) {
          try {
            resumeData = await parseResume(resumeText)
            method = 'text+AI'
          } catch (err) {
            console.warn('[jd-builder] extract-basics AI fallback failed:', err.message)
            method = 'text+local'
            resumeData = local.data
          }
        } else {
          method = 'text+local'
        }

        const enriched = mapJdBasicsFromResume(resumeData, resumeText)
        // Fill only empty fields from enrichment (text wins when present)
        basics = sanitizeBasics({
          fullName: basics.fullName || enriched.fullName,
          email: basics.email || enriched.email,
          phone: basics.phone || enriched.phone,
          linkedin: basics.linkedin || enriched.linkedin,
          city: basics.city || enriched.city,
          state: basics.state || enriched.state,
          education: basics.education?.length ? basics.education : (enriched.education || []),
        })
      } catch (err) {
        console.warn('[jd-builder] extract-basics enrich failed:', err.message)
      }
    }

    const userTag = req.user?.id || 'guest'
    console.log(
      `[jd-builder] extract-basics user=${userTag} file=${req.file.originalname} `
      + `method=${method} name=${Boolean(basics.fullName)} email=${Boolean(basics.email)} `
      + `city=${basics.city || '-'} state=${basics.state || '-'} edu=${basics.education?.length || 0}`,
    )

    res.json({
      ok: true,
      method,
      fileName: req.file.originalname,
      basics,
    })
  } catch (err) {
    next(err)
  }
})

router.post('/build', requireUser, checkUsage('jdBuilder'), (req, res, next) => {
  try {
    const { sessionId, formData } = req.body || {}
    let session = sessionId ? getSession(sessionId) : null

    if (formData) {
      const error = validateFormData(formData)
      if (error) return res.status(400).json({ error })

      if (session && session.kind === 'jd-builder') {
        updateSession(session.sessionId, {
          builderInput: formData,
          jdText: formData.jdText,
          fileName: `${(formData.name || 'resume').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'resume'}-jd-tailored.docx`,
        })
      } else {
        session = createJdBuilderSession(formData)
      }
    }

    if (!session || session.kind !== 'jd-builder') {
      return res.status(404).json({ error: 'JD-builder session not found' })
    }

    const usage = consumeUsage(req.user.id, req.user.plan || 'free', 'jdBuilder')
    const job = createBuildJob(session.sessionId)
    console.log(`[jd-builder] job started jobId=${job.jobId} session=${session.sessionId} user=${req.user.id}`)

    setImmediate(() => {
      runJdBuildJob(job.jobId, session.sessionId).catch((err) => {
        console.error(`[jd-builder] unhandled job error jobId=${job.jobId}:`, err.message)
      })
    })

    res.json({ jobId: job.jobId, sessionId: session.sessionId, status: 'processing', usage })
  } catch (err) {
    next(err)
  }
})

router.get('/build-status/:jobId', (req, res, next) => {
  try {
    const job = getBuildJob(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    const payload = {
      jobId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      step: job.step,
    }

    if (job.status === 'failed') {
      payload.error = job.error
    }

    if (job.status === 'completed' && job.result) {
      payload.downloadUrl = job.result.downloadUrl
      payload.previewUrl = job.result.previewUrl
      payload.fileName = job.result.fileName
      payload.resumeData = job.result.resumeData
      payload.roleTitle = job.result.roleTitle
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
})

router.get('/file/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session || session.kind !== 'jd-builder') {
      return res.status(404).json({ error: 'JD-builder session not found' })
    }
    const filePath = session.enhancedPreviewPath || session.enhancedPath
    if (!filePath) return res.status(404).json({ error: 'Resume not ready' })

    const buffer = readFile(filePath)
    res.setHeader('Content-Type', DOCX_MIME)
    res.setHeader('Content-Disposition', `inline; filename="${session.fileName}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.get('/download/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session || session.kind !== 'jd-builder') {
      return res.status(404).json({ error: 'JD-builder session not found' })
    }
    if (!session.enhancedPath) return res.status(404).json({ error: 'Resume not ready' })

    const buffer = fs.readFileSync(session.enhancedPath)
    res.setHeader('Content-Type', DOCX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="${session.fileName}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

export default router
