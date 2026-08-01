import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../uploads/jd-saved')
const META_FILE = path.join(ROOT, 'index.json')

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true })
}

function readAll() {
  ensureRoot()
  if (!fs.existsSync(META_FILE)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeAll(rows) {
  ensureRoot()
  fs.writeFileSync(META_FILE, JSON.stringify(rows, null, 2), 'utf8')
}

function userDir(userId) {
  const dir = path.join(ROOT, String(userId || 'guest'))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function publicMeta(row) {
  if (!row) return null
  return {
    id: row.id,
    role: row.role || '',
    yearsOfExperience: row.yearsOfExperience ?? null,
    yearsRequired: row.yearsRequired ?? null,
    jdText: row.jdText || '',
    jdSnippet: String(row.jdText || '').slice(0, 280),
    fileName: row.fileName || 'resume.docx',
    templateId: row.templateId || '',
    createdAt: row.createdAt,
  }
}

/**
 * Save a JD-tailored resume for a signed-in user.
 * @returns {object} public metadata
 */
export function saveJdResume(userId, {
  role = '',
  yearsOfExperience = null,
  yearsRequired = null,
  jdText = '',
  templateId = '',
  fileName = '',
  docxBuffer,
} = {}) {
  if (!userId) throw Object.assign(new Error('Sign in required to save resumes'), { status: 401 })
  if (!docxBuffer || !Buffer.isBuffer(docxBuffer) || docxBuffer.length < 64) {
    throw Object.assign(new Error('Resume file is missing or invalid'), { status: 400 })
  }

  const id = randomUUID()
  const dir = userDir(userId)
  const safeName = String(fileName || 'resume.docx').replace(/[^\w.\- ]+/g, '').trim() || 'resume.docx'
  const docxName = `${id}.docx`
  const jdName = `${id}-jd.txt`
  const docxPath = path.join(dir, docxName)
  const jdPath = path.join(dir, jdName)

  fs.writeFileSync(docxPath, docxBuffer)
  fs.writeFileSync(jdPath, String(jdText || ''), 'utf8')

  const row = {
    id,
    userId: String(userId),
    role: String(role || '').trim(),
    yearsOfExperience: yearsOfExperience == null || yearsOfExperience === ''
      ? null
      : Number(yearsOfExperience),
    yearsRequired: yearsRequired == null || yearsRequired === ''
      ? null
      : Number(yearsRequired),
    jdText: String(jdText || ''),
    templateId: String(templateId || ''),
    fileName: safeName.endsWith('.docx') ? safeName : `${safeName}.docx`,
    docxPath,
    jdPath,
    createdAt: new Date().toISOString(),
  }

  const all = readAll().filter((r) => r.id !== id)
  all.unshift(row)
  writeAll(all)
  return publicMeta(row)
}

export function listJdResumes(userId) {
  if (!userId) return []
  return readAll()
    .filter((r) => String(r.userId) === String(userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicMeta)
}

export function getJdResume(userId, id) {
  const row = readAll().find((r) => r.id === id && String(r.userId) === String(userId))
  return row || null
}

export function readJdResumeDocx(userId, id) {
  const row = getJdResume(userId, id)
  if (!row?.docxPath || !fs.existsSync(row.docxPath)) return null
  return { row, buffer: fs.readFileSync(row.docxPath) }
}

export function readJdResumeJdText(userId, id) {
  const row = getJdResume(userId, id)
  if (!row) return null
  if (row.jdPath && fs.existsSync(row.jdPath)) {
    return { row, text: fs.readFileSync(row.jdPath, 'utf8') }
  }
  return { row, text: String(row.jdText || '') }
}

export function deleteJdResume(userId, id) {
  const all = readAll()
  const row = all.find((r) => r.id === id && String(r.userId) === String(userId))
  if (!row) return false
  for (const p of [row.docxPath, row.jdPath]) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
  writeAll(all.filter((r) => r.id !== id))
  return true
}
