/**
 * Complimentary email whitelist.
 *
 * Priority:
 *   1) Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   2) GitHub Gist (COMPLIMENTARY_GIST_ID + GITHUB_TOKEN)
 *   3) Local disk (ephemeral on Render)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getSupabase, isSupabaseConfigured } from '../supabase/client.js'

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
let activeBackend = 'local-ephemeral'

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
  return (process.env.COMPLIMENTARY_GIST_ID || process.env.USER_DATA_GIST_ID || '').trim()
}

export function isDurableComplimentaryStoreConfigured() {
  return isSupabaseConfigured() || Boolean(gistId() && githubToken())
}

export function getComplimentaryStorageStatus() {
  return {
    durable: isDurableComplimentaryStoreConfigured(),
    backend: activeBackend,
    entryCount: Array.isArray(memory.entries) ? memory.entries.length : 0,
    ready,
    lastPersistError: lastPersistError || null,
    gistConfigured: Boolean(gistId() && githubToken()),
    hint:
      activeBackend === 'supabase'
        ? 'Emails are saved in Supabase Postgres and survive redeploys.'
        : activeBackend === 'github-gist'
          ? 'Emails are saved permanently (GitHub Gist) and survive Render redeploys.'
          : 'Emails are only on temporary disk and are wiped on every redeploy. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.',
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

function rowToEntry(row) {
  return {
    email: normalizeComplimentaryEmail(row.email),
    planType: normalizePlanType(row.plan_type || row.note),
    note: planTypeLabel(normalizePlanType(row.plan_type || row.note)),
    addedAt: row.added_at || null,
  }
}

function entryToRow(entry) {
  return {
    email: normalizeComplimentaryEmail(entry.email),
    plan_type: normalizePlanType(entry.planType || entry.note),
    note: planTypeLabel(normalizePlanType(entry.planType || entry.note)),
    added_at: entry.addedAt || new Date().toISOString(),
  }
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

async function loadFromSupabase() {
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb.from('complimentary_emails').select('*')
  if (error) throw new Error(`Supabase complimentary read failed: ${error.message}`)
  return normalizeData({ entries: (data || []).map(rowToEntry) })
}

async function saveToSupabase(data) {
  const sb = getSupabase()
  if (!sb) return false

  const entries = normalizeData(data).entries
  const rows = entries.map(entryToRow)

  // Replace list: delete removed emails, upsert current
  const { data: existing, error: readErr } = await sb.from('complimentary_emails').select('email')
  if (readErr) throw new Error(`Supabase complimentary read failed: ${readErr.message}`)

  const nextSet = new Set(rows.map((r) => r.email))
  const toDelete = (existing || [])
    .map((r) => r.email)
    .filter((email) => email && !nextSet.has(email))

  if (toDelete.length > 0) {
    const { error: delErr } = await sb.from('complimentary_emails').delete().in('email', toDelete)
    if (delErr) throw new Error(`Supabase complimentary delete failed: ${delErr.message}`)
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await sb
      .from('complimentary_emails')
      .upsert(rows, { onConflict: 'email' })
    if (upsertErr) throw new Error(`Supabase complimentary write failed: ${upsertErr.message}`)
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
 */
export async function initComplimentaryStore() {
  try {
    if (isSupabaseConfigured()) {
      activeBackend = 'supabase'
      const remote = await loadFromSupabase()
      memory = remote || { entries: [] }
      if (memory.entries.length === 0) {
        let source = null
        // Prefer GitHub Gist (production history), then local disk
        if (gistId() && githubToken()) {
          try {
            const fromGist = await fetchGistData()
            if (fromGist?.entries?.length > 0) {
              memory = fromGist
              source = 'github-gist'
            }
          } catch (err) {
            console.warn('[complimentary] gist migrate read failed:', err.message)
          }
        } else {
          console.warn(
            '[complimentary] cannot migrate from Gist — set GITHUB_TOKEN + COMPLIMENTARY_GIST_ID',
          )
        }
        if (memory.entries.length === 0) {
          const local = readLocalData()
          if (local.entries.length > 0) {
            memory = local
            source = 'local-disk'
          }
        }
        if (memory.entries.length > 0) {
          await saveToSupabase(memory)
          console.log(
            `[complimentary] migrated to Supabase from ${source} — ${memory.entries.length} email(s)`,
          )
        } else {
          console.warn(
            '[complimentary] Supabase empty and no Gist/local seed found. '
              + 'Keep GITHUB_TOKEN + COMPLIMENTARY_GIST_ID set, then redeploy or POST /api/admin/migrate-from-gist',
          )
        }
      }
      writeLocal(memory)
      console.log(
        `[complimentary] durable store ready (supabase) — ${memory.entries.length} email(s)`,
      )
    } else if (gistId() && githubToken()) {
      activeBackend = 'github-gist'
      const remote = await fetchGistData()
      memory = remote || { entries: [] }
      writeLocal(memory)
      console.log(
        `[complimentary] durable store ready (gist) — ${memory.entries.length} email(s)`,
      )
    } else {
      activeBackend = 'local-ephemeral'
      memory = readLocalData()
      console.warn(
        '[complimentary] WARNING: no durable store configured. '
        + 'Emails reset on Render redeploy. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.',
      )
      console.log(`[complimentary] local store loaded — ${memory.entries.length} email(s)`)
    }
    lastPersistError = ''
  } catch (err) {
    console.error('[complimentary] init failed, falling back to local:', err.message)
    activeBackend = 'local-ephemeral'
    memory = readLocalData()
    lastPersistError = err.message
  } finally {
    ready = true
  }
  return getComplimentaryStorageStatus()
}

function getData() {
  if (!ready) {
    memory = readLocalData()
  }
  return memory
}

async function persist(data) {
  memory = normalizeData(data)
  writeLocal(memory)

  if (activeBackend === 'supabase' && isSupabaseConfigured()) {
    try {
      await saveToSupabase(memory)
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

  if (activeBackend === 'github-gist' && gistId() && githubToken()) {
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

  lastPersistError = 'Durable store not configured'
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

/** Force import complimentary emails from GitHub Gist into Supabase. */
export async function migrateComplimentaryFromGistToSupabase() {
  if (!isSupabaseConfigured()) {
    throw Object.assign(new Error('Supabase is not configured'), { status: 400 })
  }
  if (!gistId() || !githubToken()) {
    throw Object.assign(
      new Error('Set GITHUB_TOKEN and COMPLIMENTARY_GIST_ID on Render'),
      { status: 400 },
    )
  }

  const fromGist = await fetchGistData()
  if (!fromGist?.entries?.length) {
    throw Object.assign(new Error('Gist has no complimentary-emails.json entries to import'), {
      status: 404,
    })
  }

  memory = normalizeData(fromGist)
  writeLocal(memory)
  activeBackend = 'supabase'
  await saveToSupabase(memory)
  lastPersistError = ''

  const result = { ok: true, source: 'github-gist', entryCount: memory.entries.length }
  console.log(
    `[complimentary] force-migrated from Gist → Supabase — ${result.entryCount} email(s)`,
  )
  return result
}
