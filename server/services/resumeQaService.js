import PizZip from 'pizzip'
import { extractDocxPlainText, repairDocxLayout } from './docxService.js'

const SOFT_SKILL_DUMP_PHRASES = [
  'cloud environments',
  'cloud deployments',
  'cloud infrastructure',
  'cloud-native applications',
  'cloud-native platforms',
  'developer-facing',
  'internal tools',
  'ai tools',
  'operations experience',
  'apple equipment',
]

function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function getDocumentXml(buffer) {
  const zip = new PizZip(buffer)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('Invalid DOCX: missing document.xml')
  return { zip, xml: doc.asText() }
}

function isKeepNextEnabled(tag) {
  if (!/<w:keepNext\b/.test(tag)) return false
  if (/w:val="0"/.test(tag) || /w:val="false"/i.test(tag)) return false
  return true
}

function isKeepLinesEnabled(tag) {
  if (!/<w:keepLines\b/.test(tag)) return false
  if (/w:val="0"/.test(tag) || /w:val="false"/i.test(tag)) return false
  return true
}

/**
 * Detect XML pagination traps that commonly create half/full blank pages in Word.
 */
export function findPaginationDefects(xml) {
  const defects = []

  const keepNextHits = [...xml.matchAll(/<w:keepNext\b[^/]*\/>|<w:keepNext\b[\s\S]*?<\/w:keepNext>/g)]
  const enabledKeepNext = keepNextHits.filter((m) => isKeepNextEnabled(m[0]))
  if (enabledKeepNext.length) {
    defects.push({
      code: 'keep_next',
      severity: 'high',
      message: `Enabled keepNext found (${enabledKeepNext.length}) — can force blank pages`,
    })
  }

  const keepLinesHits = [...xml.matchAll(/<w:keepLines\b[^/]*\/>|<w:keepLines\b[\s\S]*?<\/w:keepLines>/g)]
  const enabledKeepLines = keepLinesHits.filter((m) => isKeepLinesEnabled(m[0]))
  if (enabledKeepLines.length > 3) {
    defects.push({
      code: 'keep_lines',
      severity: 'medium',
      message: `Enabled keepLines found (${enabledKeepLines.length})`,
    })
  }

  if (/<w:br\b[^>]*w:type="page"/.test(xml)) {
    defects.push({
      code: 'page_break',
      severity: 'high',
      message: 'Explicit page break found in document body',
    })
  }

  if (/<w:cantSplit\b/.test(xml)) {
    defects.push({
      code: 'cant_split',
      severity: 'medium',
      message: 'Table cantSplit found — rows may leave blank page regions',
    })
  }

  const hugeSpacing = []
  for (const m of xml.matchAll(/<w:spacing\b[^/]*\/>/g)) {
    const tag = m[0]
    const after = /(?:^|\s)w:after="(\d+)"/.exec(tag)
    const before = /(?:^|\s)w:before="(\d+)"/.exec(tag)
    const a = after ? parseInt(after[1], 10) : 0
    const b = before ? parseInt(before[1], 10) : 0
    // ~0.5 inch+ after/before is enough to look like a page gap on resumes
    if (a >= 720 || b >= 720) hugeSpacing.push({ a, b, tag })
  }
  if (hugeSpacing.length) {
    defects.push({
      code: 'huge_spacing',
      severity: 'high',
      message: `Oversized paragraph spacing found (${hugeSpacing.length}) — likely page gaps`,
      samples: hugeSpacing.slice(0, 3),
    })
  }

  if (/<w:framePr\b/.test(xml)) {
    defects.push({
      code: 'frame',
      severity: 'medium',
      message: 'Floating frame properties found — can create blank regions',
    })
  }

  const tallRows = [...xml.matchAll(/<w:trHeight\b[^>]*w:val="(\d+)"[^/]*\/>/g)]
    .filter((m) => parseInt(m[1], 10) > 800)
  if (tallRows.length) {
    defects.push({
      code: 'tall_row',
      severity: 'medium',
      message: `Fixed tall table rows found (${tallRows.length})`,
    })
  }

  return defects
}

/**
 * Soft JD skill dumps that break Technical Skills layouts.
 */
export function findSkillsDumpDefects(xml) {
  const defects = []
  const lower = xml.toLowerCase()
  const hits = SOFT_SKILL_DUMP_PHRASES.filter((p) => lower.includes(p))
  if (hits.length >= 2) {
    defects.push({
      code: 'skills_dump',
      severity: 'high',
      message: `Soft JD skill dump phrases detected: ${hits.slice(0, 4).join(', ')}`,
      phrases: hits,
    })
  }
  return defects
}

/**
 * Ensure key original resume content still exists in the enhanced DOCX.
 */
export function findContentLossDefects(originalText, enhancedText, resumeData) {
  const defects = []
  const orig = normalize(originalText)
  const enh = normalize(enhancedText)

  if (!enh || enh.length < 80) {
    defects.push({
      code: 'empty_enhanced',
      severity: 'high',
      message: 'Enhanced resume text is empty or too short',
    })
    return defects
  }

  // Enhanced should not be drastically shorter than original (content wiped)
  if (orig.length > 400 && enh.length < orig.length * 0.55) {
    defects.push({
      code: 'content_shrink',
      severity: 'high',
      message: `Enhanced text shrank too much (${enh.length}/${orig.length} chars)`,
    })
  }

  const name = (resumeData?.name || '').trim()
  if (name && name.length >= 3 && !enh.includes(normalize(name))) {
    // Allow partial last-name match
    const parts = name.split(/\s+/).filter((p) => p.length > 2)
    const last = parts[parts.length - 1]
    if (last && !enh.includes(normalize(last))) {
      defects.push({
        code: 'missing_name',
        severity: 'high',
        message: `Candidate name missing from enhanced resume: ${name}`,
      })
    }
  }

  for (const exp of resumeData?.experience || []) {
    const company = (exp.company || '').split(/[|,•]/)[0].trim()
    if (!company || company.length < 3) continue
    if (!enh.includes(normalize(company))) {
      defects.push({
        code: 'missing_company',
        severity: 'high',
        message: `Company missing from enhanced resume: ${company}`,
      })
    }
  }

  return defects
}

/**
 * Full QA gate for an enhanced DOCX before download/preview.
 */
export function qaEnhancedResume(originalBuffer, enhancedBuffer, resumeData = null) {
  const { xml } = getDocumentXml(enhancedBuffer)
  const defects = [
    ...findPaginationDefects(xml),
    ...findSkillsDumpDefects(xml),
  ]

  try {
    const originalText = extractDocxPlainText(originalBuffer)
    const enhancedText = extractDocxPlainText(enhancedBuffer)
    defects.push(...findContentLossDefects(originalText, enhancedText, resumeData))
  } catch (err) {
    defects.push({
      code: 'qa_text_error',
      severity: 'medium',
      message: `Could not compare resume text: ${err.message}`,
    })
  }

  const high = defects.filter((d) => d.severity === 'high')
  return {
    ok: high.length === 0,
    defects,
    highCount: high.length,
    mediumCount: defects.filter((d) => d.severity === 'medium').length,
  }
}

/**
 * Repair enhanced DOCX based on QA defects. Deterministic — no AI.
 * Returns { buffer, repaired, actions }
 */
export function repairEnhancedResume(enhancedBuffer, qaResult) {
  const codes = new Set((qaResult?.defects || []).map((d) => d.code))
  const actions = []
  let buffer = enhancedBuffer

  const needsLayout = ['keep_next', 'keep_lines', 'page_break', 'cant_split', 'huge_spacing', 'frame', 'tall_row']
    .some((c) => codes.has(c))

  if (needsLayout || !qaResult?.ok) {
    buffer = repairDocxLayout(buffer)
    actions.push('layout_sanitize')
  }

  if (codes.has('skills_dump')) {
    buffer = stripSoftSkillDumpPhrases(buffer)
    actions.push('strip_skills_dump')
  }

  return { buffer, repaired: actions.length > 0, actions }
}

function stripSoftSkillDumpPhrases(docxBuffer) {
  const zip = new PizZip(docxBuffer)
  const doc = zip.file('word/document.xml')
  if (!doc) return docxBuffer
  let xml = doc.asText()

  for (const phrase of SOFT_SKILL_DUMP_PHRASES) {
    // Remove phrase from text nodes, clean leftover commas
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (full, open, text, close) => {
      if (!re.test(text)) return full
      let next = text.replace(re, '')
      next = next.replace(/\s*,\s*,+/g, ', ').replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '')
      return `${open}${next}${close}`
    })
  }

  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Run QA → repair → re-QA up to maxAttempts.
 * Always returns a buffer safe to download (best effort).
 */
export function ensureEnhancedResumeQuality(originalBuffer, enhancedBuffer, resumeData, {
  maxAttempts = 2,
  log = () => {},
} = {}) {
  let buffer = enhancedBuffer
  let qa = qaEnhancedResume(originalBuffer, buffer, resumeData)
  const history = [{ attempt: 0, ok: qa.ok, defects: qa.defects.map((d) => d.code) }]

  if (qa.ok) {
    log('qa: passed')
    return { buffer, qa, repaired: false, history }
  }

  log(`qa: failed (${qa.defects.map((d) => d.code).join(', ')}) — repairing`)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { buffer: next, actions } = repairEnhancedResume(buffer, qa)
    buffer = next
    qa = qaEnhancedResume(originalBuffer, buffer, resumeData)
    history.push({
      attempt,
      ok: qa.ok,
      actions,
      defects: qa.defects.map((d) => d.code),
    })
    log(`qa repair #${attempt}: ${actions.join('+') || 'none'} → ${qa.ok ? 'pass' : qa.defects.map((d) => d.code).join(',')}`)
    if (qa.ok) break
  }

  return {
    buffer,
    qa,
    repaired: history.length > 1,
    history,
  }
}
