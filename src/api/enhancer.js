const BASE = '/api/enhancer'

const ENHANCE_STEP_LABELS = {
  analyzing_resume: 'Analyzing resume…',
  parsing_jd: 'Parsing job description…',
  comparing: 'Comparing skills…',
  writing_plan: 'Writing enhancement plan…',
  updating_resume: 'Updating resume…',
  preparing_preview: 'Preparing enhanced preview…',
}

async function readErrorMessage(res) {
  try {
    const data = await res.json()
    return data.error || res.statusText
  } catch {
    if (res.status >= 500) {
      return 'Backend unavailable — start the API with npm run server or npm run dev:all'
    }
    return res.statusText || 'Request failed'
  }
}

async function request(url, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${url}`, options)
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Upload timed out — please try again.')
    }
    throw new Error('Cannot reach the resume server. Run npm run server or npm run dev:all.')
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res
}

export async function uploadResume(file) {
  const form = new FormData()
  form.append('resume', file)
  const res = await request('/upload', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
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
    res = await fetch(`${BASE}/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, jdText }),
    })
  } catch {
    throw new Error('Cannot reach the resume server. Run npm run server or npm run dev:all.')
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

export async function getEnhanceStatus(jobId) {
  let res
  try {
    res = await fetch(`${BASE}/enhance-status/${jobId}`)
  } catch {
    throw new Error('Lost connection while checking enhancement status.')
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
  return `${BASE}/file/${sessionId}/${type}`
}

export function getDownloadUrl(sessionId) {
  return `${BASE}/download/${sessionId}`
}

export async function fetchFileBlob(sessionId, type = 'original') {
  const res = await fetch(getFileUrl(sessionId, type))
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.blob()
}
