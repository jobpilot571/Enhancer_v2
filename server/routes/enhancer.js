import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import {
  createSession,
  detectFileType,
  getSession,
  updateSession,
  readFile,
} from '../store/sessionStore.js'
import { extractResumeText } from '../services/resumeExtract.js'
import { parseResume } from '../services/openaiService.js'
import { createEnhanceJob, getEnhanceJob } from '../store/enhanceJobStore.js'
import { runEnhanceJob } from '../services/enhanceWorker.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const type = detectFileType(file.originalname, file.mimetype)
    cb(type ? null : new Error('Only .docx and .pdf files are allowed'), !!type)
  },
})

function mimeForType(fileType) {
  if (fileType === 'pdf') return 'application/pdf'
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

async function ensureResumeData(session) {
  if (session.resumeData) return session.resumeData
  const buffer = readFile(session.originalPath)
  const resumeText = session.resumeText || await extractResumeText(buffer, session.fileType)
  const resumeData = await parseResume(resumeText)
  updateSession(session.sessionId, { resumeText, resumeData })
  return resumeData
}

// 1. Fast upload — save file only, no AI
router.post('/upload', upload.single('resume'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const fileType = detectFileType(req.file.originalname, req.file.mimetype)
    const session = createSession(req.file.originalname, fileType, req.file.buffer)

    console.log(`[upload] saved session=${session.sessionId} type=${fileType} file=${session.fileName}`)

    res.json({
      sessionId: session.sessionId,
      fileName: session.fileName,
      fileType: session.fileType,
      uploadStatus: 'success',
    })
  } catch (err) {
    next(err)
  }
})

// 2. Background resume extraction (AI) — not used for preview
router.post('/extract/resume', async (req, res, next) => {
  try {
    const { sessionId } = req.body
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const resumeData = await ensureResumeData(session)
    res.json({ resumeData, extracted: true })
  } catch (err) {
    next(err)
  }
})

// 3. Save JD text (textarea preview is client-side)
router.put('/jd', (req, res, next) => {
  try {
    const { sessionId, jdText } = req.body
    if (!sessionId || !jdText?.trim()) {
      return res.status(400).json({ error: 'sessionId and jdText are required' })
    }
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    updateSession(sessionId, { jdText: jdText.trim(), jdData: null })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// 4. Start async enhance job — returns immediately
router.post('/enhance', (req, res, next) => {
  try {
    const { sessionId, jdText } = req.body
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    if (!jdText?.trim() && !session.jdText?.trim()) {
      return res.status(400).json({ error: 'Job description is required' })
    }
    if (session.fileType !== 'docx') {
      return res.status(400).json({
        error: 'Enhancement and DOCX download require a DOCX upload. PDF preview is supported, but enhancement patches the original Word document.',
      })
    }

    const job = createEnhanceJob(sessionId)
    console.log(`[enhance] job started jobId=${job.jobId} session=${sessionId}`)

    setImmediate(() => {
      runEnhanceJob(job.jobId, sessionId, jdText).catch((err) => {
        console.error(`[enhance] unhandled job error jobId=${job.jobId}:`, err.message)
      })
    })

    res.json({ jobId: job.jobId, status: 'processing' })
  } catch (err) {
    next(err)
  }
})

router.get('/enhance-status/:jobId', (req, res, next) => {
  try {
    const job = getEnhanceJob(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Job not found' })

    const payload = {
      jobId: job.jobId,
      status: job.status,
      step: job.step,
    }

    if (job.status === 'failed') {
      payload.error = job.error
    }

    if (job.status === 'completed' && job.result) {
      payload.comparison = job.result.comparison
      payload.comparisonBefore = job.result.comparisonBefore
      payload.matchAnalysis = job.result.matchAnalysis
      payload.enhancementPlan = job.result.enhancementPlan
      payload.atsScore = job.result.atsScore
      payload.sessionId = job.result.sessionId
      payload.downloadUrl = job.result.downloadUrl
      payload.enhancedPreviewUrl = job.result.enhancedPreviewUrl
    }

    res.json(payload)
  } catch (err) {
    next(err)
  }
})

// Serve original or enhanced file for preview/download
router.get('/file/:sessionId/:type', (req, res, next) => {
  try {
    const { sessionId, type } = req.params
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    if (type === 'enhanced') {
      const previewPath = session.enhancedPreviewPath || session.enhancedPath
      if (!previewPath) return res.status(404).json({ error: 'Enhanced file not ready' })
      const buffer = readFile(previewPath)
      res.setHeader('Content-Type', mimeForType('docx'))
      res.setHeader('Content-Disposition', `inline; filename="enhanced-${session.fileName.replace(/\.pdf$/i, '.docx')}"`)
      return res.send(buffer)
    }

    const buffer = readFile(session.originalPath)
    res.setHeader('Content-Type', mimeForType(session.fileType))
    res.setHeader('Content-Disposition', `inline; filename="${session.fileName}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.get('/download/:sessionId', (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session?.enhancedPath) return res.status(404).json({ error: 'Enhanced file not ready' })

    const buffer = fs.readFileSync(session.enhancedPath)
    const base = session.fileName.replace(/\.(docx|pdf)$/i, '')
    const name = `${base}-enhanced.docx`
    res.setHeader('Content-Type', mimeForType('docx'))
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message })
  }
  if (err?.message === 'Only .docx and .pdf files are allowed') {
    return res.status(400).json({ error: err.message })
  }
  next(err)
})

export default router
