import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import {
  isComplimentaryEmail,
  getComplimentaryPlanType,
  normalizePlanType,
  planTypeLabel,
} from './complimentaryStore.js'
import { getUsersData, setUsersData } from './durableUserData.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')
const OTP_PATH = path.join(DATA_DIR, 'otps.json')

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_MS = 45 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCRYPT_KEYLEN = 64

/** Optional revoke list for logout (in-memory; signed tokens still expire by TTL). */
/** @type {Set<string>} */
const revokedSessions = new Set()

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJson(filePath, fallback) {
  ensureDirs()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2))
    return structuredClone(fallback)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return structuredClone(fallback)
  }
}

function writeJson(filePath, data) {
  ensureDirs()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt)
  const a = Buffer.from(hash)
  const b = Buffer.from(expectedHash)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex')
}

export function publicUser(user, usage = null) {
  if (!user) return null
  const plan = user.plan || 'free'
  const complimentary = Boolean(user.complimentary) || isComplimentaryEmail(user.email)
  const typeFromUser = user.complimentaryPlanType
  const typeFromList = getComplimentaryPlanType(user.email)
  const planType = complimentary
    ? normalizePlanType(typeFromUser || typeFromList || 'friend')
    : null
  const base = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    plan,
    complimentary,
    complimentaryPlanType: planType,
    planLabel: complimentary ? `${planTypeLabel(planType)} plan` : (plan === 'free' ? 'Free plan' : `${plan} plan`),
    hasPassword: Boolean(user.passwordHash),
    authProvider: user.googleId ? (user.passwordHash ? 'hybrid' : 'google') : 'email',
    createdAt: user.createdAt,
  }
  if (usage) base.usage = usage
  return base
}

function initialPlanForEmail(email) {
  return isComplimentaryEmail(email) ? 'professional' : 'free'
}

/**
 * Grant or revoke complimentary Professional access on an existing account.
 * Returns public user or null if no account yet.
 */
export function setUserComplimentaryAccess(email, enabled, planType = 'friend') {
  const normalized = normalizeEmail(email)
  const data = getUsers()
  const user = data.users.find((u) => u.email === normalized)
  if (!user) return null

  if (enabled) {
    const type = normalizePlanType(planType)
    user.plan = 'professional'
    user.complimentary = true
    user.complimentaryPlanType = type
    user.complimentaryNote = planTypeLabel(type)
    user.complimentaryAt = new Date().toISOString()
  } else if (user.complimentary || user.plan === 'professional') {
    // Only downgrade complimentary grants — leave real paid plans alone later
    user.plan = 'free'
    user.complimentary = false
    user.complimentaryPlanType = null
    user.complimentaryNote = ''
    user.complimentaryAt = null
  }
  saveUsers(data)
  console.log(`[complimentary] user ${normalized} → plan=${user.plan} type=${user.complimentaryPlanType || 'none'}`)
  return publicUser(user)
}

/** Keep stored plan in sync with whitelist on every session load. */
function syncComplimentaryPlan(user) {
  if (!user?.email) return user
  const complimentary = isComplimentaryEmail(user.email) || Boolean(user.complimentary)
  if (!complimentary) return user

  const type = normalizePlanType(
    getComplimentaryPlanType(user.email) || user.complimentaryPlanType || 'friend',
  )
  let changed = false
  if (user.plan !== 'professional' && user.plan !== 'enterprise') {
    user.plan = 'professional'
    changed = true
  }
  if (!user.complimentary) {
    user.complimentary = true
    changed = true
  }
  if (user.complimentaryPlanType !== type) {
    user.complimentaryPlanType = type
    user.complimentaryNote = planTypeLabel(type)
    changed = true
  }
  if (changed) {
    const all = getUsers()
    const idx = all.users.findIndex((u) => u.id === user.id)
    if (idx >= 0) {
      all.users[idx].plan = user.plan
      all.users[idx].complimentary = true
      all.users[idx].complimentaryPlanType = type
      all.users[idx].complimentaryNote = planTypeLabel(type)
      saveUsers(all)
    }
  }
  return user
}

function getUsers() {
  return getUsersData()
}

function saveUsers(data) {
  setUsersData(data)
}

function getOtps() {
  return readJson(OTP_PATH, { otps: {} })
}

function saveOtps(data) {
  writeJson(OTP_PATH, data)
}

function getSessionSecret() {
  return (
    process.env.AUTH_SECRET?.trim()
    || process.env.ADMIN_SECRET?.trim()
    || process.env.ADMIN_PASSWORD?.trim()
    || process.env.RESEND_API_KEY?.trim()
    || 'jobpilot-dev-auth-secret'
  )
}

function signSessionPayload(payloadB64) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('hex')
}

function cleanExpiredOtps(otps) {
  const now = Date.now()
  let changed = false
  for (const [email, entry] of Object.entries(otps)) {
    if (!entry?.expiresAt || entry.expiresAt <= now) {
      delete otps[email]
      changed = true
    }
  }
  return changed
}

export function createSession(userId) {
  const payload = {
    uid: userId,
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${signSessionPayload(payloadB64)}`
}

export function revokeSession(token) {
  if (token) revokedSessions.add(token)
}

export function getSessionUser(token) {
  if (!token || typeof token !== 'string') return null
  if (revokedSessions.has(token)) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, mac] = parts
  if (!payloadB64 || !mac) return null

  const expected = signSessionPayload(payloadB64)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  let payload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.uid || !payload.exp || payload.exp <= Date.now()) return null

  const user = findUserById(payload.uid)
  if (!user) return null
  // Lazy-migrate older records
  if (!user.plan) {
    user.plan = 'free'
    const all = getUsers()
    const idx = all.users.findIndex((u) => u.id === user.id)
    if (idx >= 0) {
      all.users[idx].plan = 'free'
      saveUsers(all)
    }
  }
  syncComplimentaryPlan(user)
  return publicUser(user)
}

export function findUserByEmail(email) {
  const normalized = normalizeEmail(email)
  const { users } = getUsers()
  return users.find((u) => u.email === normalized) || null
}

export function findUserById(id) {
  const { users } = getUsers()
  return users.find((u) => u.id === id) || null
}

export function findUserByGoogleId(googleId) {
  if (!googleId) return null
  const { users } = getUsers()
  return users.find((u) => u.googleId === googleId) || null
}

export function createUser({ name, email, password }) {
  const normalized = normalizeEmail(email)
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error('Enter a valid email address.')
    err.status = 400
    throw err
  }
  if (!String(name || '').trim()) {
    const err = new Error('Full name is required.')
    err.status = 400
    throw err
  }
  if (String(password || '').length < 8) {
    const err = new Error('Password must be at least 8 characters.')
    err.status = 400
    throw err
  }
  if (findUserByEmail(normalized)) {
    const err = new Error('An account with this email already exists.')
    err.status = 409
    throw err
  }

  const { salt, hash } = hashPassword(password)
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normalized,
    passwordSalt: salt,
    passwordHash: hash,
    googleId: null,
    plan: initialPlanForEmail(normalized),
    complimentary: isComplimentaryEmail(normalized),
    complimentaryPlanType: isComplimentaryEmail(normalized)
      ? (getComplimentaryPlanType(normalized) || 'friend')
      : null,
    emailVerifiedAt: null,
    createdAt: new Date().toISOString(),
  }

  const data = getUsers()
  data.users.push(user)
  saveUsers(data)
  return publicUser(user)
}

/** Update an existing unverified account and reset credentials for a fresh OTP signup. */
export function updateUnverifiedSignup(email, { name, password }) {
  const normalized = normalizeEmail(email)
  const data = getUsers()
  const user = data.users.find((u) => u.email === normalized)
  if (!user) {
    const err = new Error('Account not found.')
    err.status = 404
    throw err
  }
  if (user.emailVerifiedAt) {
    const err = new Error('An account with this email already exists. Sign in instead.')
    err.status = 409
    throw err
  }
  if (!String(name || '').trim()) {
    const err = new Error('Full name is required.')
    err.status = 400
    throw err
  }
  if (String(password || '').length < 8) {
    const err = new Error('Password must be at least 8 characters.')
    err.status = 400
    throw err
  }
  const { salt, hash } = hashPassword(password)
  user.name = String(name).trim()
  user.passwordSalt = salt
  user.passwordHash = hash
  user.plan = user.plan || 'free'
  saveUsers(data)
  return publicUser(user)
}

export function upsertGoogleUser({ googleId, email, name }) {
  const normalized = normalizeEmail(email)
  const data = getUsers()

  let user = data.users.find((u) => u.googleId === googleId)
  if (!user) {
    user = data.users.find((u) => u.email === normalized)
  }

  if (user) {
    user.googleId = googleId
    // Do NOT auto-verify — email OTP is required for first-time / unverified accounts
    if (!user.plan) user.plan = initialPlanForEmail(normalized)
    syncComplimentaryPlan(user)
    if (name && (!user.name || user.name === normalized.split('@')[0])) {
      user.name = String(name).trim()
    }
    saveUsers(data)
    return { user: publicUser(user), created: false }
  }

  user = {
    id: crypto.randomUUID(),
    name: String(name || normalized.split('@')[0]).trim(),
    email: normalized,
    passwordSalt: null,
    passwordHash: null,
    googleId,
    plan: initialPlanForEmail(normalized),
    complimentary: isComplimentaryEmail(normalized),
    complimentaryPlanType: isComplimentaryEmail(normalized)
      ? (getComplimentaryPlanType(normalized) || 'friend')
      : null,
    emailVerifiedAt: null,
    createdAt: new Date().toISOString(),
  }
  data.users.push(user)
  saveUsers(data)
  return { user: publicUser(user), created: true }
}

export function authenticateUser(email, password) {
  const user = findUserByEmail(email)
  if (!user) {
    const err = new Error('No account found with this email. Please sign up first.')
    err.status = 404
    err.code = 'NOT_REGISTERED'
    err.email = normalizeEmail(email)
    throw err
  }
  if (!user.passwordHash || !user.passwordSalt) {
    const err = new Error('This account uses Google sign-in. Continue with Google.')
    err.status = 401
    err.code = 'GOOGLE_ONLY'
    throw err
  }
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    const err = new Error('Incorrect password. Try again.')
    err.status = 401
    err.code = 'INVALID_PASSWORD'
    throw err
  }
  return user
}

export function markEmailVerified(email) {
  const data = getUsers()
  const normalized = normalizeEmail(email)
  const user = data.users.find((u) => u.email === normalized)
  if (!user) {
    const err = new Error('Account not found.')
    err.status = 404
    throw err
  }
  user.emailVerifiedAt = new Date().toISOString()
  saveUsers(data)
  return publicUser(user)
}

/**
 * Local-only developer account (verified + professional). Used when LOCAL_DEV_AUTH=true.
 * Never enable LOCAL_DEV_AUTH on Render/production.
 */
export function ensureLocalDevUser() {
  const email = 'local-dev@jobpilot.local'
  const data = getUsers()
  let user = data.users.find((u) => u.email === email)
  if (!user) {
    const { salt, hash } = hashPassword('local-dev-password-not-for-prod')
    user = {
      id: crypto.randomUUID(),
      name: 'Local Developer',
      email,
      passwordSalt: salt,
      passwordHash: hash,
      googleId: null,
      plan: 'professional',
      complimentary: true,
      complimentaryPlanType: 'friend',
      emailVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }
    data.users.push(user)
  } else {
    user.plan = 'professional'
    user.complimentary = true
    user.complimentaryPlanType = user.complimentaryPlanType || 'friend'
    user.emailVerifiedAt = user.emailVerifiedAt || new Date().toISOString()
    user.name = user.name || 'Local Developer'
  }
  saveUsers(data)
  return user
}

export function createOtpChallenge(email, { force = false } = {}) {
  const normalized = normalizeEmail(email)
  const data = getOtps()
  cleanExpiredOtps(data.otps)

  const existing = data.otps[normalized]
  if (!force && existing?.sentAt && Date.now() - existing.sentAt < OTP_RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000)
    const err = new Error(`Please wait ${waitSec}s before requesting another code.`)
    err.status = 429
    throw err
  }

  const code = String(crypto.randomInt(100000, 1000000))
  data.otps[normalized] = {
    codeHash: hashOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  }
  saveOtps(data)
  return { email: normalized, code, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) }
}

export function verifyOtpChallenge(email, code) {
  const normalized = normalizeEmail(email)
  const data = getOtps()
  cleanExpiredOtps(data.otps)
  const entry = data.otps[normalized]

  if (!entry) {
    const err = new Error('Verification code expired or not found. Request a new one.')
    err.status = 400
    throw err
  }
  if (entry.expiresAt <= Date.now()) {
    delete data.otps[normalized]
    saveOtps(data)
    const err = new Error('Verification code expired. Request a new one.')
    err.status = 400
    throw err
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    delete data.otps[normalized]
    saveOtps(data)
    const err = new Error('Too many attempts. Request a new code.')
    err.status = 429
    throw err
  }

  entry.attempts += 1
  const ok = entry.codeHash === hashOtp(String(code || '').trim())
  if (!ok) {
    saveOtps(data)
    const remaining = OTP_MAX_ATTEMPTS - entry.attempts
    const err = new Error(
      remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
        : 'Too many attempts. Request a new code.'
    )
    err.status = 400
    throw err
  }

  delete data.otps[normalized]
  saveOtps(data)
  return true
}

/** Persist Basics + Education only (experience, summary, refs, template stay session-only). */
function sanitizeBuilderMemory(formData) {
  if (!formData || typeof formData !== 'object') return null
  const edu = formData.education || {}
  return {
    name: String(formData.name || '').slice(0, 120),
    email: String(formData.email || '').slice(0, 160),
    phone: String(formData.phone || '').slice(0, 40),
    linkedin: String(formData.linkedin || '').slice(0, 200),
    role: String(formData.role || '').slice(0, 120),
    yearsOfExperience: String(formData.yearsOfExperience ?? '').slice(0, 8),
    companyCount: String(formData.companyCount || '1').slice(0, 4),
    education: {
      school: String(edu.school || '').slice(0, 160),
      course: String(edu.course || '').slice(0, 120),
      degree: String(edu.degree || '').slice(0, 120),
      startDate: String(edu.startDate || '').slice(0, 40),
      endDate: String(edu.endDate || '').slice(0, 40),
    },
  }
}

export function getBuilderMemory(userId) {
  const user = findUserById(userId)
  if (!user?.builderMemory) return null
  return {
    formData: user.builderMemory.formData || null,
    updatedAt: user.builderMemory.updatedAt || null,
  }
}

export function saveBuilderMemory(userId, formData) {
  const cleaned = sanitizeBuilderMemory(formData)
  if (!cleaned) {
    const err = new Error('Nothing to save.')
    err.status = 400
    throw err
  }
  const data = getUsers()
  const idx = data.users.findIndex((u) => u.id === userId)
  if (idx < 0) {
    const err = new Error('User not found')
    err.status = 404
    throw err
  }
  const updatedAt = new Date().toISOString()
  data.users[idx].builderMemory = { formData: cleaned, updatedAt }
  saveUsers(data)
  return { formData: cleaned, updatedAt }
}

export function clearBuilderMemory(userId) {
  const data = getUsers()
  const idx = data.users.findIndex((u) => u.id === userId)
  if (idx < 0) {
    const err = new Error('User not found')
    err.status = 404
    throw err
  }
  delete data.users[idx].builderMemory
  saveUsers(data)
  return { ok: true }
}

export { normalizeEmail }
