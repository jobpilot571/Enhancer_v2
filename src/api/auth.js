const API_BASE = (
  import.meta.env.VITE_AUTH_API_BASE ||
  import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/auth') ||
  '/api/auth'
).replace(/\/$/, '')

const TOKEN_KEY = 'jobpilot_auth_token'
const USER_KEY = 'jobpilot_auth_user'

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

export function clearAuthStorage() {
  setAuthToken('')
  setStoredUser(null)
}

function attachErrorMeta(err, data) {
  err.code = data?.code
  err.email = data?.email
  err.needsVerification = Boolean(data?.needsVerification)
  err.usage = data?.usage
  return err
}

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
    throw new Error('Cannot reach the auth API. Is the server running?')
  }

  if (res.status === 401 && path !== '/login' && path !== '/signup' && path !== '/google') {
    clearAuthStorage()
  }

  if (!res.ok) {
    let data = null
    try {
      data = await res.json()
    } catch {
      /* ignore */
    }
    throw attachErrorMeta(new Error(data?.error || res.statusText || 'Request failed'), data)
  }

  if (res.status === 204) return null
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res
}

export async function getAuthStatus() {
  return request('/status')
}

export async function signup({ name, email, password, confirmPassword }) {
  return request('/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, confirmPassword }),
  })
}

export async function login({ email, password }) {
  const data = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (data.token && data.user) {
    setAuthToken(data.token)
    setStoredUser(data.user)
  }
  return data
}

export async function loginWithGoogle(credential) {
  const data = await request('/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  })
  if (data.token && data.user) {
    setAuthToken(data.token)
    setStoredUser(data.user)
  }
  return data
}

export async function verifyOtp({ email, code }) {
  const data = await request('/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
  if (data.token && data.user) {
    setAuthToken(data.token)
    setStoredUser(data.user)
  }
  return data
}

export async function resendOtp({ email }) {
  return request('/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function logout() {
  try {
    await request('/logout', { method: 'POST' })
  } finally {
    clearAuthStorage()
  }
}

export async function fetchMe() {
  const data = await request('/me')
  if (data?.user) setStoredUser(data.user)
  return data
}
