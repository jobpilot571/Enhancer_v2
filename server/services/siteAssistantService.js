import { structuredJSON } from './aiProvider.js'
import { getSession } from '../store/sessionStore.js'
import { fixReportedLayoutIssue } from './layoutIssueService.js'
import { applyJdResumeRevision } from './jdRevisionService.js'
import { handleJdWizardChat } from './jdChatService.js'
import { extractResumeText } from './resumeExtract.js'

const ASSISTANT_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    greeting: { type: 'boolean' },
    intent: {
      type: 'string',
      description: 'help_nav | faq | fix_enhancer | revise_jd | revise_jd_draft | general',
    },
    relatedService: {
      type: 'string',
      description: 'home | enhancer | builder | jd | pricing | contact | other',
    },
    needsFile: { type: 'boolean' },
    reply: { type: 'string' },
    fixMessage: {
      type: 'string',
      description: 'Actionable instruction to pass into a fix pipeline',
    },
  },
  required: ['greeting', 'intent', 'relatedService', 'needsFile', 'reply', 'fixMessage'],
  additionalProperties: false,
}

function pageContextFromPath(pathname = '/') {
  const p = String(pathname || '/')
  if (p.includes('/services/resume-enhancer')) {
    return {
      serviceKey: 'enhancer',
      title: 'Resume Enhancer',
      hint: 'Upload resume + JD, enhance, download, layout/revision chat.',
    }
  }
  if (p.includes('/services/resume-builder')) {
    return {
      serviceKey: 'builder',
      title: 'Resume Builder',
      hint: 'Build a new resume from form inputs and templates.',
    }
  }
  if (p.includes('/services/jd-tailored-resume')) {
    return {
      serviceKey: 'jd',
      title: 'JD-Tailored Resume Builder',
      hint: 'Multi-step JD-aligned resume: basics, JD, companies, templates, preview.',
    }
  }
  if (p.includes('/billing')) {
    return { serviceKey: 'pricing', title: 'Billing', hint: 'Plans and checkout.' }
  }
  if (p === '/' || p.startsWith('/#')) {
    return { serviceKey: 'home', title: 'Home', hint: 'Marketing site and services overview.' }
  }
  return { serviceKey: 'other', title: 'JoBPilot', hint: 'General site help.' }
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

async function classifyAssistantRequest({
  message,
  pathname,
  workspace,
  thread,
  fileNames,
}) {
  const page = pageContextFromPath(pathname)
  const recent = (thread || [])
    .slice(-8)
    .map((m) => `${m.role}: ${String(m.text || '').slice(0, 400)}`)
    .join('\n')

  const { result } = await structuredJSON(
    `You are JoBPilot's site-wide AI assistant.
Classify the user request and draft a helpful reply.
Intents:
- help_nav: user needs navigation / which service to use
- faq: product questions
- fix_enhancer: resume layout/format/content issues on enhanced resume
- revise_jd: change generated JD-tailored DOCX content
- revise_jd_draft: edit JD wizard draft fields (companies, basics, etc.)
- general: other help
Set needsFile=true if a screenshot/DOCX/PDF is required and not attached.
fixMessage should be a clear instruction for the fixer pipeline when intent is a fix.`,
    `Current page: ${page.title} (${pathname})
Page hint: ${page.hint}
Workspace service: ${workspace?.service || 'none'}
Workspace sessionId: ${workspace?.sessionId || 'none'}
Has preview: ${workspace?.hasPreview ? 'yes' : 'no'}
Attached files: ${(fileNames || []).join(', ') || '(none)'}

Recent chat:
${recent || '(none)'}

User message:
${String(message || '').slice(0, 4000)}`,
    'site_assistant_intent',
    ASSISTANT_INTENT_SCHEMA,
    { maxTokens: 1200, preferProviders: ['claude', 'openai', 'gemini'] },
  )

  return {
    greeting: Boolean(result?.greeting),
    intent: String(result?.intent || 'general'),
    relatedService: String(result?.relatedService || page.serviceKey),
    needsFile: Boolean(result?.needsFile),
    reply: String(result?.reply || 'How may I help you?').slice(0, 1200),
    fixMessage: String(result?.fixMessage || message || '').slice(0, 2000),
    page,
  }
}

/**
 * Run site assistant with SSE progress events on `res`.
 */
export async function runSiteAssistantChat({
  res,
  message,
  pathname,
  workspace = {},
  thread = [],
  files = [],
  userId = null,
}) {
  const emit = (event, data) => sendEvent(res, event, data)

  emit('status', { text: 'Hi — I’m with you. Checking where you are…' })
  const page = pageContextFromPath(pathname)
  emit('status', { text: `You’re on ${page.title}. Understanding your question…` })

  const fileNames = (files || []).map((f) => f.originalname || f.name || 'file')
  const classification = await classifyAssistantRequest({
    message,
    pathname,
    workspace,
    thread,
    fileNames,
  })

  emit('status', {
    text: classification.relatedService === page.serviceKey
      ? 'This looks related to your current page.'
      : `This looks related to ${classification.relatedService} — I’ll still help from here.`,
  })

  const sessionId = workspace?.sessionId || null
  const evidence = (files || []).find((f) => {
    const name = String(f.originalname || '').toLowerCase()
    const mime = String(f.mimetype || '').toLowerCase()
    return mime.startsWith('image/') || name.endsWith('.docx') || name.endsWith('.pdf')
  }) || null

  // Optional: extract text from uploaded PDF/DOCX for richer answers
  let uploadNote = ''
  if (evidence && !String(evidence.mimetype || '').startsWith('image/')) {
    try {
      emit('status', { text: 'Reading your uploaded document…' })
      const text = await extractResumeText(evidence.buffer, evidence.originalname, evidence.mimetype)
      uploadNote = String(text || '').slice(0, 3000)
    } catch {
      uploadNote = ''
    }
  }

  let actionResult = null
  const intent = classification.intent

  if (classification.needsFile && !evidence && (intent === 'fix_enhancer' || intent === 'revise_jd')) {
    emit('reply', {
      reply: `${classification.reply}\n\nPlease attach a screenshot, DOCX, or PDF so I can check the issue.`,
      intent,
      relatedService: classification.relatedService,
      previewUpdated: false,
    })
    emit('done', { ok: true })
    try { res.end() } catch { /* ignore */ }
    return
  }

  try {
    if (intent === 'fix_enhancer') {
      if (!sessionId) {
        emit('reply', {
          reply: `${classification.reply}\n\nOpen Resume Enhancer, enhance a resume first, then ask me again — or attach the DOCX/screenshot now.`,
          intent,
          relatedService: 'enhancer',
          previewUpdated: false,
        })
        emit('done', { ok: true })
        return
      }
      const session = getSession(sessionId)
      if (!session) {
        emit('reply', {
          reply: 'I couldn’t find that enhance session. Re-enhance your resume, then ask me again.',
          intent,
          previewUpdated: false,
        })
        emit('done', { ok: true })
        return
      }
      emit('status', { text: 'Reviewing your enhanced resume for layout/format issues…' })
      emit('status', { text: 'Finding the issue…' })
      emit('status', { text: 'Applying a fix now…' })
      actionResult = await fixReportedLayoutIssue({
        sessionId,
        message: classification.fixMessage || message,
        evidenceFile: evidence,
        log: (msg) => console.log(`[assistant-fix:${String(sessionId).slice(0, 8)}] ${msg}`),
      })
      emit('reply', {
        reply: actionResult.reply || 'I updated your enhanced resume. Refresh the preview/download.',
        intent,
        relatedService: 'enhancer',
        previewUpdated: true,
        downloadUrl: `/api/enhancer/download/${sessionId}`,
        previewUrl: `/api/enhancer/file/${sessionId}/enhanced`,
        service: 'enhancer',
        sessionId,
      })
      emit('done', { ok: true })
      return
    }

    if (intent === 'revise_jd' || intent === 'revise_jd_draft') {
      if (intent === 'revise_jd' && sessionId) {
        emit('status', { text: 'Checking your JD-tailored resume…' })
        emit('status', { text: 'Finding what to change…' })
        emit('status', { text: 'Updating the generated DOCX…' })
        actionResult = await applyJdResumeRevision(
          sessionId,
          `${classification.fixMessage || message}${uploadNote ? `\n\nUploaded file excerpt:\n${uploadNote}` : ''}`,
        )
        emit('reply', {
          reply: actionResult.reply || 'Updated your JD-tailored resume.',
          intent,
          relatedService: 'jd',
          previewUpdated: true,
          downloadUrl: actionResult.downloadUrl,
          previewUrl: actionResult.previewUrl,
          service: 'jd',
          sessionId,
          roleTitle: actionResult.roleTitle || '',
        })
        emit('done', { ok: true })
        return
      }

      // Draft / wizard help via JD chat assistant
      emit('status', { text: 'Updating your JD builder draft…' })
      const chatResult = await handleJdWizardChat({
        message: classification.fixMessage || message,
        project: workspace?.meta?.project || null,
        stepId: workspace?.meta?.stepId || '',
        sessionId,
        thread,
      })
      emit('reply', {
        reply: chatResult.reply || classification.reply,
        intent,
        relatedService: 'jd',
        previewUpdated: Boolean(chatResult.previewUpdated),
        downloadUrl: chatResult.downloadUrl,
        previewUrl: chatResult.previewUrl,
        projectUpdates: chatResult.projectUpdates,
        navigateToStep: chatResult.navigateToStep,
        service: 'jd',
        sessionId,
        roleTitle: chatResult.roleTitle || '',
      })
      emit('done', { ok: true })
      return
    }

    // General / nav / faq
    let reply = classification.reply
    if (uploadNote) {
      reply += '\n\nI also reviewed your uploaded file and can help fix formatting once you open the matching service session.'
    }
    emit('status', { text: 'Preparing a clear answer…' })
    emit('reply', {
      reply,
      intent,
      relatedService: classification.relatedService,
      previewUpdated: false,
      suggestPath: classification.relatedService === 'enhancer'
        ? '/services/resume-enhancer'
        : classification.relatedService === 'jd'
          ? '/services/jd-tailored-resume'
          : classification.relatedService === 'builder'
            ? '/services/resume-builder'
            : null,
    })
    emit('done', { ok: true })
  } catch (err) {
    console.error('[assistant]', err.message)
    emit('status', { text: 'Hit a snag while fixing — sharing what I know…' })
    emit('reply', {
      reply: err.message || 'I couldn’t finish that fix. Please try again or attach a screenshot.',
      intent,
      previewUpdated: false,
      error: true,
    })
    emit('done', { ok: false })
  } finally {
    try { res.end() } catch { /* ignore */ }
  }
}

export { pageContextFromPath }
