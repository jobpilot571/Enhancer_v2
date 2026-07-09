import { getSession, updateSession, readFile } from '../store/sessionStore.js'
import { extractResumeText } from './resumeExtract.js'
import { parseResume, parseJD } from './openaiService.js'

/** In-flight promises so concurrent callers share one parse. */
const resumeParseInflight = new Map()
const jdParseInflight = new Map()

export async function ensureResumeData(sessionOrId) {
  const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.sessionId
  const session = getSession(sessionId)
  if (!session) throw new Error('Session not found')
  if (session.resumeData) return session.resumeData

  if (resumeParseInflight.has(sessionId)) {
    return resumeParseInflight.get(sessionId)
  }

  const promise = (async () => {
    const buffer = readFile(session.originalPath)
    const resumeText = session.resumeText || await extractResumeText(buffer, session.fileType)
    const resumeData = await parseResume(resumeText)
    updateSession(sessionId, { resumeText, resumeData, resumeParseError: null })
    return resumeData
  })()
    .catch((err) => {
      updateSession(sessionId, { resumeParseError: err.message || 'Resume parse failed' })
      throw err
    })
    .finally(() => {
      resumeParseInflight.delete(sessionId)
    })

  resumeParseInflight.set(sessionId, promise)
  return promise
}

export async function ensureJdData(sessionOrId) {
  const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.sessionId
  const session = getSession(sessionId)
  if (!session) throw new Error('Session not found')
  if (session.jdData) return session.jdData
  if (!session.jdText?.trim()) throw new Error('Job description not set')

  if (jdParseInflight.has(sessionId)) {
    return jdParseInflight.get(sessionId)
  }

  const textSnapshot = session.jdText.trim()
  const promise = (async () => {
    const jdData = await parseJD(textSnapshot)
    const latest = getSession(sessionId)
    // Ignore stale result if JD changed while parsing
    if (!latest || latest.jdText?.trim() !== textSnapshot) {
      return latest?.jdData || jdData
    }
    updateSession(sessionId, { jdData, jdParseError: null })
    return jdData
  })()
    .catch((err) => {
      updateSession(sessionId, { jdParseError: err.message || 'JD parse failed' })
      throw err
    })
    .finally(() => {
      jdParseInflight.delete(sessionId)
    })

  jdParseInflight.set(sessionId, promise)
  return promise
}

export function precomputeResume(sessionId) {
  setImmediate(() => {
    ensureResumeData(sessionId).catch((err) => {
      console.error(`[precompute] resume session=${sessionId}:`, err.message)
    })
  })
}

export function precomputeJd(sessionId) {
  setImmediate(() => {
    ensureJdData(sessionId).catch((err) => {
      console.error(`[precompute] jd session=${sessionId}:`, err.message)
    })
  })
}
