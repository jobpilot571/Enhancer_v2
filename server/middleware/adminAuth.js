import crypto from 'crypto'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Optional revoke list for explicit logout (survives only until process restart). */
/** @type {Set<string>} */
const revoked = new Set()

function getSigningSecret() {
  const fromEnv = process.env.ADMIN_SECRET?.trim() || process.env.ADMIN_PASSWORD?.trim()
  return fromEnv || ''
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

function sign(payloadB64) {
  const secret = getSigningSecret()
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex')
}

/**
 * Stateless admin token — survives Render restarts/redeploys.
 * Format: base64url(json).hexHmac
 */
export function createAdminToken() {
  const secret = getSigningSecret()
  if (!secret) throw Object.assign(new Error('ADMIN_PASSWORD is not configured'), { status: 503 })

  const payload = {
    role: 'admin',
    exp: Date.now() + TOKEN_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

export function revokeAdminToken(token) {
  if (token) revoked.add(token)
}

export function isValidAdminToken(token) {
  if (!token || typeof token !== 'string') return false
  if (revoked.has(token)) return false

  const secret = getSigningSecret()
  if (!secret) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, mac] = parts
  if (!payloadB64 || !mac) return false

  const expected = sign(payloadB64)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (payload.role !== 'admin') return false
    if (!payload.exp || payload.exp <= Date.now()) return false
    return true
  } catch {
    return false
  }
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
