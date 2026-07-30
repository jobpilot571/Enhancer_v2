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
import { createEnhanceJob, getEnhanceJob } from '../store/enhanceJobStore.js'
import { runEnhanceJob } from '../services/enhanceWorker.js'
import { ensureResumeData, ensureJdData, precomputeResume, precomputeJd } from '../services/sessionPrepare.js'
import { buildScoreReportPdf } from '../services/scoreReportPdfService.js'
import { getLastResumeParseSnapshot } from '../services/resumeParseCache.js'
import { fixReportedLayoutIssue } from '../services/layoutIssueService.js'
import { requireUser, checkUsage, consumeUsage } from '../middleware/userAuth.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const type = detectFileType(file.originalname, file.mimetype)
    cb(type ? null : new Error('Only .docx and .pdf files are allowed'), !!type)
  },
})

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase()
    const mime = (file.mimetype || '').toLowerCase()
    const ok = (
      name.endsWith('.docx')
      || name.endsWith('.png')
      || name.endsWith('.jpg')
      || name.endsWith('.jpeg')
      || name.endsWith('.webp')
      || name.endsWith('.gif')
      || mime.includes('image/')
      || mime.includes('officedocument.wordprocessingml')
    )
    cb(ok ? null : new Error('Upload a screenshot (PNG/JPG/WebP) or a .docx file'), ok)
  },
})

function mimeForType(fileType) {
  if (fileType === 'pdf') return 'application/pdf'
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

// 1. Fast upload — save file, then precompute resume parse in background
router.post('/upload', requireUser, checkUsage('enhancer'), upload.single('resume'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const fileType = detectFileType(req.file.originalname, req.file.mimetype)
    const session = createSession(req.file.originalname, fileType, req.file.buffer)

    console.log(`[upload] saved session=${session.sessionId} type=${fileType} file=${session.fileName} user=${req.user.id}`)

    res.json({
      sessionId: session.sessionId,
      fileName: session.fileName,
      fileType: session.fileType,
      uploadStatus: 'success',
      usage: req.usagePreview,
    })

    // Warm cache while user pastes JD — does not block upload response
    precomputeResume(session.sessionId)
  } catch (err) {
    next(err)
  }
})

// 2. Explicit resume extraction (optional; upload already precomputes)
router.post('/extract/resume', async (req, res, next) => {
  try {
    const { sessionId } = req.body
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const resumeData = await ensureResumeData(sessionId)
    res.json({ resumeData, extracted: true })
  } catch (err) {
    next(err)
  }
})

// 3. Save JD text + precompute JD parse in background
router.put('/jd', (req, res, next) => {
  try {
    const { sessionId, jdText } = req.body
    if (!sessionId || !jdText?.trim()) {
      return res.status(400).json({ error: 'sessionId and jdText are required' })
    }
    const session = getSession(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const nextText = jdText.trim()
    const changed = session.jdText?.trim() !== nextText
    if (changed) {
      updateSession(sessionId, { jdText: nextText, jdData: null, jdParseError: null })
      console.log(`[jd] saved session=${sessionId} chars=${nextText.length}`)
      precomputeJd(sessionId)
    } else if (!session.jdData) {
      precomputeJd(sessionId)
    }

    res.json({ ok: true, cached: !changed && !!session.jdData })
  } catch (err) {
    next(err)
  }
})

// 4. Start async enhance job — returns immediately
router.post('/enhance', requireUser, checkUsage('enhancer'), (req, res, next) => {
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

    const usage = consumeUsage(req.user.id, req.user.plan || 'free', 'enhancer')
    const job = createEnhanceJob(sessionId)
    console.log(`[enhance] job started jobId=${job.jobId} session=${sessionId} user=${req.user.id}`)

    setImmediate(() => {
      runEnhanceJob(job.jobId, sessionId, jdText).catch((err) => {
        console.error(`[enhance] unhandled job error jobId=${job.jobId}:`, err.message)
      })
    })

    res.json({ jobId: job.jobId, status: 'processing', usage })
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
      // Explicit top-level fields so UI cards never miss breakdown data
      payload.beforeBreakdown = job.result.matchAnalysis?.beforeBreakdown
        || job.result.comparisonBefore?.scoreBreakdown
        || null
      payload.afterBreakdown = job.result.matchAnalysis?.afterBreakdown
        || job.result.comparison?.scoreBreakdown
        || null
      payload.enhancementPlan = job.result.enhancementPlan
      payload.atsScore = job.result.atsScore
      payload.sessionId = job.result.sessionId
      payload.layoutQa = job.result.layoutQa || null
      payload.readyForDownload = Boolean(job.result.readyForDownload && job.result.layoutQa?.ok !== false)
      payload.layoutWarning = job.result.layoutWarning || null
      payload.downloadUrl = job.result.readyForDownload === false
        ? null
        : job.result.downloadUrl
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
    if (!session?.enhancedPath) {
      return res.status(404).json({
        error: 'Enhanced file not ready yet. Please wait a moment and try again.',
      })
    }
    // Layout QA runs + auto-repairs during enhance. Do not block download mid-flow
    // for residual advisory layout flags — only missing file is a hard stop.

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

// Debug: latest resume extract written to disk (also open server/.cache/last-resume-parse.json)
router.get('/debug/last-resume-parse', (_req, res) => {
  const snapshot = getLastResumeParseSnapshot()
  if (!snapshot) {
    return res.status(404).json({
      error: 'No resume parse yet — upload a resume first, then refresh this URL.',
    })
  }
  res.json(snapshot)
})

// Debug: live session extract + JD + compare (while server still has the session)
router.get('/debug/session/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found (server may have restarted)' })
  res.json({
    sessionId: session.sessionId,
    fileName: session.fileName,
    resumeParseMethod: session.resumeParseMethod || null,
    resumeParseConfidence: session.resumeParseConfidence ?? null,
    resumeData: session.resumeData || null,
    jdData: session.jdData || null,
    comparisonBefore: session.comparisonBefore || null,
    comparison: session.comparison || null,
    enhancementPlan: session.enhancementPlan || null,
    processingMeta: session.processingMeta || null,
  })
})

router.get('/score-report/:sessionId', async (req, res, next) => {
  try {
    const session = getSession(req.params.sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    if (!session.matchAnalysis && !session.comparison) {
      return res.status(404).json({ error: 'Score report not ready — run Enhance first' })
    }

    const pdf = await buildScoreReportPdf({
      session,
      matchAnalysis: session.matchAnalysis || {},
      comparison: session.comparison || {},
      comparisonBefore: session.comparisonBefore || {},
      aiUsage: session.processingMeta?.aiUsage || session.matchAnalysis?.processingMeta?.aiUsage || null,
    })

    const base = (session.fileName || 'resume').replace(/\.(docx|pdf)$/i, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${base}-score-report.pdf"`)
    res.send(pdf)
  } catch (err) {
    next(err)
  }
})

// User reports any enhancer issue (text + optional screenshot/docx) → auto repair/rebuild
router.post(
  '/layout-fix',
  requireUser,
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const sessionId = req.body?.sessionId
      const message = (req.body?.message || '').trim()
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })
      if (!message && !req.file) {
        return res.status(400).json({
          error: 'Describe the issue (layout, duplicate bullet, garbled text, skills, etc.) or attach a screenshot/.docx.',
        })
      }

      const result = await fixReportedLayoutIssue({
        sessionId,
        message: message || 'Enhancer issue from uploaded evidence',
        evidenceFile: req.file || null,
        log: (msg) => console.log(`[enhancer-fix:${String(sessionId).slice(0, 8)}] ${msg}`),
      })

      res.json({
        ok: result.ok,
        readyForDownload: result.readyForDownload,
        reply: result.reply,
        layoutQa: result.layoutQa,
        classification: result.classification,
        previewUpdated: result.previewUpdated !== false,
        downloadUrl: result.readyForDownload ? `/api/enhancer/download/${sessionId}` : null,
        enhancedPreviewUrl: `/api/enhancer/file/${sessionId}/enhanced`,
      })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      next(err)
    }
  },
)

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message })
  }
  if (err?.message === 'Only .docx and .pdf files are allowed') {
    return res.status(400).json({ error: err.message })
  }
  if (err?.message === 'Upload a screenshot (PNG/JPG/WebP) or a .docx file') {
    return res.status(400).json({ error: err.message })
  }
  next(err)
})

export default router
