import { createEmptyProject } from './jdProjectModel'

const LOCAL_KEY = 'jobpilot_jd_builder_draft'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days for anonymous drafts

function keyFor(userId) {
  return userId ? `${LOCAL_KEY}:${userId}` : LOCAL_KEY
}

export function readJdDraft(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.project) return null
    if (parsed.updatedAt) {
      const age = Date.now() - new Date(parsed.updatedAt).getTime()
      if (Number.isFinite(age) && age > MAX_AGE_MS && !userId) {
        localStorage.removeItem(keyFor(userId))
        return null
      }
    }
    return parsed
  } catch {
    return null
  }
}

export function writeJdDraft(userId, project) {
  try {
    const safe = sanitizeForStorage(project)
    localStorage.setItem(
      keyFor(userId),
      JSON.stringify({
        project: safe,
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // quota / private mode
  }
}

export function clearJdDraft(userId) {
  try {
    localStorage.removeItem(keyFor(userId))
  } catch {
    // ignore
  }
}

/** Never persist raw reference document text or rejected PII. */
export function sanitizeForStorage(project) {
  const base = project || createEmptyProject()
  return {
    ...base,
    referenceDocuments: (base.referenceDocuments || []).map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      documentType: doc.documentType || 'unknown',
      uploadStatus: doc.uploadStatus,
      error: doc.error || '',
      // drop rawText / blobs
    })),
    referenceItems: (base.referenceItems || [])
      .filter((item) => item.approved || item.relevanceLevel === 'high' || item.relevanceLevel === 'medium')
      .map((item) => ({
        id: item.id,
        sourceDocumentId: item.sourceDocumentId,
        sourceFileName: item.sourceFileName || '',
        category: item.category,
        cleanedText: String(item.cleanedText || '').slice(0, 2000),
        relevanceScore: item.relevanceScore,
        relevanceLevel: item.relevanceLevel,
        approved: !!item.approved,
        targetSection: item.targetSection || '',
      })),
    generatedResume: null,
    previewReady: false,
    updatedAt: new Date().toISOString(),
  }
}

export function formatDraftTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export { MAX_AGE_MS }
