import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import enhancerRoutes from './routes/enhancer.js'
import builderRoutes from './routes/builder.js'
import jdBuilderRoutes from './routes/jdBuilder.js'
import adminRoutes from './routes/admin.js'
import { getConfiguredProviders } from './services/aiProvider.js'
import { isAdminConfigured } from './middleware/adminAuth.js'

const app = express()
const PORT = process.env.PORT || 3001

function buildCorsOrigin() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
  ]

  const allowed = new Set([...defaults, ...fromEnv])

  return (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowed.has(origin) || allowed.has('*')) return callback(null, true)
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return callback(null, true)
    callback(null, false)
  }
}

app.use(cors({ origin: buildCorsOrigin(), credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use('/api/enhancer', enhancerRoutes)
app.use('/api/builder', builderRoutes)
app.use('/api/jd-builder', jdBuilderRoutes)
app.use('/api/admin', adminRoutes)

app.get('/', (_req, res) => {
  res.json({
    service: 'JobPilot AI API',
    status: 'running',
    message: 'This is the backend API only. Open the frontend on Vercel to use the app.',
    health: '/api/health',
    api: {
      enhancer: '/api/enhancer',
      builder: '/api/builder',
      jdBuilder: '/api/jd-builder',
      admin: '/api/admin',
    },
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'jobpilot-ai',
    aiProviders: getConfiguredProviders(),
    adminConfigured: isAdminConfigured(),
  })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Resume Enhancer API running on port ${PORT}`)
})
