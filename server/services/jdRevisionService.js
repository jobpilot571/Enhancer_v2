import { reviseJdResumeFromChat } from './openaiService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'
import {
  getSession,
  updateSession,
  setGeneratedDocx,
} from '../store/sessionStore.js'

/**
 * Apply a chat revision to a JD-builder session and regenerate the DOCX.
 * Call inside runWithAiCostContext from the route.
 */
export async function applyJdResumeRevision(sessionId, message) {
  const session = getSession(sessionId)
  if (!session || session.kind !== 'jd-builder') {
    const err = new Error('JD-builder session not found — build a resume first')
    err.status = 404
    throw err
  }
  if (!session.resumeData) {
    const err = new Error('No generated resume on this session — click Build Resume first')
    err.status = 400
    throw err
  }

  const text = String(message || '').trim()
  if (!text) {
    const err = new Error('Describe what you want changed')
    err.status = 400
    throw err
  }

  const { reply, resumeData } = await reviseJdResumeFromChat({
    resumeData: session.resumeData,
    message: text,
    jdData: session.jdData || null,
    builderInput: session.builderInput || null,
  })

  const form = session.builderInput || {}
  const templateId = form.templateId || session.templateId || 'classic-blue'
  const buffer = await generateResumeDocx(resumeData, templateId, {
    forceBlack: true,
    fontFamily: form.fontFamily || 'Calibri',
    fontSizePt: Number(form.fontSizePt) || 12,
    keywordHighlight: Boolean(form.keywordHighlight),
  })

  setGeneratedDocx(sessionId, buffer, buffer)
  const reports = Array.isArray(session.revisionReports) ? session.revisionReports : []
  reports.push({
    at: new Date().toISOString(),
    message: text.slice(0, 500),
    reply: String(reply || '').slice(0, 500),
  })
  updateSession(sessionId, {
    resumeData,
    revisionReports: reports.slice(-20),
  })

  return {
    ok: true,
    reply: reply || 'Updated your resume.',
    sessionId,
    previewUpdated: true,
    downloadUrl: `/api/jd-builder/download/${sessionId}`,
    previewUrl: `/api/jd-builder/file/${sessionId}`,
    roleTitle: String(
      resumeData?.title || session.jdData?.roleTitle || form.role || '',
    ).trim(),
  }
}
