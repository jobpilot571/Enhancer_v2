import { Router } from 'express'
import fs from 'fs'
import multer from 'multer'
import {
  createBuilderSession,
  detectFileType,
  getSession,
  updateSession,
  readFile,
} from '../store/sessionStore.js'
import { createBuildJob, getBuildJob } from '../store/buildJobStore.js'
import { runBuildJob } from '../services/buildWorker.js'
import { requireUser, checkUsage, consumeUsage, optionalUser } from '../middleware/userAuth.js'
import {
  getBuilderMemory,
  saveBuilderMemory,
  clearBuilderMemory,
} from '../store/userStore.js'
import { extractResumeText } from '../services/resumeExtract.js'
import { parseResumeLocally } from '../services/localResumeParse.js'
import { parseResume } from '../services/openaiService.js'
import { mapResumeToBuilderSuggestions } from '../services/builderReferenceMap.js'

const router = Router()

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const LOCAL_CONFIDENCE_THRESHOLD = 0.8

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
  if (!String(formData.role || '').trim()) return 'Role is required'
  if (!String(formData.templateId || '').trim()) return 'Template is required'

  const years = Number(formData.yearsOfExperience)
  if (!Number.isFinite(years) || years < 0) return 'Years of experience is required'

  const companyCount = Number(formData.companyCount)
  if (!Number.isFinite(companyCount) || companyCount < 1 || companyCount > 10) {
    return 'Number of companies must be between 1 and 10'
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
  }

  const bullets = Number(formData.bulletsPerCompany)
  if (!Number.isFinite(bullets) || bullets < 5 || bullets > 15) {
    return 'Bullets per company must be between 5 and 15'
  }

  const edu = formData.education || {}
  if (!String(edu.school || '').trim()) return 'University / college name is required'
  if (!String(edu.course || '').trim()) return 'Course is required'
  if (!String(edu.degree || '').trim()) return 'Degree is required'
  if (!String(edu.startDate || '').trim()) return 'Education start date is required'

  return null
}

/** Long-lived saved builder form for the signed-in user (account memory). */
router.get('/memory', requireUser, (req, res, next) => {
  try {
    const memory = getBuilderMemory(req.user.id)
    res.json({
      ok: true,
      hasMemory: Boolean(memory?.formData),
      updatedAt: memory?.updatedAt || null,
      formData: memory?.formData || null,
    })
  } catch (err) {
    next(err)
  }
})

router.put('/memory', requireUser, (req, res, next) => {
  try {
    const formData = req.body?.formData ?? req.body
    const memory = saveBuilderMemory(req.user.id, formData)
    console.log(`[builder] memory saved user=${req.user.id}`)
    res.json({ ok: true, updatedAt: memory.updatedAt, formData: memory.formData })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.delete('/memory', requireUser, (req, res, next) => {
  try {
    clearBuilderMemory(req.user.id)
    console.log(`[builder] memory cleared user=${req.user.id}`)
    res.json({ ok: true })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

/**
 * Upload a reference resume/doc. Extracts bullets + basics so the form
 * (and later AI generation) can produce a stronger DOCX. Does not consume
 * a builder usage credit. Works signed-out or signed-in.
 */
router.post('/reference-upload', optionalUser, upload.single('reference'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const fileType = detectFileType(req.file.originalname, req.file.mimetype)
    if (!fileType) return res.status(400).json({ error: 'Only .docx and .pdf files are allowed' })

    const resumeText = await extractResumeText(req.file.buffer, fileType)
    if (!String(resumeText || '').trim()) {
      return res.status(400).json({ error: 'Could not read text from that document. Try a .docx resume.' })
    }

    const local = parseResumeLocally(resumeText)
    let resumeData = local.data
    let method = 'local'
    if (local.confidence < LOCAL_CONFIDENCE_THRESHOLD) {
      resumeData = await parseResume(resumeText)
      method = 'AI fallback'
      if (!resumeData.skillCategories?.length && local.data.skillCategories?.length) {
        resumeData.skillCategories = local.data.skillCategories
      }
    }

    const suggestions = mapResumeToBuilderSuggestions(resumeData, {
      fileName: req.file.originalname,
    })

    const userTag = req.user?.id || 'guest'
    console.log(
      `[builder] reference-upload user=${userTag} file=${req.file.originalname} `
      + `method=${method} companies=${suggestions.stats.companies} bullets=${suggestions.stats.bullets}`,
    )

    res.json({
      ok: true,
      method,
      confidence: local.confidence,
      suggestions,
    })
  } catch (err) {
    next(err)
  }
})

// Create builder session from full form payload
router.post('/session', (req, res, next) => {
  try {
    const formData = req.body?.formData ?? req.body
    const error = validateFormData(formData)
    if (error) return res.status(400).json({ error })

    const session = createBuilderSession(formData)
    console.log(`[builder] session created session=${session.sessionId} name=${formData.name}`)
    res.json({ sessionId: session.sessionId, fileName: session.fileName })
  } catch (err) {
    next(err)
  }
})

// Optional: update form data before build
router.put('/session/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session || session.kind !== 'builder') {
      return res.status(404).json({ error: 'Builder session not found' })
    }
    const formData = req.body?.formData ?? req.body
    const error = validateFormData(formData)
    if (error) return res.status(400).json({ error })

    updateSession(session.sessionId, { builderInput: formData })
    res.json({ ok: true, sessionId: session.sessionId })
  } catch (err) {
    next(err)
  }
})

// Start async build job
router.post('/build', requireUser, checkUsage('builder'), (req, res, next) => {
  try {
    const { sessionId, formData } = req.body || {}
    let session = sessionId ? getSession(sessionId) : null

    if (formData) {
      const error = validateFormData(formData)
      if (error) return res.status(400).json({ error })

      if (session && session.kind === 'builder') {
        updateSession(session.sessionId, { builderInput: formData })
      } else {
        session = createBuilderSession(formData)
      }
    }

    if (!session || session.kind !== 'builder') {
      return res.status(404).json({ error: 'Builder session not found' })
    }

    const usage = consumeUsage(req.user.id, req.user.plan || 'free', 'builder')
    const job = createBuildJob(session.sessionId)
    console.log(`[builder] job started jobId=${job.jobId} session=${session.sessionId} user=${req.user.id}`)

    setImmediate(() => {
      runBuildJob(job.jobId, session.sessionId).catch((err) => {
        console.error(`[builder] unhandled job error jobId=${job.jobId}:`, err.message)
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
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
})

router.get('/file/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session || session.kind !== 'builder') {
      return res.status(404).json({ error: 'Builder session not found' })
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
    if (!session?.enhancedPath) return res.status(404).json({ error: 'Resume not ready' })

    const buffer = fs.readFileSync(session.enhancedPath)
    res.setHeader('Content-Type', DOCX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="${session.fileName}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

export default router
