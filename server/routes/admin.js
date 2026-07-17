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
import {
  listComplimentaryEmails,
  addComplimentaryEmail,
  removeComplimentaryEmail,
  COMPLIMENTARY_PLAN_TYPES,
  getComplimentaryStorageStatus,
} from '../store/complimentaryStore.js'
import { setUserComplimentaryAccess } from '../store/userStore.js'
import { TEMPLATE_STYLES } from '../services/resumeTemplates.js'
import { anonymizeSampleBuffer } from '../services/sampleAnonymize.js'

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

  // Re-anonymize on serve so older uploads (pre-anonymize) never leak real PII
  let payload = sample.buffer
  if (sample.fileType === 'docx') {
    try {
      payload = anonymizeSampleBuffer(sample.buffer, 'docx').buffer
    } catch (err) {
      console.warn('[admin] sample anonymize on serve failed:', err.message)
    }
  }

  res.setHeader('Content-Type', mimeForType(sample.fileType))
  res.setHeader('Content-Disposition', `inline; filename="${sample.fileName}"`)
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.send(payload)
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

// ——— Complimentary paid access (friends / employees / relatives) ———

router.get('/complimentary', requireAdmin, async (_req, res, next) => {
  try {
    const entries = listComplimentaryEmails()
    // Re-apply plan upgrades so existing accounts pick up unlimited access
    let synced = 0
    for (const e of entries) {
      if (setUserComplimentaryAccess(e.email, true, e.planType)) synced += 1
    }
    res.json({
      entries,
      synced,
      planTypes: COMPLIMENTARY_PLAN_TYPES,
      storage: getComplimentaryStorageStatus(),
    })
  } catch (err) {
    next(err)
  }
})

router.post('/complimentary', requireAdmin, async (req, res, next) => {
  try {
    const planType = req.body?.planType || req.body?.note
    const entry = await addComplimentaryEmail(req.body?.email, planType)
    // Also upgrade existing account plan so limits apply immediately
    const user = setUserComplimentaryAccess(entry.email, true, entry.planType)
    const storage = getComplimentaryStorageStatus()
    res.status(entry.updated ? 200 : 201).json({
      entry,
      userUpdated: Boolean(user),
      storage,
      message: user
        ? `${entry.email} set to ${entry.planTypeLabel} plan (unlimited). They should refresh or sign in again.`
        : `${entry.email} added as ${entry.planTypeLabel}. When they sign up / sign in, they get unlimited access.`,
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/complimentary/:email', requireAdmin, async (req, res, next) => {
  try {
    const email = decodeURIComponent(req.params.email || '')
    await removeComplimentaryEmail(email)
    const user = setUserComplimentaryAccess(email, false)
    res.json({ ok: true, userUpdated: Boolean(user), storage: getComplimentaryStorageStatus() })
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
