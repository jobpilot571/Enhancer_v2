import { getAuthToken } from './auth'

const API_BASE = (import.meta.env.VITE_JD_BUILDER_API_BASE || import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/jd-builder') || '/api/jd-builder').replace(/\/$/, '')

export function getApiRoot() {
  if (API_BASE.startsWith('http')) {
    return API_BASE.replace(/\/jd-builder$/, '')
  }
  return '/api'
}

const BUILD_STEP_LABELS = {
  parsing_jd: 'Analyzing job description…',
  generating_content: 'Writing JD-tailored resume content…',
  building_docx: 'Building your DOCX…',
  preparing_preview: 'Preparing preview…',
}

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    return { error: 'API route not configured — redeploy with API proxy, or set VITE_API_BASE to your backend URL.' }
  }
  try {
    return await res.json()
  } catch {
    if (res.status === 401) return { error: 'Sign in to use this service.', code: 'AUTH_REQUIRED' }
    if (res.status === 404) {
      return { error: 'API not found — deploy the backend and set VITE_API_BASE.' }
    }
    if (res.status >= 500) {
      return { error: 'Backend error — check API server logs and AI API keys.' }
    }
    return { error: res.statusText || 'Request failed' }
  }
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
    : 'a deployed API (set VITE_API_BASE)'
  return new Error(`Cannot reach the resume API at ${apiHint}.`)
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

export async function startJdBuild(formData, sessionId = null) {
  const res = await request('/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formData, sessionId }),
    signal: AbortSignal.timeout(60000),
  })
  return res.json()
}

/**
 * Upload a resume DOCX/PDF and extract contact + education for Basics step.
 */
export async function extractJdBasics(file) {
  const form = new FormData()
  form.append('resume', file)
  const res = await request('/extract-basics', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(90000),
  })
  return res.json()
}

export async function getJdBuildStatus(jobId) {
  const res = await request(`/build-status/${jobId}`, {
    signal: AbortSignal.timeout(30000),
  })
  return res.json()
}

export function getJdBuildStepLabel(step) {
  return BUILD_STEP_LABELS[step] || 'Building JD-tailored resume…'
}

export async function waitForJdBuild(jobId, onProgress, maxMs = 360000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const status = await getJdBuildStatus(jobId)
    onProgress?.(status)
    if (status.status === 'completed') return status
    if (status.status === 'failed') throw new Error(status.error || 'JD-tailored resume build failed')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Build is still running — check back in a moment and refresh.')
}

export function getFileUrl(sessionId) {
  return `${API_BASE}/file/${sessionId}`
}

export function getDownloadUrl(sessionId) {
  return `${API_BASE}/download/${sessionId}`
}

export async function fetchFileBlob(sessionId) {
  const res = await request(`/file/${sessionId}`)
  return res.blob()
}
