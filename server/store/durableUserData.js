/**
 * Durable JSON blobs for users + usage (GitHub Gist).
 * Same credentials as complimentary whitelist when USER_DATA_GIST_ID is unset:
 *   GITHUB_TOKEN / GH_TOKEN + COMPLIMENTARY_GIST_ID (or USER_DATA_GIST_ID)
 *
 * Without a gist, data stays on local disk only (ephemeral on Render).
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')

const USERS_FILE = 'jobpilot-users.json'
const USAGE_FILE = 'jobpilot-usage.json'
const LOCAL_USERS = path.join(DATA_DIR, 'users.json')
const LOCAL_USAGE = path.join(DATA_DIR, 'usage.json')

let ready = false
let lastPersistError = ''

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
  return Boolean(gistId() && githubToken())
}

export function getUserStorageStatus() {
  return {
    durable: isDurableUserStoreConfigured(),
    backend: isDurableUserStoreConfigured() ? 'github-gist' : 'local-ephemeral',
    userCount: Array.isArray(usersMemory.users) ? usersMemory.users.length : 0,
    usageKeys: Object.keys(usageMemory.usage || {}).length,
    ready,
    lastPersistError: lastPersistError || null,
    hint: isDurableUserStoreConfigured()
      ? 'Users and usage are saved permanently (GitHub Gist) and survive Render redeploys.'
      : 'Users/usage are on Render’s temporary disk and reset on redeploy. Set GITHUB_TOKEN + COMPLIMENTARY_GIST_ID (or USER_DATA_GIST_ID).',
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

export async function initDurableUserStore() {
  try {
    if (isDurableUserStoreConfigured()) {
      const files = await fetchGistFiles()
      usersMemory = normalizeUsers(parseGistFile(files, USERS_FILE, { users: [] }))
      usageMemory = normalizeUsage(parseGistFile(files, USAGE_FILE, { usage: {} }))

      // Seed from local if gist files empty but local has data (first migrate)
      const localUsers = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
      const localUsage = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
      if (usersMemory.users.length === 0 && localUsers.users.length > 0) {
        usersMemory = localUsers
      }
      if (Object.keys(usageMemory.usage).length === 0 && Object.keys(localUsage.usage).length > 0) {
        usageMemory = localUsage
      }

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
      usersMemory = normalizeUsers(readLocalJson(LOCAL_USERS, { users: [] }))
      usageMemory = normalizeUsage(readLocalJson(LOCAL_USAGE, { usage: {} }))
      console.warn(
        '[auth-store] WARNING: no durable store. Users/usage reset on Render redeploy. '
          + 'Set GITHUB_TOKEN + COMPLIMENTARY_GIST_ID (or USER_DATA_GIST_ID).',
      )
      console.log(
        `[auth-store] local loaded — users=${usersMemory.users.length} usageKeys=${Object.keys(usageMemory.usage).length}`,
      )
    }
    lastPersistError = ''
  } catch (err) {
    console.error('[auth-store] init failed, using local:', err.message)
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
  if (!isDurableUserStoreConfigured()) {
    lastPersistError = 'Durable store not configured'
    return
  }
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
