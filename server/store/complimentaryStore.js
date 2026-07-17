import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USER_DATA_DIR = path.join(__dirname, '../user-data')
const ADMIN_DATA_DIR = path.join(__dirname, '../admin-data')
const COMPLIMENTARY_PATH = path.join(USER_DATA_DIR, 'complimentary-emails.json')
const LEGACY_PATH = path.join(ADMIN_DATA_DIR, 'complimentary-emails.json')
const GIST_FILENAME = 'complimentary-emails.json'

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

/** In-memory source of truth (loaded from durable store on boot). */
let memory = { entries: [] }
let ready = false
let lastPersistError = ''

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

function writeLocal(data) {
  ensureDirs()
  fs.writeFileSync(COMPLIMENTARY_PATH, JSON.stringify(data, null, 2))
}

export function normalizeComplimentaryEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function normalizePlanType(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (PLAN_TYPE_IDS.has(raw)) return raw
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

function githubToken() {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
}

function gistId() {
  return (process.env.COMPLIMENTARY_GIST_ID || '').trim()
}

export function isDurableComplimentaryStoreConfigured() {
  return Boolean(gistId() && githubToken())
}

export function getComplimentaryStorageStatus() {
  return {
    durable: isDurableComplimentaryStoreConfigured(),
    backend: isDurableComplimentaryStoreConfigured() ? 'github-gist' : 'local-ephemeral',
    entryCount: Array.isArray(memory.entries) ? memory.entries.length : 0,
    ready,
    lastPersistError: lastPersistError || null,
    hint: isDurableComplimentaryStoreConfigured()
      ? 'Emails are saved permanently (GitHub Gist) and survive Render redeploys.'
      : 'Emails are only on Render’s temporary disk and are wiped on every redeploy. Set COMPLIMENTARY_GIST_ID + GITHUB_TOKEN for permanent storage.',
  }
}

/** Optional comma-separated backup emails in env (always merged). */
function envComplimentaryEmails() {
  return (process.env.COMPLIMENTARY_EMAILS || '')
    .split(',')
    .map((e) => normalizeComplimentaryEmail(e))
    .filter(Boolean)
}

function shapeEntry(e, source = 'list') {
  const planType = normalizePlanType(e.planType || e.note)
  return {
    email: normalizeComplimentaryEmail(e.email),
    planType,
    planTypeLabel: planTypeLabel(planType),
    note: planTypeLabel(planType),
    addedAt: e.addedAt || null,
    source,
  }
}

function normalizeData(data) {
  const entries = (Array.isArray(data?.entries) ? data.entries : [])
    .map((e) => ({
      email: normalizeComplimentaryEmail(e.email),
      planType: normalizePlanType(e.planType || e.note),
      note: planTypeLabel(normalizePlanType(e.planType || e.note)),
      addedAt: e.addedAt || null,
    }))
    .filter((e) => e.email)
  return { entries }
}

async function fetchGistData() {
  const id = gistId()
  const token = githubToken()
  if (!id || !token) return null

  const res = await fetch(`https://api.github.com/gists/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jobpilot-ai-admin',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub Gist read failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const gist = await res.json()
  const file = gist.files?.[GIST_FILENAME] || Object.values(gist.files || {})[0]
  if (!file?.content) return { entries: [] }
  try {
    return normalizeData(JSON.parse(file.content))
  } catch {
    return { entries: [] }
  }
}

async function saveGistData(data) {
  const id = gistId()
  const token = githubToken()
  if (!id || !token) return false

  const res = await fetch(`https://api.github.com/gists/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jobpilot-ai-admin',
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(normalizeData(data), null, 2),
        },
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub Gist write failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return true
}

function readLocalData() {
  if (fs.existsSync(COMPLIMENTARY_PATH)) {
    return normalizeData(readJson(COMPLIMENTARY_PATH, { entries: [] }))
  }
  if (fs.existsSync(LEGACY_PATH)) {
    const legacy = normalizeData(readJson(LEGACY_PATH, { entries: [] }))
    writeLocal(legacy)
    console.log('[complimentary] migrated whitelist from admin-data → user-data')
    return legacy
  }
  return { entries: [] }
}

/**
 * Load durable list into memory. Call once on server boot.
 * Prefers GitHub Gist when configured; otherwise local file (ephemeral on Render).
 */
export async function initComplimentaryStore() {
  try {
    if (isDurableComplimentaryStoreConfigured()) {
      const remote = await fetchGistData()
      memory = remote || { entries: [] }
      writeLocal(memory)
      console.log(
        `[complimentary] durable store ready (gist) — ${memory.entries.length} email(s)`,
      )
    } else {
      memory = readLocalData()
      console.warn(
        '[complimentary] WARNING: no durable store configured. '
        + 'Emails reset on Render redeploy. Set COMPLIMENTARY_GIST_ID + GITHUB_TOKEN.',
      )
      console.log(`[complimentary] local store loaded — ${memory.entries.length} email(s)`)
    }
    lastPersistError = ''
  } catch (err) {
    console.error('[complimentary] init failed, falling back to local:', err.message)
    memory = readLocalData()
    lastPersistError = err.message
  } finally {
    ready = true
  }
  return getComplimentaryStorageStatus()
}

function getData() {
  if (!ready) {
    // Sync fallback before init finishes (shouldn't happen often)
    memory = readLocalData()
  }
  return memory
}

async function persist(data) {
  memory = normalizeData(data)
  writeLocal(memory)
  if (!isDurableComplimentaryStoreConfigured()) {
    lastPersistError = 'Durable store not configured'
    return memory
  }
  try {
    await saveGistData(memory)
    lastPersistError = ''
  } catch (err) {
    lastPersistError = err.message
    console.error('[complimentary] durable persist failed:', err.message)
    throw Object.assign(
      new Error(`Saved locally but permanent storage failed: ${err.message}`),
      { status: 502 },
    )
  }
  return memory
}

/** File + env whitelist (normalized emails). */
export function listComplimentaryEmails() {
  const fromFile = getData().entries.map((e) => shapeEntry(e, 'list'))
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
  return getData().entries.some((e) => e.email === normalized)
}

export function getComplimentaryPlanType(email) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized) return null
  const entry = getData().entries.find((e) => e.email === normalized)
  if (entry) return normalizePlanType(entry.planType || entry.note)
  if (envComplimentaryEmails().includes(normalized)) return DEFAULT_PLAN_TYPE
  return null
}

export async function addComplimentaryEmail(email, planType = DEFAULT_PLAN_TYPE) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address'), { status: 400 })
  }
  const type = normalizePlanType(planType)
  const data = { entries: [...getData().entries] }
  const existing = data.entries.find((e) => e.email === normalized)
  if (existing) {
    existing.planType = type
    existing.note = planTypeLabel(type)
    await persist(data)
    return { ...shapeEntry(existing), updated: true }
  }
  const entry = {
    email: normalized,
    planType: type,
    note: planTypeLabel(type),
    addedAt: new Date().toISOString(),
  }
  data.entries.push(entry)
  await persist(data)
  console.log(`[complimentary] granted ${normalized} planType=${type}`)
  return { ...shapeEntry(entry), updated: false }
}

export async function removeComplimentaryEmail(email) {
  const normalized = normalizeComplimentaryEmail(email)
  if (envComplimentaryEmails().includes(normalized)) {
    throw Object.assign(
      new Error('This email is set in COMPLIMENTARY_EMAILS env — remove it there instead'),
      { status: 400 },
    )
  }
  const data = { entries: [...getData().entries] }
  const next = data.entries.filter((e) => e.email !== normalized)
  if (next.length === data.entries.length) {
    throw Object.assign(new Error('Email is not on the complimentary list'), { status: 404 })
  }
  await persist({ entries: next })
  console.log(`[complimentary] revoked ${normalized}`)
  return { ok: true }
}
