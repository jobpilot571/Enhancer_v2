import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import {
  getSession,
  updateSession,
  setEnhancedDocx,
  readFile,
  UPLOAD_DIR,
} from '../store/sessionStore.js'
import { ensureEnhancedResumeQuality, qaEnhancedResume } from './resumeQaService.js'
import { patchDocx, repairDocxLayout } from './docxService.js'

const ISSUE_HINTS = [
  { id: 'blank_page_gap', keys: ['blank page', 'empty page', 'full page', 'white space page', 'page gap'] },
  { id: 'resume_gap_spacing', keys: ['gap', 'spacing', 'huge space', 'half page', 'whitespace', 'white space'] },
  { id: 'indent_inconsistency', keys: ['indent', 'indentation', 'alignment', 'bullet align', 'stagger', 'misaligned'] },
  { id: 'skills_mashed', keys: ['skills', 'technical skills', 'category', 'mashed'] },
  { id: 'extreme_indent', keys: ['shoved', 'left margin', 'too far right', 'too far left'] },
  { id: 'keep_next', keys: ['keep next', 'orphaned', 'lonely bullet'] },
]

export function classifyLayoutIssue(message = '') {
  const text = String(message || '').toLowerCase()
  const matched = []
  for (const hint of ISSUE_HINTS) {
    if (hint.keys.some((k) => text.includes(k))) matched.push(hint.id)
  }
  if (!matched.length) {
    return {
      codes: ['blank_page_gap', 'resume_gap_spacing', 'indent_inconsistency'],
      focus: 'general_layout',
      summary: 'General layout check (gaps, spacing, indentation)',
    }
  }
  return {
    codes: matched,
    focus: matched[0],
    summary: `Focused on: ${matched.join(', ')}`,
  }
}

function stripHighlights(buffer) {
  const zip = new PizZip(buffer)
  const doc = zip.file('word/document.xml')
  if (!doc) return buffer
  const xml = doc.asText().replace(/<w:shd[^/]*\/>/g, '')
  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function saveEvidence(sessionId, file) {
  if (!file?.buffer) return null
  const safeName = String(file.originalname || 'evidence')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80)
  const stamp = Date.now()
  const dest = path.join(UPLOAD_DIR, `${sessionId}-issue-${stamp}-${safeName}`)
  fs.writeFileSync(dest, file.buffer)
  return {
    path: dest,
    name: file.originalname,
    mime: file.mimetype,
    size: file.size,
    savedAt: new Date().toISOString(),
  }
}

/**
 * User-reported layout issue → classify → repair/rebuild → unlock download only if QA passes.
 */
export async function fixReportedLayoutIssue({
  sessionId,
  message = '',
  evidenceFile = null,
  log = () => {},
} = {}) {
  const session = getSession(sessionId)
  if (!session) {
    const err = new Error('Session not found — upload and enhance a resume first.')
    err.status = 404
    throw err
  }

  const classification = classifyLayoutIssue(message)
  const evidence = saveEvidence(sessionId, evidenceFile)
  const reports = Array.isArray(session.layoutIssueReports) ? [...session.layoutIssueReports] : []

  const sourcePath = session.enhancedPreviewPath || session.enhancedPath || session.originalPath
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const err = new Error('No enhanced resume yet. Run Enhance first, then report the layout issue.')
    err.status = 400
    throw err
  }

  // If user uploaded a problem DOCX, prefer repairing that file
  let workingBuffer = readFile(sourcePath)
  let usedUploadedDocx = false
  if (evidenceFile?.originalname?.toLowerCase().endsWith('.docx')) {
    workingBuffer = evidenceFile.buffer
    usedUploadedDocx = true
    log('layout-fix: using uploaded DOCX as repair source')
  }

  const originalBuffer = session.originalPath && fs.existsSync(session.originalPath)
    ? readFile(session.originalPath)
    : workingBuffer
  const resumeData = session.resumeData || null
  const plan = session.enhancementPlan || null

  log(`layout-fix: ${classification.summary}`)

  let qaResult = ensureEnhancedResumeQuality(
    originalBuffer,
    workingBuffer,
    resumeData,
    {
      maxAttempts: 2,
      maxRebuilds: plan ? 1 : 0,
      rebuild: plan
        ? () => {
          log('layout-fix: rebuilding from original + enhancement plan')
          const { buffer } = patchDocx(originalBuffer, plan, {
            highlight: true,
            resumeData,
          })
          return buffer
        }
        : null,
      log,
    },
  )

  // Extra deterministic pass when user explicitly mentioned gaps/indents
  if (!qaResult.readyForDownload) {
    log('layout-fix: extra repairDocxLayout pass')
    const extra = repairDocxLayout(qaResult.buffer)
    qaResult = ensureEnhancedResumeQuality(originalBuffer, extra, resumeData, {
      maxAttempts: 1,
      maxRebuilds: 0,
      log,
    })
  }

  const previewBuffer = qaResult.buffer
  let downloadBuffer = stripHighlights(previewBuffer)
  const finalQa = qaEnhancedResume(originalBuffer, downloadBuffer, resumeData)
  const readyForDownload = Boolean(qaResult.readyForDownload && finalQa.ok)

  if (readyForDownload) {
    // Keep highlights on preview; clean file for download
    downloadBuffer = ensureEnhancedResumeQuality(originalBuffer, downloadBuffer, resumeData, {
      maxAttempts: 1,
      maxRebuilds: 0,
      log,
    }).buffer
    setEnhancedDocx(sessionId, downloadBuffer, previewBuffer)
  }

  const layoutQa = {
    ok: readyForDownload,
    readyForDownload,
    highCount: finalQa.highCount,
    mediumCount: finalQa.mediumCount,
    defects: finalQa.defects,
    rebuilds: qaResult.rebuilds || 0,
    focus: classification.focus,
    codes: classification.codes,
    checks: [
      'page_gaps',
      'blank_spacers',
      'indentation',
      'bullet_alignment',
      'margins',
      'skills_layout',
      'content_preservation',
    ],
  }

  const reply = readyForDownload
    ? `Fixed and re-verified your resume (${classification.summary}). `
      + `Download is unlocked — please preview again, then download.`
      + (usedUploadedDocx ? ' Used your uploaded DOCX as the repair source.' : '')
      + (evidence && !usedUploadedDocx ? ' Screenshot/file saved with this report.' : '')
    : `I ran layout repair for “${classification.summary}”, but high-severity issues remain: `
      + `${finalQa.defects.filter((d) => d.severity === 'high').map((d) => d.code).join(', ') || 'unknown'}. `
      + `Download stays locked. Try describing the exact section (e.g. “skills indent” or “blank page after CVS”), `
      + `or re-enhance and report again.`
      + (evidence ? ' Your screenshot/file was saved for follow-up.' : '')

  const report = {
    at: new Date().toISOString(),
    message: String(message || '').slice(0, 2000),
    classification,
    readyForDownload,
    defects: finalQa.defects.map((d) => d.code),
    evidence: evidence
      ? { name: evidence.name, mime: evidence.mime, size: evidence.size, savedAt: evidence.savedAt }
      : null,
    usedUploadedDocx,
  }
  reports.push(report)
  updateSession(sessionId, {
    layoutQa,
    layoutIssueReports: reports.slice(-20),
  })

  return {
    ok: readyForDownload,
    readyForDownload,
    reply,
    layoutQa,
    classification,
    report,
  }
}
