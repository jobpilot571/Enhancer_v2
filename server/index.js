import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import enhancerRoutes from './routes/enhancer.js'
import { getConfiguredProviders } from './services/aiProvider.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
app.use(express.json({ limit: '2mb' }))
app.use('/api/enhancer', enhancerRoutes)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'resume-enhancer',
    aiProviders: getConfiguredProviders(),
  })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Resume Enhancer API running on http://localhost:${PORT}`)
})
