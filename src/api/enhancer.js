import { getAuthToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api/enhancer').replace(/\/$/, '')

export function getApiRoot() {
  if (API_BASE.startsWith('http')) {
    return API_BASE.replace(/\/enhancer$/, '')
  }
  return '/api'
}

const ENHANCE_STEP_LABELS = {
  analyzing_resume: 'Analyzing resume…',
  parsing_jd: 'Parsing job description…',
  comparing: 'Comparing skills…',
  writing_plan: 'Writing enhancement plan…',
  updating_resume: 'Updating resume…',
  preparing_preview: 'Preparing enhanced preview…',
}

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    return { error: 'API route not configured — redeploy Vercel with vercel.json API proxy, or set VITE_API_BASE to your Render URL.' }
  }
  try {
    return await res.json()
  } catch {
    if (res.status === 401) return { error: 'Sign in to use this service.', code: 'AUTH_REQUIRED' }
    if (res.status === 404) {
      return { error: 'API not found — deploy the backend and set VITE_API_BASE in Vercel environment variables.' }
    }
    if (res.status >= 500) {
      return { error: 'Backend error — check API server logs and AI API keys.' }
    }
    return { error: res.statusText || 'Request failed' }
  }
}

/** Returns a string error message (used by fetch paths that don't go through request()). */
async function readErrorMessage(res) {
  const data = await readErrorPayload(res)
  return data.error || res.statusText || 'Request failed'
}

function authHeaders(extra = {}) {
  const headers = { ...extra }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function networkError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new Error('Request timed out — please try again.')
  }
  const apiHint = API_BASE.startsWith('http')
    ? API_BASE
    : 'a deployed API (set VITE_API_BASE in Vercel)'
  return new Error(`Cannot reach the resume API at ${apiHint}. Deploy the backend on Render/Railway and configure VITE_API_BASE.`)
}

async function request(url, options = {}) {
  let res
  try {
    const headers = authHeaders(options.headers || {})
    res = await fetch(`${API_BASE}${url}`, { ...options, headers })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) {
    const data = await readErrorPayload(res)
    const err = new Error(data.error || res.statusText || 'Request failed')
    err.code = data.code
    err.usage = data.usage
    throw err
  }
  return res
}

export async function checkApiHealth() {
  try {
    const res = await fetch(`${getApiRoot()}/health`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      const data = await readErrorPayload(res)
      return { ok: false, error: data.error }
    }
    return { ok: true, ...(await res.json()) }
  } catch (err) {
    return { ok: false, error: networkError(err).message }
  }
}

export async function uploadResume(file) {
  const form = new FormData()
  form.append('resume', file)
  const res = await request('/upload', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  })
  return res.json()
}

export async function setJD(sessionId, jdText) {
  const res = await request('/jd', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, jdText }),
  })
  return res.json()
}

export async function startEnhance(sessionId, jdText) {
  let res
  try {
    res = await fetch(`${API_BASE}/enhance`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId, jdText }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

export async function getEnhanceStatus(jobId) {
  let res
  try {
    res = await fetch(`${API_BASE}/enhance-status/${jobId}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(30000),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

export function getEnhanceStepLabel(step) {
  return ENHANCE_STEP_LABELS[step] || 'Processing…'
}

export async function waitForEnhance(jobId, onProgress, maxMs = 300000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const status = await getEnhanceStatus(jobId)
    onProgress?.(status)
    if (status.status === 'completed') return status
    if (status.status === 'failed') throw new Error(status.error || 'Enhancement failed')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Enhancement is still running — check back in a moment and refresh.')
}

export function getFileUrl(sessionId, type = 'original') {
  return `${API_BASE}/file/${sessionId}/${type}`
}

export function getDownloadUrl(sessionId) {
  return `${API_BASE}/download/${sessionId}`
}

export function getScoreReportPdfUrl(sessionId) {
  return `${API_BASE}/score-report/${sessionId}`
}

export async function downloadScoreReportPdf(sessionId) {
  const res = await fetch(getScoreReportPdfUrl(sessionId), {
    headers: authHeaders(),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res))
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('pdf')) {
    throw new Error('Score report API did not return a PDF. Restart the backend server and try again.')
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^"]+)"?/i)
  const fileName = match?.[1] || 'resume-score-report.pdf'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function fetchFileBlob(sessionId, type = 'original') {
  const res = await fetch(getFileUrl(sessionId, type), {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.blob()
}
