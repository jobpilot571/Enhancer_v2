import { getAuthToken, clearAuthStorage } from './auth'

const API_BASE = (
  import.meta.env.VITE_BILLING_API_BASE ||
  import.meta.env.VITE_AUTH_API_BASE?.replace(/\/auth$/, '/billing') ||
  import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/billing') ||
  '/api/billing'
).replace(/\/$/, '')

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new Error('Cannot reach the billing API. Is the server running?')
  }

  if (res.status === 401) {
    clearAuthStorage()
  }

  if (!res.ok) {
    let data = null
    try {
      data = await res.json()
    } catch {
      /* ignore */
    }
    const err = new Error(data?.error || res.statusText || 'Request failed')
    err.code = data?.code
    throw err
  }

  if (res.status === 204) return null
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res
}

export function createCheckoutSession(plan = 'professional') {
  return request('/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  })
}

export function openBillingPortal() {
  return request('/portal', { method: 'POST' })
}

export function confirmCheckoutSession(sessionId) {
  const q = encodeURIComponent(sessionId)
  return request(`/confirm?session_id=${q}`)
}

export function getBillingStatus() {
  return request('/status')
}
