import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '../uploads')

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

/** @type {Map<string, object>} */
const sessions = new Map()

export function detectFileType(fileName, mimeType) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (lower.endsWith('.docx') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx'
  }
  return null
}

export function createSession(fileName, fileType, originalBuffer) {
  const sessionId = randomUUID()
  const ext = fileType === 'pdf' ? 'pdf' : 'docx'
  const originalPath = path.join(UPLOAD_DIR, `${sessionId}-original.${ext}`)
  fs.writeFileSync(originalPath, originalBuffer)

  const session = {
    sessionId,
    fileName,
    fileType,
    originalPath,
    enhancedPath: null,
    jdText: '',
    resumeText: '',
    resumeData: null,
    jdData: null,
    comparison: null,
    enhancementPlan: null,
    atsScore: null,
    createdAt: Date.now(),
  }
  sessions.set(sessionId, session)
  return session
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null
}

export function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId)
  if (!session) return null
  Object.assign(session, updates)
  return session
}

export function setEnhancedDocx(sessionId, downloadBuffer, previewBuffer) {
  const session = getSession(sessionId)
  if (!session) return null
  const enhancedPath = path.join(UPLOAD_DIR, `${sessionId}-enhanced.docx`)
  const enhancedPreviewPath = path.join(UPLOAD_DIR, `${sessionId}-enhanced-preview.docx`)
  fs.writeFileSync(enhancedPath, downloadBuffer)
  fs.writeFileSync(enhancedPreviewPath, previewBuffer)
  session.enhancedPath = enhancedPath
  session.enhancedPreviewPath = enhancedPreviewPath
  return session
}

export function readFile(filePath) {
  return fs.readFileSync(filePath)
}

export { UPLOAD_DIR }
