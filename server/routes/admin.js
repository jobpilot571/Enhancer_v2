import { Router } from 'express'
import multer from 'multer'
import {
  isAdminConfigured,
  verifyAdminPassword,
  createAdminToken,
  revokeAdminToken,
  requireAdmin,
} from '../middleware/adminAuth.js'
import {
  getPricing,
  savePricing,
  listSamples,
  getSample,
  saveSample,
  deleteSample,
  getTemplateIds,
} from '../store/adminStore.js'
import { TEMPLATE_STYLES } from '../services/resumeTemplates.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = (file.originalname || '').toLowerCase()
    const ok =
      lower.endsWith('.docx') ||
      lower.endsWith('.pdf') ||
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    cb(ok ? null : new Error('Only .docx and .pdf sample files are allowed'), ok)
  },
})

function detectSampleType(fileName, mimeType) {
  const lower = (fileName || '').toLowerCase()
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  return null
}

function mimeForType(fileType) {
  if (fileType === 'pdf') return 'application/pdf'
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

// ——— Public (no auth) ———

router.get('/public/pricing', (_req, res) => {
  res.json(getPricing())
})

router.get('/public/template-samples', (_req, res) => {
  res.json({ samples: listSamples() })
})

router.get('/public/samples/:templateId', (req, res) => {
  const sample = getSample(req.params.templateId)
  if (!sample) return res.status(404).json({ error: 'Sample not found' })
  res.setHeader('Content-Type', mimeForType(sample.fileType))
  res.setHeader('Content-Disposition', `inline; filename="${sample.fileName}"`)
  res.send(sample.buffer)
})

// ——— Auth ———

router.get('/status', (_req, res) => {
  res.json({ configured: isAdminConfigured() })
})

router.post('/login', (req, res) => {
  if (!isAdminConfigured()) {
    return res.status(503).json({
      error: 'Admin is not configured. Set ADMIN_PASSWORD in the server environment.',
    })
  }
  const password = req.body?.password
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' })
  }
  const token = createAdminToken()
  res.json({ token, expiresInDays: 7 })
})

router.post('/logout', requireAdmin, (req, res) => {
  revokeAdminToken(req.adminToken)
  res.json({ ok: true })
})

router.get('/me', requireAdmin, (_req, res) => {
  res.json({ ok: true, role: 'admin' })
})

// ——— Templates & samples ———

router.get('/templates', requireAdmin, (_req, res) => {
  const samples = listSamples()
  const templates = getTemplateIds().map((id) => {
    const style = TEMPLATE_STYLES[id] || {}
    return {
      id,
      accent: style.accent,
      headerStyle: style.headerStyle,
      sample: samples[id] || null,
    }
  })
  res.json({ templates })
})

router.post('/templates/:templateId/sample', requireAdmin, upload.single('sample'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const fileType = detectSampleType(req.file.originalname, req.file.mimetype)
    if (!fileType) return res.status(400).json({ error: 'Only .docx and .pdf are allowed' })

    const saved = saveSample(
      req.params.templateId,
      req.file.originalname,
      fileType,
      req.file.buffer,
    )
    res.json({ sample: saved })
  } catch (err) {
    next(err)
  }
})

router.delete('/templates/:templateId/sample', requireAdmin, (req, res, next) => {
  try {
    res.json(deleteSample(req.params.templateId))
  } catch (err) {
    next(err)
  }
})

// ——— Pricing ———

router.get('/pricing', requireAdmin, (_req, res) => {
  res.json(getPricing())
})

router.put('/pricing', requireAdmin, (req, res, next) => {
  try {
    const plans = req.body?.plans
    const saved = savePricing(plans)
    res.json(saved)
  } catch (err) {
    next(err)
  }
})

router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message })
  }
  if (err?.message?.includes('Only .docx')) {
    return res.status(400).json({ error: err.message })
  }
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Admin error' })
})

export default router
