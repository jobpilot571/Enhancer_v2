import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../.cache')
const LAST_FILE = path.join(CACHE_DIR, 'last-resume-parse.json')

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

/**
 * Persist latest resume extract so you can open it like the JD cache file.
 * Writes:
 * - server/.cache/last-resume-parse.json  (always overwritten)
 * - server/.cache/resume-{sessionId}.json (per upload)
 */
export function saveResumeParseSnapshot({
  sessionId,
  fileName,
  method,
  confidence,
  resumeData,
  resumeTextPreview,
}) {
  try {
    ensureDir()
    const payload = {
      savedAt: new Date().toISOString(),
      sessionId,
      fileName: fileName || null,
      method,
      confidence,
      resumeData,
      resumeTextPreview: String(resumeTextPreview || '').slice(0, 12000),
    }
    fs.writeFileSync(LAST_FILE, JSON.stringify(payload, null, 2))
    if (sessionId) {
      const perSession = path.join(CACHE_DIR, `resume-${sessionId}.json`)
      fs.writeFileSync(perSession, JSON.stringify(payload, null, 2))
    }
    console.log(`[parse] resume snapshot → ${LAST_FILE}`)
  } catch (err) {
    console.warn('[parse] resume snapshot write failed:', err.message)
  }
}

export function getLastResumeParseSnapshot() {
  try {
    if (!fs.existsSync(LAST_FILE)) return null
    return JSON.parse(fs.readFileSync(LAST_FILE, 'utf8'))
  } catch {
    return null
  }
}
