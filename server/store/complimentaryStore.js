import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USER_DATA_DIR = path.join(__dirname, '../user-data')
const ADMIN_DATA_DIR = path.join(__dirname, '../admin-data')
const COMPLIMENTARY_PATH = path.join(USER_DATA_DIR, 'complimentary-emails.json')
const LEGACY_PATH = path.join(ADMIN_DATA_DIR, 'complimentary-emails.json')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Complimentary access plan types (display labels for users). */
export const COMPLIMENTARY_PLAN_TYPES = [
  { id: 'employee', label: 'Employee' },
  { id: 'friend', label: 'Friend' },
  { id: 'admin', label: 'Admin' },
  { id: 'student', label: 'Student' },
]

const PLAN_TYPE_IDS = new Set(COMPLIMENTARY_PLAN_TYPES.map((p) => p.id))
const DEFAULT_PLAN_TYPE = 'friend'

function ensureDirs() {
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true })
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return structuredClone(fallback)
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

export function normalizeComplimentaryEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function normalizePlanType(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (PLAN_TYPE_IDS.has(raw)) return raw
  // Migrate old free-text notes
  if (raw.includes('employee')) return 'employee'
  if (raw.includes('admin')) return 'admin'
  if (raw.includes('student')) return 'student'
  if (raw.includes('friend') || raw.includes('relative')) return 'friend'
  return DEFAULT_PLAN_TYPE
}

export function planTypeLabel(planType) {
  const id = normalizePlanType(planType)
  return COMPLIMENTARY_PLAN_TYPES.find((p) => p.id === id)?.label || 'Friend'
}

/** Optional comma-separated backup list in env (survives Render disk resets). */
function envComplimentaryEmails() {
  return (process.env.COMPLIMENTARY_EMAILS || '')
    .split(',')
    .map((e) => normalizeComplimentaryEmail(e))
    .filter(Boolean)
}

function migrateLegacyIfNeeded() {
  ensureDirs()
  if (fs.existsSync(COMPLIMENTARY_PATH)) return
  if (!fs.existsSync(LEGACY_PATH)) return
  try {
    const legacy = readJson(LEGACY_PATH, { entries: [] })
    writeJson(COMPLIMENTARY_PATH, legacy)
    console.log('[complimentary] migrated whitelist from admin-data → user-data')
  } catch (err) {
    console.warn('[complimentary] legacy migrate failed:', err.message)
  }
}

function getComplimentaryData() {
  migrateLegacyIfNeeded()
  ensureDirs()
  if (!fs.existsSync(COMPLIMENTARY_PATH)) {
    const empty = { entries: [] }
    writeJson(COMPLIMENTARY_PATH, empty)
    return empty
  }
  return readJson(COMPLIMENTARY_PATH, { entries: [] })
}

function saveComplimentaryData(data) {
  writeJson(COMPLIMENTARY_PATH, data)
}

function shapeEntry(e, source = 'list') {
  const planType = normalizePlanType(e.planType || e.note)
  return {
    email: normalizeComplimentaryEmail(e.email),
    planType,
    planTypeLabel: planTypeLabel(planType),
    // Keep note for backward-compatible clients
    note: planTypeLabel(planType),
    addedAt: e.addedAt || null,
    source,
  }
}

/** File + env whitelist (normalized emails). */
export function listComplimentaryEmails() {
  const data = getComplimentaryData()
  const fromFile = (Array.isArray(data.entries) ? data.entries : [])
    .map((e) => shapeEntry(e, 'list'))
    .filter((e) => e.email)

  const byEmail = new Map(fromFile.map((e) => [e.email, e]))
  for (const email of envComplimentaryEmails()) {
    if (!byEmail.has(email)) {
      byEmail.set(email, shapeEntry({ email, planType: DEFAULT_PLAN_TYPE }, 'env'))
    }
  }

  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}

export function isComplimentaryEmail(email) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized) return false
  if (envComplimentaryEmails().includes(normalized)) return true
  const data = getComplimentaryData()
  return (Array.isArray(data.entries) ? data.entries : []).some(
    (e) => normalizeComplimentaryEmail(e.email) === normalized,
  )
}

export function getComplimentaryPlanType(email) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized) return null
  const data = getComplimentaryData()
  const entry = (Array.isArray(data.entries) ? data.entries : []).find(
    (e) => normalizeComplimentaryEmail(e.email) === normalized,
  )
  if (entry) return normalizePlanType(entry.planType || entry.note)
  if (envComplimentaryEmails().includes(normalized)) return DEFAULT_PLAN_TYPE
  return null
}

export function addComplimentaryEmail(email, planType = DEFAULT_PLAN_TYPE) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address'), { status: 400 })
  }
  const type = normalizePlanType(planType)
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  const existing = entries.find((e) => normalizeComplimentaryEmail(e.email) === normalized)
  if (existing) {
    existing.planType = type
    existing.note = planTypeLabel(type)
    saveComplimentaryData({ entries })
    return { ...shapeEntry(existing), updated: true }
  }
  const entry = {
    email: normalized,
    planType: type,
    note: planTypeLabel(type),
    addedAt: new Date().toISOString(),
  }
  entries.push(entry)
  saveComplimentaryData({ entries })
  console.log(`[complimentary] granted ${normalized} planType=${type}`)
  return { ...shapeEntry(entry), updated: false }
}

export function removeComplimentaryEmail(email) {
  const normalized = normalizeComplimentaryEmail(email)
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  const next = entries.filter((e) => normalizeComplimentaryEmail(e.email) !== normalized)
  if (next.length === entries.length && !envComplimentaryEmails().includes(normalized)) {
    throw Object.assign(new Error('Email is not on the complimentary list'), { status: 404 })
  }
  if (envComplimentaryEmails().includes(normalized)) {
    throw Object.assign(
      new Error('This email is set in COMPLIMENTARY_EMAILS env — remove it there instead'),
      { status: 400 },
    )
  }
  saveComplimentaryData({ entries: next })
  console.log(`[complimentary] revoked ${normalized}`)
  return { ok: true }
}
