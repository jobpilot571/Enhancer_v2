const API_BASE = (import.meta.env.VITE_BUILDER_API_BASE || import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/builder') || '/api/builder').replace(/\/$/, '')

export function getApiRoot() {
  if (API_BASE.startsWith('http')) {
    return API_BASE.replace(/\/builder$/, '')
  }
  return '/api'
}

const BUILD_STEP_LABELS = {
  generating_content: 'Writing resume content…',
  building_docx: 'Building your DOCX…',
  preparing_preview: 'Preparing preview…',
}

async function readErrorMessage(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    return 'API route not configured — redeploy Vercel with vercel.json API proxy, or set VITE_API_BASE to your Render URL.'
  }
  try {
    const data = await res.json()
    return data.error || res.statusText
  } catch {
    if (res.status === 404) {
      return 'API not found — deploy the backend and set VITE_API_BASE in Vercel environment variables.'
    }
    if (res.status >= 500) {
      return 'Backend error — check API server logs and AI API keys.'
    }
    return res.statusText || 'Request failed'
  }
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
    res = await fetch(`${API_BASE}${url}`, options)
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res
}

export async function checkApiHealth() {
  try {
    const res = await fetch(`${getApiRoot()}/health`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { ok: false, error: await readErrorMessage(res) }
    return { ok: true, ...(await res.json()) }
  } catch (err) {
    return { ok: false, error: networkError(err).message }
  }
}

export async function startBuild(formData, sessionId = null) {
  const res = await request('/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formData, sessionId }),
    signal: AbortSignal.timeout(60000),
  })
  return res.json()
}

export async function getBuildStatus(jobId) {
  const res = await request(`/build-status/${jobId}`, {
    signal: AbortSignal.timeout(30000),
  })
  return res.json()
}

export function getBuildStepLabel(step) {
  return BUILD_STEP_LABELS[step] || 'Building resume…'
}

export async function waitForBuild(jobId, onProgress, maxMs = 300000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const status = await getBuildStatus(jobId)
    onProgress?.(status)
    if (status.status === 'completed') return status
    if (status.status === 'failed') throw new Error(status.error || 'Resume build failed')
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
  const res = await fetch(getFileUrl(sessionId))
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.blob()
}
