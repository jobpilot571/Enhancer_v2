import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USER_DATA_DIR = path.join(__dirname, '../user-data')
const ADMIN_DATA_DIR = path.join(__dirname, '../admin-data')
const COMPLIMENTARY_PATH = path.join(USER_DATA_DIR, 'complimentary-emails.json')
const LEGACY_PATH = path.join(ADMIN_DATA_DIR, 'complimentary-emails.json')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

/** File + env whitelist (normalized emails). */
export function listComplimentaryEmails() {
  const data = getComplimentaryData()
  const fromFile = (Array.isArray(data.entries) ? data.entries : [])
    .map((e) => ({
      email: normalizeComplimentaryEmail(e.email),
      note: String(e.note || '').trim(),
      addedAt: e.addedAt || null,
      source: 'list',
    }))
    .filter((e) => e.email)

  const byEmail = new Map(fromFile.map((e) => [e.email, e]))
  for (const email of envComplimentaryEmails()) {
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        note: 'From COMPLIMENTARY_EMAILS env',
        addedAt: null,
        source: 'env',
      })
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

export function addComplimentaryEmail(email, note = '') {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address'), { status: 400 })
  }
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  const existing = entries.find((e) => normalizeComplimentaryEmail(e.email) === normalized)
  if (existing) {
    existing.note = String(note || existing.note || '').trim()
    saveComplimentaryData({ entries })
    return {
      email: normalized,
      note: existing.note,
      addedAt: existing.addedAt || null,
      updated: true,
    }
  }
  const entry = {
    email: normalized,
    note: String(note || '').trim(),
    addedAt: new Date().toISOString(),
  }
  entries.push(entry)
  saveComplimentaryData({ entries })
  console.log(`[complimentary] granted ${normalized}`)
  return { ...entry, updated: false }
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
