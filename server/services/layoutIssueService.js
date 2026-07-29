import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import PizZip from 'pizzip'
import {
  getSession,
  updateSession,
  setEnhancedDocx,
  readFile,
  UPLOAD_DIR,
} from '../store/sessionStore.js'
import { ensureEnhancedResumeQuality, qaEnhancedResume } from './resumeQaService.js'
import {
  patchDocx,
  repairDocxLayout,
  mergeExperienceAdditions,
  dedupeExperienceAdditionsAcrossCompanies,
  bulletClaimsOtherCompany,
  addExperienceBulletsToPlan,
  addSkillsToPlan,
} from './docxService.js'
import { generateExtraExperienceBullets, analyzeLayoutScreenshot } from './openaiService.js'

function bufferFingerprint(buf) {
  if (!buf?.length) return 'empty'
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

function mergeVisionClassification(base, vision) {
  const codes = [...new Set([
    ...(vision?.issueCodes || []),
    ...(base?.codes || []),
  ])]
  const needsAdd = codes.includes('add_bullet') || codes.includes('add_skill')
  const needsContent = codes.some((c) => CONTENT_CODES.has(c))
  const needsLayout = codes.some((c) => LAYOUT_CODES.has(c))
    || ['section_content_gap', 'blank_page_gap', 'resume_gap_spacing'].some((c) => codes.includes(c))
  let strategy = 'full_rebuild'
  if (needsAdd) strategy = 'content_add'
  else if (needsContent && needsLayout) strategy = 'full_rebuild'
  else if (needsContent) strategy = 'content_rebuild'
  else if (needsLayout) strategy = 'full_rebuild' // screenshots of gaps always rebuild

  return {
    codes: codes.length ? codes : ['blank_page_gap'],
    focus: codes[0] || 'blank_page_gap',
    summary: vision?.summary || base?.summary || 'Screenshot layout issue',
    strategy,
    visionSection: vision?.section || null,
  }
}

/** Layout-only defect codes (spacing / indent / pages). */
const LAYOUT_CODES = new Set([
  'blank_page_gap',
  'resume_gap_spacing',
  'section_content_gap',
  'indent_inconsistency',
  'skills_mashed',
  'extreme_indent',
  'keep_next',
])

/** Content / placement defect codes (need plan sanitize + rebuild). */
const CONTENT_CODES = new Set([
  'duplicate_bullet',
  'wrong_company',
  'garbled_bullet',
  'bad_rewrite',
  'missing_content',
  'wrong_skills',
  'summary_issue',
  'highlight_issue',
  'download_locked',
  'general_enhancer',
  'add_bullet',
  'add_skill',
])

const ISSUE_HINTS = [
  {
    id: 'add_bullet',
    keys: [
      'add one more bullet',
      'add another bullet',
      'add a bullet',
      'add more bullet',
      'add bullet',
      'one more bullet',
      'another bullet',
      'extra bullet',
      'new bullet',
      'add one bullet',
      'can you add one more bullet',
      'please add a bullet',
      'add two bullets',
      'add more bullets',
    ],
  },
  {
    id: 'add_skill',
    keys: [
      'add skill',
      'add a skill',
      'add more skill',
      'add more skills',
      'another skill',
      'extra skill',
      'missing skill',
      'add tools',
    ],
  },
  { id: 'blank_page_gap', keys: ['blank page', 'empty page', 'full page', 'white space page', 'page gap'] },
  { id: 'resume_gap_spacing', keys: ['gap', 'spacing', 'huge space', 'half page', 'whitespace', 'white space'] },
  { id: 'indent_inconsistency', keys: ['indent', 'indentation', 'alignment', 'bullet align', 'stagger', 'misaligned'] },
  { id: 'skills_mashed', keys: ['skills mashed', 'skills broken', 'category mashed', 'skills layout', 'skills line'] },
  { id: 'extreme_indent', keys: ['shoved', 'left margin', 'too far right', 'too far left'] },
  { id: 'keep_next', keys: ['keep next', 'orphaned', 'lonely bullet'] },
  {
    id: 'duplicate_bullet',
    keys: [
      'same bullet',
      'duplicate bullet',
      'duplicated bullet',
      'two times',
      'twice',
      'copied bullet',
      'repeated bullet',
      'added twice',
    ],
  },
  {
    id: 'wrong_company',
    keys: [
      'two companies',
      'both companies',
      'wrong company',
      'other company',
      'wrong job',
      'under capgemini',
      'under cerebrone',
      'wrong employer',
      'wrong experience',
    ],
  },
  {
    id: 'garbled_bullet',
    keys: [
      'garbled',
      'nonsensical',
      'doesn\'t make sense',
      'does not make sense',
      'broken sentence',
      'cut off',
      'truncated',
      'incomplete bullet',
      'gibberish',
      'weird bullet',
      'messy bullet',
      'corrupt',
    ],
  },
  {
    id: 'bad_rewrite',
    keys: [
      'bad rewrite',
      'wrong rewrite',
      'changed wrong',
      'rewrote wrong',
      'yellow highlight',
      'should not rewrite',
      'ruined bullet',
      'worse bullet',
    ],
  },
  {
    id: 'missing_content',
    keys: [
      'missing bullet',
      'missing content',
      'nothing added',
      'no changes',
      'empty enhanced',
      'lost content',
      'removed bullet',
      'deleted',
      'content missing',
    ],
  },
  {
    id: 'wrong_skills',
    keys: [
      'wrong skill',
      'bad skill',
      'skill not',
      'skills wrong',
      'fake skill',
      'incorrect skill',
    ],
  },
  {
    id: 'summary_issue',
    keys: ['summary', 'professional summary', 'profile section', 'objective'],
  },
  {
    id: 'highlight_issue',
    keys: ['highlight', 'green highlight', 'yellow highlight', 'color', 'shading'],
  },
  {
    id: 'download_locked',
    keys: ['download locked', 'cannot download', 'can\'t download', 'unlock download', 'ready to download'],
  },
]

function parseAddCount(message = '') {
  const text = String(message || '').toLowerCase()
  const m = text.match(/\b(one|two|three|1|2|3)\b/)
  if (!m) return 1
  const map = { one: 1, two: 2, three: 3, 1: 1, 2: 2, 3: 3 }
  return map[m[1]] || 1
}

function resolveCompanyHint(message, resumeData) {
  const text = String(message || '').toLowerCase()
  for (const exp of resumeData?.experience || []) {
    const company = String(exp.company || '').trim()
    if (!company) continue
    if (text.includes(company.toLowerCase())) return company
    const token = company.split(/[\s,.|•]+/)[0]
    if (token.length > 4 && text.includes(token.toLowerCase())) return company
  }
  return null
}

function isGarbledBullet(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/\b(for ent on|ent on worked|on worked directly)\b/i.test(t)) return true
  if (/\bdelivered\s+Lead\b/.test(t)) return true
  if (/\s(?:on|for|and|with|the|to|of|a|an|by)\s*$/i.test(t)) return true
  if (/[a-z]\s+[A-Z][a-z]+\s+[a-z]{1,4}\s*$/.test(t) && t.length < 150) return true
  if (/\bfor\s+[a-z]{2,4}\s+on\s+[A-Z]/.test(t)) return true
  return false
}

/**
 * Classify any Resume Enhancer user report into fix codes + strategy.
 * Unknown messages default to a full enhancer rebuild (not layout-only).
 */
export function classifyEnhancerIssue(message = '') {
  const text = String(message || '').toLowerCase()
  const matched = []

  // Flexible add-bullet / add-skill patterns (beyond exact phrase lists)
  if (
    /\b(add|include|insert|put)\b[\s\w]{0,24}\b(bullet|bullets)\b/.test(text)
    || /\b(one more|another|extra|new)\s+bullet\b/.test(text)
  ) {
    matched.push('add_bullet')
  }
  if (
    /\b(add|include|insert)\b[\s\w]{0,24}\b(skill|skills|tool|tools)\b/.test(text)
    || /\b(one more|another|extra|more)\s+skills?\b/.test(text)
  ) {
    matched.push('add_skill')
  }

  for (const hint of ISSUE_HINTS) {
    if (matched.includes(hint.id)) continue
    if (hint.keys.some((k) => text.includes(k))) matched.push(hint.id)
  }

  if (!matched.length) {
    return {
      codes: ['general_enhancer'],
      focus: 'general_enhancer',
      summary: 'Full enhancer repair (content + layout)',
      strategy: 'full_rebuild',
    }
  }

  const needsAdd = matched.includes('add_bullet') || matched.includes('add_skill')
  const needsContent = matched.some((c) => CONTENT_CODES.has(c))
  const needsLayout = matched.some((c) => LAYOUT_CODES.has(c))
  let strategy = 'full_rebuild'
  if (needsAdd) strategy = 'content_add'
  else if (needsContent && needsLayout) strategy = 'full_rebuild'
  else if (needsContent) strategy = 'content_rebuild'
  else if (needsLayout) strategy = 'layout_repair'

  return {
    codes: matched,
    focus: matched[0],
    summary: `Focused on: ${matched.join(', ')}`,
    strategy,
  }
}

/** @deprecated use classifyEnhancerIssue */
export function classifyLayoutIssue(message = '') {
  return classifyEnhancerIssue(message)
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

function dropBadPlanBullets(plan, resumeData) {
  if (!plan) return null
  const companies = (resumeData?.experience || []).map((e) => e.company).filter(Boolean)
  const dropRewrite = (r) => {
    const text = r.replacement || ''
    if (isGarbledBullet(text)) return true
    if (r.company && bulletClaimsOtherCompany(text, r.company, companies)) return true
    return false
  }

  return {
    ...plan,
    summaryBullets: (plan.summaryBullets || []).filter((b) => !isGarbledBullet(b)),
    experienceAdditions: (plan.experienceAdditions || []).map((e) => ({
      company: e.company,
      bullets: (e.bullets || []).filter(
        (b) => !isGarbledBullet(b) && !bulletClaimsOtherCompany(b, e.company, companies),
      ),
    })).filter((e) => e.company && e.bullets.length),
    bulletRewrites: (plan.bulletRewrites || []).filter((r) => !dropRewrite(r)),
    skillsByCategory: plan.skillsByCategory || [],
    skillsToAdd: plan.skillsToAdd || [],
  }
}

export function sanitizePlanForContentFix(plan, resumeData) {
  if (!plan) return null
  let next = dropBadPlanBullets({
    ...plan,
    experienceAdditions: (plan.experienceAdditions || []).map((e) => ({
      company: e.company,
      bullets: [...(e.bullets || [])],
    })),
    bulletRewrites: [...(plan.bulletRewrites || [])],
    summaryBullets: [...(plan.summaryBullets || [])],
  }, resumeData)
  next = mergeExperienceAdditions(next, resumeData || { experience: [] })
  next = dedupeExperienceAdditionsAcrossCompanies(next, resumeData)
  next = dropBadPlanBullets(next, resumeData)
  return next
}

function replyForSuccess(classification, { usedUploadedDocx, evidence, actionDetail = null }) {
  const focus = classification.focus
  const baseByFocus = {
    add_bullet: actionDetail
      || 'Added a new experience bullet and re-verified layout.',
    add_skill: actionDetail
      || 'Added missing skills and re-verified layout.',
    section_content_gap: 'Removed spacer chains and tightened spacing after section headings.',
    duplicate_bullet: 'Removed duplicate bullets and re-checked the resume.',
    wrong_company: 'Moved/removed bullets that were under the wrong company and re-checked.',
    garbled_bullet: 'Dropped broken/garbled bullets and rebuilt a cleaner enhanced resume.',
    bad_rewrite: 'Rebuilt without the bad rewrites and re-verified layout.',
    missing_content: 'Rebuilt the enhanced resume from your original + cleaned plan.',
    wrong_skills: 'Rebuilt skill inserts and re-verified layout.',
    summary_issue: 'Rebuilt the summary changes and re-verified layout.',
    highlight_issue: 'Rebuilt highlights from a clean patch and re-verified.',
    download_locked: 'Re-ran full repair so download can unlock.',
    general_enhancer: 'Ran a full enhancer repair (content + layout).',
  }
  const base = baseByFocus[focus]
    || `Fixed and re-verified your resume (${classification.summary}).`
  return `${base} Download is unlocked — please preview again, then download.`
    + (usedUploadedDocx ? ' Used your uploaded DOCX as the repair source.' : '')
    + (evidence && !usedUploadedDocx ? ' Screenshot/file saved with this report.' : '')
}

function replyForFailure(classification, finalQa, { evidence, actionDetail = null }) {
  const highs = finalQa.defects.filter((d) => d.severity === 'high').map((d) => d.code)
  const prefix = actionDetail ? `${actionDetail} ` : ''
  return `${prefix}I attempted “${classification.summary}”, but high-severity layout checks still fail`
    + `${highs.length ? `: ${highs.join(', ')}` : ''}. `
    + `Preview was updated with the latest repair attempt. Describe the exact problem `
    + `(add one more bullet, duplicate bullet, blank page, skills indent, garbled text) or re-enhance and report again.`
    + (evidence ? ' Your screenshot/file was saved for follow-up.' : '')
}

/**
 * User-reported enhancer issue (any kind) → classify → repair/rebuild → refresh preview.
 * Download unlocks only when layout QA passes.
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

  const isImageEvidence = Boolean(
    evidenceFile?.buffer?.length
    && String(evidenceFile.mimetype || '').startsWith('image/'),
  )
  const genericEvidenceMessage = !String(message || '').trim()
    || /^enhancer issue from uploaded evidence$/i.test(String(message).trim())

  let visionResult = null
  if (isImageEvidence) {
    log('enhancer-fix: analyzing screenshot with vision')
    try {
      visionResult = await analyzeLayoutScreenshot(
        evidenceFile.buffer,
        evidenceFile.mimetype || 'image/png',
        genericEvidenceMessage ? '' : message,
      )
      log(`enhancer-fix: vision → ${visionResult.issueCodes.join(', ')} — ${visionResult.summary}`)
    } catch (err) {
      log(`enhancer-fix: vision unavailable (${err.message}) — using layout rebuild fallback`)
      visionResult = {
        issueCodes: ['blank_page_gap', 'section_content_gap'],
        summary: 'Screenshot attached — applying gap/spacing repair (vision unavailable)',
        section: '',
      }
    }
  }

  let classification = classifyEnhancerIssue(message)
  if (visionResult) {
    classification = mergeVisionClassification(classification, visionResult)
  } else if (isImageEvidence && genericEvidenceMessage) {
    classification = {
      codes: ['blank_page_gap', 'section_content_gap'],
      focus: 'blank_page_gap',
      summary: 'Screenshot layout issue (gaps/spacing)',
      strategy: 'full_rebuild',
    }
  }

  const evidence = saveEvidence(sessionId, evidenceFile)
  const reports = Array.isArray(session.layoutIssueReports) ? [...session.layoutIssueReports] : []
  const strategy = classification.strategy || 'full_rebuild'
  const needsRebuild = strategy === 'content_rebuild'
    || strategy === 'full_rebuild'
    || strategy === 'content_add'
    || isImageEvidence

  const sourcePath = session.enhancedPreviewPath || session.enhancedPath || session.originalPath
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const err = new Error('No resume to fix yet. Upload and run Enhance first, then report the issue.')
    err.status = 400
    throw err
  }

  let workingBuffer = readFile(sourcePath)
  const beforeFingerprint = bufferFingerprint(workingBuffer)
  let usedUploadedDocx = false
  if (evidenceFile?.originalname?.toLowerCase().endsWith('.docx')) {
    workingBuffer = evidenceFile.buffer
    usedUploadedDocx = true
    log('enhancer-fix: using uploaded DOCX as repair source')
  }

  const originalBuffer = session.originalPath && fs.existsSync(session.originalPath)
    ? readFile(session.originalPath)
    : workingBuffer
  const resumeData = session.resumeData || null
  const jdData = session.jdData || null
  let plan = session.enhancementPlan || {
    summaryBullets: [],
    experienceAdditions: [],
    bulletRewrites: [],
    skillsByCategory: [],
    skillsToAdd: [],
  }
  let actionDetail = null

  log(`enhancer-fix: ${classification.summary} [${strategy}]`)

  if (strategy === 'content_add' && resumeData) {
    const count = parseAddCount(message)
    if (classification.codes.includes('add_bullet')) {
      const companyHint = resolveCompanyHint(message, resumeData)
      let candidateBullets = []
      try {
        const generated = await generateExtraExperienceBullets({
          resumeData,
          jdData,
          company: companyHint || resumeData.experience?.[0]?.company,
          count,
          userMessage: message,
        })
        candidateBullets = generated?.bullets || []
      } catch (err) {
        log(`enhancer-fix: LLM bullet generation skipped (${err.message})`)
      }
      const result = addExperienceBulletsToPlan(plan, resumeData, jdData, {
        companyHint,
        count,
        candidateBullets,
      })
      plan = sanitizePlanForContentFix(result.plan, resumeData) || result.plan
      actionDetail = result.added.length
        ? `Added ${result.added.length} new bullet${result.added.length > 1 ? 's' : ''} under ${result.company}.`
        : `Could not invent a unique new bullet for ${result.company || 'that company'} (may already be at the limit).`
      log(`enhancer-fix: ${actionDetail}`)
    }
    if (classification.codes.includes('add_skill')) {
      const skillResult = addSkillsToPlan(plan, resumeData, jdData, { count: Math.max(2, count) })
      plan = skillResult.plan
      const skillNote = skillResult.added.length
        ? `Added skills: ${skillResult.added.join(', ')}.`
        : 'No additional JD skills were available to add.'
      actionDetail = actionDetail ? `${actionDetail} ${skillNote}` : skillNote
      log(`enhancer-fix: ${skillNote}`)
    }
    updateSession(sessionId, { enhancementPlan: plan })
    log('enhancer-fix: rebuilding from original after content add')
    const rebuilt = patchDocx(originalBuffer, plan, {
      highlight: true,
      resumeData,
    })
    workingBuffer = rebuilt.buffer
  } else if (needsRebuild && resumeData) {
    plan = sanitizePlanForContentFix(plan, resumeData)
    updateSession(sessionId, { enhancementPlan: plan })
    log('enhancer-fix: rebuilding from original + sanitized enhancement plan')
    const rebuilt = patchDocx(originalBuffer, plan, {
      highlight: true,
      resumeData,
    })
    workingBuffer = rebuilt.buffer
  } else if (needsRebuild && !resumeData) {
    log('enhancer-fix: no resume data — applying layout repair only')
  }

  // Screenshot or gap report: always run layout repair before QA even if no plan rebuild
  if (isImageEvidence || classification.codes.some((c) => LAYOUT_CODES.has(c) || c === 'section_content_gap')) {
    workingBuffer = repairDocxLayout(workingBuffer)
    log('enhancer-fix: applied layout repair after screenshot/gap classification')
  }

  let qaResult = ensureEnhancedResumeQuality(
    originalBuffer,
    workingBuffer,
    resumeData,
    {
      maxAttempts: 3,
      maxRebuilds: isImageEvidence ? 2 : 1,
      rebuild: plan && resumeData
        ? () => {
          log('enhancer-fix: QA rebuild from original + sanitized plan')
          const cleanPlan = sanitizePlanForContentFix(plan, resumeData) || plan
          const { buffer } = patchDocx(originalBuffer, cleanPlan, {
            highlight: true,
            resumeData,
          })
          return buffer
        }
        : null,
      log,
    },
  )

  if (!qaResult.readyForDownload) {
    log('enhancer-fix: extra repairDocxLayout pass')
    const extra = repairDocxLayout(qaResult.buffer)
    qaResult = ensureEnhancedResumeQuality(originalBuffer, extra, resumeData, {
      maxAttempts: 1,
      maxRebuilds: 0,
      log,
    })
  }

  const previewBuffer = qaResult.buffer
  const afterFingerprint = bufferFingerprint(previewBuffer)
  const fileChanged = beforeFingerprint !== afterFingerprint
  let downloadBuffer = stripHighlights(previewBuffer)
  const finalQa = qaEnhancedResume(originalBuffer, downloadBuffer, resumeData)
  const readyForDownload = Boolean(qaResult.readyForDownload && finalQa.ok)

  if (readyForDownload) {
    downloadBuffer = ensureEnhancedResumeQuality(originalBuffer, downloadBuffer, resumeData, {
      maxAttempts: 1,
      maxRebuilds: 0,
      log,
    }).buffer
  }

  // Always refresh preview so the chat fix is visible even when download stays locked
  setEnhancedDocx(sessionId, downloadBuffer, previewBuffer)

  const layoutQa = {
    ok: readyForDownload,
    readyForDownload,
    highCount: finalQa.highCount,
    mediumCount: finalQa.mediumCount,
    defects: finalQa.defects,
    rebuilds: qaResult.rebuilds || 0,
    focus: classification.focus,
    codes: classification.codes,
    strategy: classification.strategy,
    checks: [
      'page_gaps',
      'blank_spacers',
      'indentation',
      'bullet_alignment',
      'margins',
      'skills_layout',
      'content_preservation',
      'duplicate_bullets',
      'garbled_bullets',
    ],
  }

  let reply
  if (readyForDownload) {
    if (isImageEvidence && !fileChanged) {
      reply = `Analyzed your screenshot (${classification.summary}). Layout checks pass on the file, but the preview may still look wrong — describe the section in text (e.g. "huge gap after SUMMARY") or re-enhance.`
    } else {
      reply = replyForSuccess(classification, { usedUploadedDocx, evidence, actionDetail })
      if (isImageEvidence && visionResult?.summary) {
        reply = `Screenshot: ${visionResult.summary}. ${reply}`
      }
    }
  } else {
    reply = replyForFailure(classification, finalQa, { evidence, actionDetail })
    if (isImageEvidence && visionResult?.summary) {
      reply = `Screenshot: ${visionResult.summary}. ${reply}`
    }
  }

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
    previewUpdated: true,
  }
}
