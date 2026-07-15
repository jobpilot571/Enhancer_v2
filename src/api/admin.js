const API_BASE = (
  import.meta.env.VITE_ADMIN_API_BASE ||
  import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/admin') ||
  '/api/admin'
).replace(/\/$/, '')

const TOKEN_KEY = 'jobpilot_admin_token'

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setAdminToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function readErrorMessage(res) {
  try {
    const data = await res.json()
    return data.error || res.statusText
  } catch {
    return res.statusText || 'Request failed'
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  const token = getAdminToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new Error('Cannot reach the admin API. Is the server running?')
  }

  if (res.status === 401 && path !== '/login') {
    setAdminToken('')
    throw new Error('Session expired — sign in again.')
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))

  if (res.status === 204) return null
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res
}

export async function getAdminStatus() {
  return request('/status')
}

export async function adminLogin(password) {
  const data = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  setAdminToken(data.token)
  return data
}

export async function adminLogout() {
  try {
    await request('/logout', { method: 'POST' })
  } finally {
    setAdminToken('')
  }
}

export async function adminMe() {
  return request('/me')
}

export async function fetchAdminTemplates() {
  return request('/templates')
}

export async function uploadTemplateSample(templateId, file) {
  const form = new FormData()
  form.append('sample', file)
  return request(`/templates/${templateId}/sample`, {
    method: 'POST',
    body: form,
  })
}

export async function deleteTemplateSample(templateId) {
  return request(`/templates/${templateId}/sample`, { method: 'DELETE' })
}

export async function fetchAdminPricing() {
  return request('/pricing')
}

export async function saveAdminPricing(plans) {
  return request('/pricing', {
    method: 'PUT',
    body: JSON.stringify({ plans }),
  })
}

export async function fetchComplimentaryEmails() {
  return request('/complimentary')
}

export async function addComplimentaryEmail(email, note = '') {
  return request('/complimentary', {
    method: 'POST',
    body: JSON.stringify({ email, note }),
  })
}

export async function removeComplimentaryEmail(email) {
  return request(`/complimentary/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
}

/** Public — no auth */
export async function fetchPublicPricing() {
  const res = await fetch(`${API_BASE}/public/pricing`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

export async function fetchPublicTemplateSamples() {
  const res = await fetch(`${API_BASE}/public/template-samples`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

export function getSampleFileUrl(templateId) {
  return `${API_BASE}/public/samples/${encodeURIComponent(templateId)}`
}
