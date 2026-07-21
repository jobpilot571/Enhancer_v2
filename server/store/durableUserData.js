/**
 * Durable JSON blobs for users + usage.
 *
 * Priority:
 *   1) Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — recommended
 *   2) GitHub Gist (GITHUB_TOKEN + COMPLIMENTARY_GIST_ID / USER_DATA_GIST_ID)
 *   3) Local disk only (ephemeral on Render)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  getSupabase,
  isSupabaseConfigured,
  rowToUser,
  userToRow,
  usageMapToRows,
  usageRowsToMap,
} from '../supabase/client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')

const USERS_FILE = 'jobpilot-users.json'
const USAGE_FILE = 'jobpilot-usage.json'
const LOCAL_USERS = path.join(DATA_DIR, 'users.json')
const LOCAL_USAGE = path.join(DATA_DIR, 'usage.json')

let ready = false
let lastPersistError = ''
let activeBackend = 'local-ephemeral'

/** @type {{ users: any[] }} */
let usersMemory = { users: [] }
/** @type {{ usage: Record<string, any> }} */
let usageMemory = { usage: {} }

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function githubToken() {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
}

function gistId() {
  return (process.env.USER_DATA_GIST_ID || process.env.COMPLIMENTARY_GIST_ID || '').trim()
}

export function isDurableUserStoreConfigured() {
  return isSupabaseConfigured() || Boolean(gistId() && githubToken())
}

export function getUserStorageStatus() {
  const durable = isDurableUserStoreConfigured()
  return {
    durable,
    backend: activeBackend,
    userCount: Array.isArray(usersMemory.users) ? usersMemory.users.length : 0,
    usageKeys: Object.keys(usageMemory.usage || {}).length,
    ready,
    lastPersistError: lastPersistError || null,
    hint:
      activeBackend === 'supabase'
        ? 'Users and usage are saved in Supabase Postgres and survive redeploys.'
        : activeBackend === 'github-gist'
          ? 'Users and usage are saved permanently (GitHub Gist) and survive Render redeploys.'
          : 'Users/usage are on temporary disk and reset on redeploy. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (recommended).',
  }
}

function readLocalJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return structuredClone(fallback)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return structuredClone(fallback)
  }
}

function writeLocalUsers(data) {
  ensureDirs()
  fs.writeFileSync(LOCAL_USERS, JSON.stringify(data, null, 2))
}

function writeLocalUsage(data) {
  ensureDirs()
  fs.writeFileSync(LOCAL_USAGE, JSON.stringify(data, null, 2))
}

function normalizeUsers(data) {
  return { users: Array.isArray(data?.users) ? data.users : [] }
}

function normalizeUsage(data) {
  return { usage: data?.usage && typeof data.usage === 'object' ? data.usage : {} }
}

async function fetchGistFiles() {
  const id = gistId()
  const token = githubToken()
  if (!id || !token) return null

  const res = await fetch(`https://api.github.com/gists/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jobpilot-ai-auth',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub Gist read failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()).files || {}
}

function parseGistFile(files, name, fallback) {
  const file = files?.[name]
  if (!file?.content) return structuredClone(fallback)
  try {
    return JSON.parse(file.content)
  } catch {
    return structuredClone(fallback)
  }
}

async function patchGistFiles(filesPayload) {
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
      'User-Agent': 'jobpilot-ai-auth',
    },
    body: JSON.stringify({ files: filesPayload }),
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

  const { data: userRows, error: usersErr } = await sb.from('users').select('*')
  if (usersErr) throw new Error(`Supabase users read failed: ${usersErr.message}`)

  const { data: usageRows, error: usageErr } = await sb.from('usage_monthly').select('*')
  if (usageErr) throw new Error(`Supabase usage read failed: ${usageErr.message}`)

  return {
    users: (userRows || []).map(rowToUser).filter(Boolean),
    usage: usageRowsToMap(usageRows),
  }
}

async function persistToSupabase() {
  const sb = getSupabase()
  if (!sb) return false

  const userRows = usersMemory.users.map(userToRow)
  if (userRows.length > 0) {
    const { error: usersErr } = await sb.from('users').upsert(userRows, { onConflict: 'id' })
    if (usersErr) throw new Error(`Supabase users write failed: ${usersErr.message}`)
  }

  const knownUsers = new Set(usersMemory.users.map((u) => u.id))
  const usageRows = usageMapToRows(usageMemory.usage).filter((r) => knownUsers.has(r.user_id))
  if (usageRows.length > 0) {
    const { error: usageErr } = await sb
      .from('usage_monthly')
      .upsert(usageRows, { onConflict: 'user_id,month' })
    if (usageErr) throw new Error(`Supabase usage write failed: ${usageErr.message}`)
  }

  return true
}

function seedFromLocalIfEmpty(users, usage) {
  const localUsers = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
  const localUsage = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
  let nextUsers = users
  let nextUsage = usage
  if (users.length === 0 && localUsers.users.length > 0) {
    nextUsers = localUsers.users
  }
  if (Object.keys(usage).length === 0 && Object.keys(localUsage.usage).length > 0) {
    nextUsage = localUsage.usage
  }
  return { users: nextUsers, usage: nextUsage }
}

/** One-time: fill empty Supabase from GitHub Gist (then local). */
async function seedFromGistOrLocalIfEmpty(users, usage) {
  let nextUsers = users
  let nextUsage = usage
  let source = null

  const needUsers = users.length === 0
  const needUsage = Object.keys(usage).length === 0
  if (!needUsers && !needUsage) {
    return { users: nextUsers, usage: nextUsage, source: null }
  }

  if (gistId() && githubToken()) {
    try {
      const files = await fetchGistFiles()
      const gistUsers = normalizeUsers(parseGistFile(files, USERS_FILE, { users: [] }))
      const gistUsage = normalizeUsage(parseGistFile(files, USAGE_FILE, { usage: {} }))
      if (needUsers && gistUsers.users.length > 0) {
        nextUsers = gistUsers.users
        source = 'github-gist'
      }
      if (needUsage && Object.keys(gistUsage.usage).length > 0) {
        nextUsage = gistUsage.usage
        source = source || 'github-gist'
      }
    } catch (err) {
      console.warn('[auth-store] gist migrate read failed:', err.message)
    }
  }

  if (needUsers && nextUsers.length === 0) {
    const localUsers = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
    if (localUsers.users.length > 0) {
      nextUsers = localUsers.users
      source = source || 'local-disk'
    }
  }
  if (needUsage && Object.keys(nextUsage).length === 0) {
    const localUsage = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
    if (Object.keys(localUsage.usage).length > 0) {
      nextUsage = localUsage.usage
      source = source || 'local-disk'
    }
  }

  return { users: nextUsers, usage: nextUsage, source }
}

export async function initDurableUserStore() {
  try {
    if (isSupabaseConfigured()) {
      activeBackend = 'supabase'
      const remote = await loadFromSupabase()
      const seeded = await seedFromGistOrLocalIfEmpty(remote.users, remote.usage)
      usersMemory = normalizeUsers({ users: seeded.users })
      usageMemory = normalizeUsage({ usage: seeded.usage })
      writeLocalUsers(usersMemory)
      writeLocalUsage(usageMemory)

      // First-time migrate: push seed into empty Supabase
      if (
        (remote.users.length === 0 && usersMemory.users.length > 0)
        || (Object.keys(remote.usage).length === 0 && Object.keys(usageMemory.usage).length > 0)
      ) {
        await persistToSupabase()
        console.log(
          `[auth-store] migrated to Supabase from ${seeded.source || 'seed'} — `
            + `users=${usersMemory.users.length} usageKeys=${Object.keys(usageMemory.usage).length}`,
        )
      }

      console.log(
        `[auth-store] durable ready (supabase) — users=${usersMemory.users.length} usageKeys=${Object.keys(usageMemory.usage).length}`,
      )
    } else if (gistId() && githubToken()) {
      activeBackend = 'github-gist'
      const files = await fetchGistFiles()
      usersMemory = normalizeUsers(parseGistFile(files, USERS_FILE, { users: [] }))
      usageMemory = normalizeUsage(parseGistFile(files, USAGE_FILE, { usage: {} }))

      const seeded = seedFromLocalIfEmpty(usersMemory.users, usageMemory.usage)
      usersMemory = normalizeUsers({ users: seeded.users })
      usageMemory = normalizeUsage({ usage: seeded.usage })

      writeLocalUsers(usersMemory)
      writeLocalUsage(usageMemory)
      await patchGistFiles({
        [USERS_FILE]: { content: JSON.stringify(usersMemory, null, 2) },
        [USAGE_FILE]: { content: JSON.stringify(usageMemory, null, 2) },
      })
      console.log(
        `[auth-store] durable ready (gist) — users=${usersMemory.users.length} usageKeys=${Object.keys(usageMemory.usage).length}`,
      )
    } else {
      activeBackend = 'local-ephemeral'
      usersMemory = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
      usageMemory = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
      console.warn(
        '[auth-store] WARNING: no durable store. Users/usage reset on Render redeploy. '
          + 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (recommended).',
      )
      console.log(
        `[auth-store] local loaded — users=${usersMemory.users.length} usageKeys=${Object.keys(usageMemory.usage).length}`,
      )
    }
    lastPersistError = ''
  } catch (err) {
    console.error('[auth-store] init failed, using local:', err.message)
    activeBackend = 'local-ephemeral'
    usersMemory = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
    usageMemory = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
    lastPersistError = err.message
  } finally {
    ready = true
  }
  return getUserStorageStatus()
}

export function getUsersData() {
  if (!ready) {
    usersMemory = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
  }
  return usersMemory
}

export function getUsageData() {
  if (!ready) {
    usageMemory = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
  }
  return usageMemory
}

let persistTimer = null
let persistChain = Promise.resolve()

async function flushPersist() {
  writeLocalUsers(usersMemory)
  writeLocalUsage(usageMemory)

  if (activeBackend === 'supabase' && isSupabaseConfigured()) {
    try {
      await persistToSupabase()
      lastPersistError = ''
    } catch (err) {
      lastPersistError = err.message
      console.error('[auth-store] durable persist failed:', err.message)
    }
    return
  }

  if (activeBackend === 'github-gist' && gistId() && githubToken()) {
    try {
      await patchGistFiles({
        [USERS_FILE]: { content: JSON.stringify(usersMemory, null, 2) },
        [USAGE_FILE]: { content: JSON.stringify(usageMemory, null, 2) },
      })
      lastPersistError = ''
    } catch (err) {
      lastPersistError = err.message
      console.error('[auth-store] durable persist failed:', err.message)
    }
    return
  }

  lastPersistError = 'Durable store not configured'
}

/** Schedule durable persist (debounced). Local disk write is immediate. */
export function scheduleUserDataPersist() {
  writeLocalUsers(usersMemory)
  writeLocalUsage(usageMemory)
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistChain = persistChain.then(flushPersist).catch(() => {})
  }, 400)
}

export function setUsersData(data) {
  usersMemory = normalizeUsers(data)
  scheduleUserDataPersist()
  return usersMemory
}

export function setUsageData(data) {
  usageMemory = normalizeUsage(data)
  scheduleUserDataPersist()
  return usageMemory
}

/** Force flush (e.g. before process exit tests). */
export async function flushUserDataPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  await persistChain
  await flushPersist()
}
