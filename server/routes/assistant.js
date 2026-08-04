import { Router } from 'express'
import multer from 'multer'
import { optionalUser } from '../middleware/userAuth.js'
import { AI_SERVICES, finalizeAiServiceCost, runWithAiCostContext } from '../services/aiCostTracking.js'
import { runSiteAssistantChat } from '../services/siteAssistantService.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase()
    const mime = String(file.mimetype || '').toLowerCase()
    const ok = (
      mime.startsWith('image/')
      || name.endsWith('.docx')
      || name.endsWith('.pdf')
      || name.endsWith('.png')
      || name.endsWith('.jpg')
      || name.endsWith('.jpeg')
      || name.endsWith('.webp')
      || name.endsWith('.gif')
      || mime === 'application/pdf'
      || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    cb(ok ? null : new Error('Only images, PDF, or DOCX are allowed'), ok)
  },
})

router.post('/chat', optionalUser, upload.array('files', 4), async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim()
    const pathname = String(req.body?.pathname || '/').trim() || '/'
    let workspace = {}
    let thread = []
    try { workspace = JSON.parse(req.body?.workspace || '{}') } catch { workspace = {} }
    try { thread = JSON.parse(req.body?.thread || '[]') } catch { thread = [] }

    if (!message && !(req.files || []).length) {
      return res.status(400).json({ error: 'Tell me what you need help with, or attach a file.' })
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    await runWithAiCostContext({
      userId: req.user?.id || null,
      sessionId: workspace?.sessionId || undefined,
      serviceName: AI_SERVICES.SITE_ASSISTANT || 'Site AI Assistant',
    }, async () => {
      try {
        await runSiteAssistantChat({
          res,
          message: message || 'Please review my attached file.',
          pathname,
          workspace,
          thread,
          files: req.files || [],
          userId: req.user?.id || null,
        })
        finalizeAiServiceCost({ status: 'completed' })
      } catch (err) {
        finalizeAiServiceCost({ status: 'failed' })
        throw err
      }
    })
  } catch (err) {
    if (res.headersSent) {
      try {
        res.write(`event: reply\ndata: ${JSON.stringify({ reply: err.message || 'Assistant failed', error: true })}\n\n`)
        res.write(`event: done\ndata: ${JSON.stringify({ ok: false })}\n\n`)
        res.end()
      } catch { /* ignore */ }
      return undefined
    }
    if (err.status) return res.status(err.status).json({ error: err.message })
    return next(err)
  }
  return undefined
})

export default router
