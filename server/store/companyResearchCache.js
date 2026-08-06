import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')
const CACHE_FILE = path.join(DATA_DIR, 'company-research-cache.json')

/** Default TTL: 30 days */
export const COMPANY_RESEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** @type {Map<string, { savedAt: number, value: object }>} */
const memory = new Map()
let loaded = false

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadFromDisk() {
  if (loaded) return
  loaded = true
  try {
    if (!fs.existsSync(CACHE_FILE)) return
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    const entries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : raw
    if (!entries || typeof entries !== 'object') return
    const now = Date.now()
    for (const [key, row] of Object.entries(entries)) {
      const savedAt = Number(row?.savedAt) || 0
      if (!savedAt || now - savedAt > COMPANY_RESEARCH_CACHE_TTL_MS) continue
      if (row?.value) memory.set(key, { savedAt, value: row.value })
    }
  } catch (err) {
    console.warn(`[company-research-cache] load failed: ${err.message}`)
  }
}

function persistToDisk() {
  try {
    ensureDir()
    const now = Date.now()
    const entries = {}
    for (const [key, row] of memory.entries()) {
      if (now - row.savedAt > COMPANY_RESEARCH_CACHE_TTL_MS) {
        memory.delete(key)
        continue
      }
      entries[key] = { savedAt: row.savedAt, value: row.value }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: 1, entries }, null, 0), 'utf8')
  } catch (err) {
    console.warn(`[company-research-cache] persist failed: ${err.message}`)
  }
}

export function normalizeCompanyCacheKey(company, roleTitle = '') {
  const c = String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const r = String(roleTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return `${c}::${r}`
}

/**
 * @param {string} company
 * @param {string} [roleTitle]
 * @returns {object|null}
 */
export function getCachedCompanyResearch(company, roleTitle = '') {
  loadFromDisk()
  const key = normalizeCompanyCacheKey(company, roleTitle)
  const row = memory.get(key)
  if (!row) return null
  if (Date.now() - row.savedAt > COMPANY_RESEARCH_CACHE_TTL_MS) {
    memory.delete(key)
    persistToDisk()
    return null
  }
  return row.value
}

/**
 * @param {string} company
 * @param {string} roleTitle
 * @param {object} value
 */
export function setCachedCompanyResearch(company, roleTitle, value) {
  loadFromDisk()
  const key = normalizeCompanyCacheKey(company, roleTitle)
  memory.set(key, { savedAt: Date.now(), value })
  persistToDisk()
}
