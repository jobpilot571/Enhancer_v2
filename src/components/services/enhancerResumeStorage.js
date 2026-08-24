const DB_NAME = 'jobpilot_enhancer'
const DB_VERSION = 1
const STORE = 'resumes'
const META_PREFIX = 'jobpilot_enhancer_resume'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function storageKey(userId) {
  return userId ? `${META_PREFIX}:${userId}` : META_PREFIX
}

function readMeta(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.updatedAt) {
      const age = Date.now() - new Date(parsed.updatedAt).getTime()
      if (Number.isFinite(age) && age > MAX_AGE_MS) {
        localStorage.removeItem(storageKey(userId))
        return null
      }
    }
    return parsed
  } catch {
    return null
  }
}

function writeMeta(userId, payload) {
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify({
        fileName: payload.fileName || '',
        fileType: payload.fileType || 'docx',
        jdText: payload.jdText || '',
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // quota / private mode
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function fileFromSticky(blob, fileName, fileType, mime) {
  if (blob instanceof File && blob.name) return blob
  const type = mime
    || (fileType === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  return new File([blob], fileName || (fileType === 'pdf' ? 'resume.pdf' : 'resume.docx'), { type })
}

export async function saveStickyResume(userId, { file, fileName, fileType, jdText }) {
  if (!file) return
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        blob: file,
        fileName,
        fileType,
        mime: file.type,
      }, storageKey(userId))
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    writeMeta(userId, { fileName, fileType, jdText })
  } finally {
    db.close()
  }
}

export function saveStickyJd(userId, jdText) {
  const meta = readMeta(userId)
  if (!meta?.fileName) return
  writeMeta(userId, { ...meta, jdText: jdText || '' })
}

export async function loadStickyResume(userId) {
  const meta = readMeta(userId)
  let db
  try {
    db = await openDb()
  } catch {
    return null
  }
  try {
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(storageKey(userId))
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (!record?.blob) return null
    const fileName = record.fileName || meta?.fileName || 'resume.docx'
    const fileType = record.fileType || meta?.fileType
      || (fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx')
    return {
      file: fileFromSticky(record.blob, fileName, fileType, record.mime),
      fileName,
      fileType,
      jdText: typeof meta?.jdText === 'string' ? meta.jdText : '',
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}
