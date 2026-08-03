import { chatJdWizardAssistant } from './openaiService.js'
import { applyJdResumeRevision } from './jdRevisionService.js'
import { getSession } from '../store/sessionStore.js'

/**
 * Wizard-wide JD assistant: update project fields and/or revise a built resume.
 */
export async function handleJdWizardChat({
  message,
  project = null,
  stepId = '',
  sessionId = null,
  thread = [],
}) {
  const text = String(message || '').trim()
  if (!text) {
    const err = new Error('Type a message for the assistant')
    err.status = 400
    throw err
  }

  const session = sessionId ? getSession(sessionId) : null
  const hasBuiltResume = Boolean(session?.kind === 'jd-builder' && session?.resumeData)

  const assistant = await chatJdWizardAssistant({
    message: text,
    project,
    stepId,
    thread,
    hasBuiltResume,
  })

  let revision = null
  const wantsResumeEdit = Boolean(assistant.reviseGeneratedResume)
  if (wantsResumeEdit) {
    if (!hasBuiltResume) {
      // Soft note — project updates may still apply
      assistant.reply = `${assistant.reply || ''} (No built resume yet — finish Build on Preview to revise DOCX content.)`.trim()
    } else {
      revision = await applyJdResumeRevision(sessionId, text)
      assistant.reply = revision.reply || assistant.reply
    }
  }

  return {
    ok: true,
    reply: assistant.reply || 'Done.',
    projectUpdates: assistant.projectUpdates || null,
    navigateToStep: assistant.navigateToStep || null,
    reviseGeneratedResume: wantsResumeEdit,
    previewUpdated: Boolean(revision?.previewUpdated),
    downloadUrl: revision?.downloadUrl || null,
    previewUrl: revision?.previewUrl || null,
    roleTitle: revision?.roleTitle || '',
    sessionId: sessionId || null,
  }
}
