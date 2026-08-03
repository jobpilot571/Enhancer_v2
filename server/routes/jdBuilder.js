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
import { parseResume, analyzeJd, suggestCompaniesFromJd } from '../services/openaiService.js'
import { mapJdBasicsFromResume, sanitizeBasics } from '../services/jdBasicsExtract.js'
import {
  saveJdResume,
  listJdResumes,
  readJdResumeDocx,
  readJdResumeJdText,
  deleteJdResume,
} from '../store/jdSavedResumeStore.js'
import { AI_SERVICES, finalizeAiServiceCost, runWithAiCostContext } from '../services/aiCostTracking.js'
import { applyJdResumeRevision } from '../services/jdRevisionService.js'
import { handleJdWizardChat } from '../services/jdChatService.js'

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

const uploadDocx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = detectFileType(file.originalname, file.mimetype) === 'docx'
      || file.mimetype === DOCX_MIME
    cb(ok ? null : new Error('Only .docx files are allowed'), ok)
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
    const ranges = [
      [12, 14], [11, 13], [10, 12], [9, 11], [7, 9], [7, 12],
    ]
    const [minB, maxB] = ranges[i] || [3, 15]
    if (!Number.isFinite(bullets) || bullets < minB || bullets > maxB) {
      return `Company ${i + 1}: points/bullets must be between ${minB} and ${maxB}`
    }
  }

  return null
}

function extractYearsRequiredFromText(text) {
  const raw = String(text || '')
  const patterns = [
    /(\d+)\s*\+\s*years?\s+(?:of\s+)?(?:relevant\s+)?experience/i,
    /(\d+)\s*-\s*\d+\s*years?\s+(?:of\s+)?(?:relevant\s+)?experience/i,
    /minimum\s+(?:of\s+)?(\d+)\s*years?/i,
    /at\s+least\s+(\d+)\s*years?/i,
    /(\d+)\s*years?\s+(?:of\s+)?(?:relevant\s+)?experience\s+required/i,
    /requires?\s+(\d+)\s*\+?\s*years?/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n >= 0 && n <= 50) return n
    }
  }
  return null
}

async function analyzeJdPayload(jdText, { userId = null } = {}) {
  const cleaned = String(jdText || '').trim()
  if (cleaned.length < 40) {
    const err = new Error('Paste a fuller job description (at least a few sentences).')
    err.status = 400
    throw err
  }

  const yearsFromText = extractYearsRequiredFromText(cleaned)
  let roleTitle = ''
  let yearsRequired = yearsFromText
  let method = 'local'

  try {
    await runWithAiCostContext({
      userId,
      serviceName: AI_SERVICES.JD_BUILDER,
    }, async () => {
      try {
        const { data } = await analyzeJd(cleaned)
        roleTitle = String(data?.roleTitle || '').trim()
        const aiYears = Number(data?.yearsRequired)
        if (yearsFromText == null && Number.isFinite(aiYears) && aiYears >= 0) {
          yearsRequired = aiYears
        }
        method = 'AI'
        finalizeAiServiceCost({ status: 'completed' })
      } catch (err) {
        finalizeAiServiceCost({ status: 'failed' })
        throw err
      }
    })
  } catch (err) {
    console.warn('[jd-builder] analyze-jd AI failed:', err.message)
    const titleMatch = cleaned.match(/(?:job\s*title|position|role)\s*[:\-–]\s*([^\n]{3,80})/i)
    roleTitle = (titleMatch?.[1] || '').trim()
    method = 'local'
  }

  return {
    ok: true,
    method,
    roleTitle,
    yearsRequired: yearsRequired == null ? '' : yearsRequired,
    jdText: cleaned.slice(0, 50000),
  }
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
            resumeData = await runWithAiCostContext({
              userId: req.user?.id || null,
              serviceName: AI_SERVICES.JD_BUILDER,
            }, async () => {
              try {
                const parsed = await parseResume(resumeText)
                finalizeAiServiceCost({ status: 'completed' })
                return parsed
              } catch (err) {
                finalizeAiServiceCost({ status: 'failed' })
                throw err
              }
            })
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

/** Analyze pasted JD → target role + required years. */
router.post('/analyze-jd', optionalUser, async (req, res, next) => {
  try {
    const result = await analyzeJdPayload(req.body?.jdText || '', { userId: req.user?.id || null })
    const userTag = req.user?.id || 'guest'
    console.log(
      `[jd-builder] analyze-jd user=${userTag} method=${result.method} `
      + `role=${Boolean(result.roleTitle)} years=${result.yearsRequired || '-'}`,
    )
    res.json(result)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** Upload JD file (PDF/DOCX) → extract text then analyze. */
router.post('/analyze-jd-file', optionalUser, upload.single('jd'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const fileType = detectFileType(req.file.originalname, req.file.mimetype)
    if (!fileType) return res.status(400).json({ error: 'Only .docx and .pdf files are allowed' })

    const jdText = await extractResumeText(req.file.buffer, fileType)
    if (!String(jdText || '').trim()) {
      return res.status(400).json({ error: 'Could not read text from that document.' })
    }

    const result = await analyzeJdPayload(jdText, { userId: req.user?.id || null })
    const userTag = req.user?.id || 'guest'
    console.log(
      `[jd-builder] analyze-jd-file user=${userTag} file=${req.file.originalname} `
      + `method=${result.method} role=${Boolean(result.roleTitle)} years=${result.yearsRequired || '-'}`,
    )
    res.json({
      ...result,
      fileName: req.file.originalname,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/**
 * AI / Auto mode: suggest companies from JD (USA/India split, present→past dates).
 */
router.post('/suggest-companies', optionalUser, async (req, res, next) => {
  try {
    const {
      jdText,
      roleTitle,
      yearsOfExperience,
      companyCount,
      usaCount,
      indiaCount,
    } = req.body || {}

    if (!String(jdText || '').trim() || String(jdText).trim().length < 80) {
      return res.status(400).json({ error: 'Paste a fuller job description first (JD step).' })
    }

    const total = Number(companyCount)
    const usa = Number(usaCount)
    const india = Number(indiaCount)
    if (!Number.isFinite(total) || total < 1 || total > 6) {
      return res.status(400).json({ error: 'companyCount must be between 1 and 6' })
    }
    if (!Number.isFinite(usa) || !Number.isFinite(india) || usa < 0 || india < 0) {
      return res.status(400).json({ error: 'usaCount and indiaCount must be non-negative numbers' })
    }
    if (usa + india !== total) {
      return res.status(400).json({ error: 'usaCount + indiaCount must equal companyCount' })
    }

    const result = await runWithAiCostContext({
      userId: req.user?.id || null,
      serviceName: AI_SERVICES.JD_BUILDER,
    }, async () => {
      try {
        const suggested = await suggestCompaniesFromJd({
          jdText,
          roleTitle,
          yearsOfExperience,
          companyCount: total,
          usaCount: usa,
          indiaCount: india,
        })
        finalizeAiServiceCost({ status: 'completed' })
        return suggested
      } catch (err) {
        finalizeAiServiceCost({ status: 'failed' })
        throw err
      }
    })

    const userTag = req.user?.id || 'guest'
    console.log(
      `[jd-builder] suggest-companies user=${userTag} total=${total} usa=${usa} india=${india} `
      + `industry=${result.industry || '-'}`,
    )

    res.json({ ok: true, ...result })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
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
      runJdBuildJob(job.jobId, session.sessionId, { userId: req.user.id }).catch((err) => {
        console.error(`[jd-builder] unhandled job error jobId=${job.jobId}:`, err.message)
      })
    })

    res.json({ jobId: job.jobId, sessionId: session.sessionId, status: 'processing', usage })
  } catch (err) {
    next(err)
  }
})

router.post('/revise', requireUser, async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim()
    const message = String(req.body?.message || '').trim()
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })
    if (!message) {
      return res.status(400).json({
        error: 'Describe what to change (companies, bullets, skills, summary, etc.).',
      })
    }

    const result = await runWithAiCostContext({
      userId: req.user.id,
      sessionId,
      serviceName: AI_SERVICES.JD_REVISION,
    }, async () => {
      try {
        const fixResult = await applyJdResumeRevision(sessionId, message)
        finalizeAiServiceCost({ status: 'completed' })
        return fixResult
      } catch (err) {
        finalizeAiServiceCost({ status: 'failed' })
        throw err
      }
    })

    res.json({
      ok: result.ok,
      reply: result.reply,
      previewUpdated: result.previewUpdated !== false,
      downloadUrl: result.downloadUrl,
      previewUrl: result.previewUrl,
      roleTitle: result.roleTitle || '',
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/** Wizard-wide assistant chat (any step): edit draft fields and/or revise built DOCX. */
router.post('/chat', requireUser, async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim()
    const sessionId = String(req.body?.sessionId || '').trim() || null
    const stepId = String(req.body?.stepId || '').trim()
    const project = req.body?.project && typeof req.body.project === 'object' ? req.body.project : null
    const thread = Array.isArray(req.body?.thread) ? req.body.thread : []
    if (!message) {
      return res.status(400).json({ error: 'Type a message for the assistant.' })
    }

    const result = await runWithAiCostContext({
      userId: req.user.id,
      sessionId: sessionId || undefined,
      serviceName: AI_SERVICES.JD_CHAT,
    }, async () => {
      try {
        const chatResult = await handleJdWizardChat({
          message,
          project,
          stepId,
          sessionId,
          thread,
        })
        finalizeAiServiceCost({ status: 'completed' })
        return chatResult
      } catch (err) {
        finalizeAiServiceCost({ status: 'failed' })
        throw err
      }
    })

    res.json(result)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
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

/**
 * Save a completed JD-tailored resume into the user's Saved Resumes library.
 */
router.post('/saved', requireUser, uploadDocx.single('file'), (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Attach the resume DOCX as file' })
    }
    const {
      role,
      yearsOfExperience,
      yearsRequired,
      jdText,
      templateId,
      fileName,
    } = req.body || {}

    const saved = saveJdResume(req.user.id, {
      role,
      yearsOfExperience,
      yearsRequired,
      jdText,
      templateId,
      fileName: fileName || req.file.originalname,
      docxBuffer: req.file.buffer,
    })

    console.log(`[jd-builder] saved-resume user=${req.user.id} id=${saved.id} role=${saved.role || '-'}`)
    res.json({ ok: true, saved })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.get('/saved', requireUser, (req, res, next) => {
  try {
    const items = listJdResumes(req.user.id)
    res.json({ ok: true, items })
  } catch (err) {
    next(err)
  }
})

router.get('/saved/:id/file', requireUser, (req, res, next) => {
  try {
    const found = readJdResumeDocx(req.user.id, req.params.id)
    if (!found) return res.status(404).json({ error: 'Saved resume not found' })
    res.setHeader('Content-Type', DOCX_MIME)
    res.setHeader('Content-Disposition', `inline; filename="${found.row.fileName}"`)
    res.send(found.buffer)
  } catch (err) {
    next(err)
  }
})

router.get('/saved/:id/download', requireUser, (req, res, next) => {
  try {
    const found = readJdResumeDocx(req.user.id, req.params.id)
    if (!found) return res.status(404).json({ error: 'Saved resume not found' })
    res.setHeader('Content-Type', DOCX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="${found.row.fileName}"`)
    res.send(found.buffer)
  } catch (err) {
    next(err)
  }
})

router.get('/saved/:id/jd', requireUser, (req, res, next) => {
  try {
    const found = readJdResumeJdText(req.user.id, req.params.id)
    if (!found) return res.status(404).json({ error: 'Saved resume not found' })
    const roleSlug = String(found.row.role || 'job').replace(/[^\w\-]+/g, '-').slice(0, 40)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${roleSlug || 'job'}-jd.txt"`)
    res.send(found.text || '')
  } catch (err) {
    next(err)
  }
})

router.delete('/saved/:id', requireUser, (req, res, next) => {
  try {
    const ok = deleteJdResume(req.user.id, req.params.id)
    if (!ok) return res.status(404).json({ error: 'Saved resume not found' })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
