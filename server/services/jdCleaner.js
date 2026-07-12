import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../.cache')
const CACHE_FILE = path.join(CACHE_DIR, 'jd-analysis.json')

const NOISE_PATTERNS = [
  /equal\s+opportunity[\s\S]{0,400}/gi,
  /\beeo\b[\s\S]{0,200}/gi,
  /diversity[\s\S]{0,300}inclusion[\s\S]{0,200}/gi,
  /competitive\s+salary[\s\S]{0,200}/gi,
  /salary\s*(range|:)?[\s\S]{0,160}/gi,
  /\$\s?\d[\d,]*(?:\s*[-–]\s*\$?\d[\d,]*)?(?:\s*(?:k|per\s+year|\/yr|annually))?/gi,
  /benefits?\s*(include|package|:)?[\s\S]{0,500}/gi,
  /401\s*\(?k\)?[\s\S]{0,120}/gi,
  /health\s+(insurance|benefits|coverage)[\s\S]{0,160}/gi,
  /paid\s+time\s+off|\bpto\b[\s\S]{0,80}/gi,
  /work\s+from\s+home|remote[- ]friendly|hybrid\s+work[\s\S]{0,80}/gi,
  /location\s*:?\s*[^\n]{0,120}/gi,
  /based\s+in\s+[^\n]{0,80}/gi,
  /how\s+to\s+apply[\s\S]{0,400}/gi,
  /please\s+apply[\s\S]{0,200}/gi,
  /submit\s+your\s+(resume|application)[\s\S]{0,200}/gi,
  /we\s+are\s+(an?\s+)?(equal|eeo|growing|fast[- ]paced)[\s\S]{0,200}/gi,
  /about\s+(us|the\s+company)[\s\S]{0,500}/gi,
  /our\s+mission[\s\S]{0,300}/gi,
  /legal\s+disclaimer[\s\S]{0,400}/gi,
  /background\s+check[\s\S]{0,160}/gi,
]

/**
 * Strip salary/benefits/legal/marketing noise from a JD.
 */
export function cleanJobDescription(jdText) {
  let text = String(jdText || '').replace(/\r\n/g, '\n')
  for (const pat of NOISE_PATTERNS) {
    text = text.replace(pat, '\n')
  }
  // Drop lines that are pure marketing fluff
  text = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false
      if (/^(benefits|perks|what\s+we\s+offer|why\s+join|about\s+us)\b/i.test(l)) return false
      if (l.length < 3) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

export function hashJdText(jdText) {
  const normalized = cleanJobDescription(jdText)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {}
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveDiskCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    // Keep cache bounded
    const entries = Object.entries(cache)
    if (entries.length > 200) {
      entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
      const trimmed = Object.fromEntries(entries.slice(0, 150))
      fs.writeFileSync(CACHE_FILE, JSON.stringify(trimmed))
      return
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch (err) {
    console.warn('[jd-cache] write failed:', err.message)
  }
}

const memoryCache = new Map()

export function getCachedJdAnalysis(jdText) {
  const key = hashJdText(jdText)
  if (memoryCache.has(key)) {
    return { key, data: memoryCache.get(key), source: 'memory' }
  }
  const disk = loadDiskCache()
  if (disk[key]?.data) {
    memoryCache.set(key, disk[key].data)
    return { key, data: disk[key].data, source: 'disk' }
  }
  return { key, data: null, source: null }
}

export function setCachedJdAnalysis(jdText, data) {
  const key = hashJdText(jdText)
  memoryCache.set(key, data)
  const disk = loadDiskCache()
  disk[key] = { data, savedAt: Date.now() }
  saveDiskCache(disk)
  return key
}
