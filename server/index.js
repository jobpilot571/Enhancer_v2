import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import enhancerRoutes from './routes/enhancer.js'
import builderRoutes from './routes/builder.js'
import jdBuilderRoutes from './routes/jdBuilder.js'
import adminRoutes from './routes/admin.js'
import authRoutes from './routes/auth.js'
import billingRoutes, { handleStripeWebhook } from './routes/billing.js'
import assistantRoutes from './routes/assistant.js'
import { getConfiguredProviders } from './services/aiProvider.js'
import { isTavilyConfigured } from './services/tavilySearch.js'
import { isAdminConfigured } from './middleware/adminAuth.js'
import { isGoogleAuthConfigured } from './services/googleAuth.js'
import { isEmailConfigured, getEmailFromStatus } from './services/email.js'
import { initComplimentaryStore, getComplimentaryStorageStatus } from './store/complimentaryStore.js'
import { initDurableUserStore, getUserStorageStatus } from './store/durableUserData.js'
import { isStripeConfigured } from './services/stripe.js'
import { isAiCostDbConfigured } from './store/aiCostStore.js'

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
    'https://jobpilotagent.com',
    'https://www.jobpilotagent.com',
    'https://enhancer-v2.vercel.app',
  ]

  const allowed = new Set([...defaults, ...fromEnv])

  return (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowed.has(origin) || allowed.has('*')) return callback(null, true)
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return callback(null, true)
    // Production custom domain (+ any subdomain)
    if (/^https:\/\/([\w-]+\.)?jobpilotagent\.com$/.test(origin)) return callback(null, true)
    callback(null, false)
  }
}

app.use(cors({ origin: buildCorsOrigin(), credentials: true }))

// Stripe webhooks need the raw body for signature verification (before json parser).
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    handleStripeWebhook(req, res).catch((err) => {
      console.error('[stripe] webhook unhandled:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Webhook failed' })
    })
  },
)

app.use(express.json({ limit: '2mb' }))
app.use('/api/enhancer', enhancerRoutes)
app.use('/api/builder', builderRoutes)
app.use('/api/jd-builder', jdBuilderRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api/assistant', assistantRoutes)

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
      assistant: '/api/assistant',
      admin: '/api/admin',
      auth: '/api/auth',
      billing: '/api/billing',
    },
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'jobpilot-ai',
    deploy: {
      gitSha: process.env.RENDER_GIT_COMMIT
        || process.env.GIT_COMMIT
        || process.env.SOURCE_VERSION
        || null,
      claudeModelEnv: process.env.CLAUDE_MODEL || null,
      claudeModelResolved: process.env.ANTHROPIC_API_KEY
        ? (getConfiguredProviders().find((p) => /claude/i.test(p.label))?.model || null)
        : null,
    },
    aiProviders: getConfiguredProviders(),
    tavilyConfigured: isTavilyConfigured(),
    adminConfigured: isAdminConfigured(),
    emailConfigured: isEmailConfigured(),
    emailFrom: getEmailFromStatus(),
    googleAuthConfigured: isGoogleAuthConfigured(),
    stripeConfigured: isStripeConfigured(),
    complimentaryStorage: getComplimentaryStorageStatus(),
    userStorage: getUserStorageStatus(),
    aiCostTracking: {
      enabled: true,
      version: 'phase1',
      durableBackend: isAiCostDbConfigured() ? 'supabase' : 'local-json-fallback',
    },
  })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

await initComplimentaryStore()
await initDurableUserStore()

app.listen(PORT, () => {
  console.log(`Resume Enhancer API running on port ${PORT}`)
  const claude = getConfiguredProviders().find((p) => /claude/i.test(p.label))
  if (claude) {
    console.log(`[AI] Claude model: ${claude.model} (env CLAUDE_MODEL=${process.env.CLAUDE_MODEL || '(unset)'})`)
  }
  // Seed fictional DOCX samples for JD gallery templates (never overwrites admin uploads)
  import('./store/adminStore.js')
    .then(({ ensureDemoSamples, JD_DEMO_TEMPLATE_IDS }) =>
      ensureDemoSamples({ templateIds: JD_DEMO_TEMPLATE_IDS, force: false }),
    )
    .then((result) => {
      if (result?.created?.length) {
        console.log(`[samples] seeded ${result.created.length} demo template preview(s)`)
      }
    })
    .catch((err) => console.warn('[samples] demo seed skipped:', err.message))
})
