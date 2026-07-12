import { Router } from 'express'
import fs from 'fs'
import {
  createBuilderSession,
  getSession,
  updateSession,
  readFile,
} from '../store/sessionStore.js'
import { createBuildJob, getBuildJob } from '../store/buildJobStore.js'
import { runBuildJob } from '../services/buildWorker.js'
import { requireUser, checkUsage, consumeUsage } from '../middleware/userAuth.js'

const router = Router()

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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
