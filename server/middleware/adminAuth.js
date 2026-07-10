import crypto from 'crypto'

/** @type {Map<string, number>} token -> expiry ms */
const tokens = new Map()

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function cleanExpired() {
  const now = Date.now()
  for (const [token, exp] of tokens) {
    if (exp <= now) tokens.delete(token)
  }
}

export function isAdminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD?.trim())
}

export function verifyAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || ''
  if (!expected) return false
  const a = Buffer.from(String(password || ''))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function createAdminToken() {
  cleanExpired()
  const token = crypto.randomBytes(32).toString('hex')
  tokens.set(token, Date.now() + TOKEN_TTL_MS)
  return token
}

export function revokeAdminToken(token) {
  if (token) tokens.delete(token)
}

export function isValidAdminToken(token) {
  if (!token) return false
  cleanExpired()
  const exp = tokens.get(token)
  if (!exp) return false
  if (exp <= Date.now()) {
    tokens.delete(token)
    return false
  }
  return true
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!isValidAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized — sign in to the admin console.' })
  }
  req.adminToken = token
  next()
}
