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

function getSpacingTwipsFromTag(tag) {
  if (!tag) return { before: 0, after: 0 }
  const after = /(?:^|\s)w:after="(\d+)"/.exec(tag)
  const before = /(?:^|\s)w:before="(\d+)"/.exec(tag)
  const afterLines = /w:afterLines="(\d+)"/.exec(tag)
  const beforeLines = /w:beforeLines="(\d+)"/.exec(tag)
  let a = after ? parseInt(after[1], 10) : 0
  let b = before ? parseInt(before[1], 10) : 0
  if (!after && afterLines) a = Math.round(parseInt(afterLines[1], 10) * 240)
  if (!before && beforeLines) b = Math.round(parseInt(beforeLines[1], 10) * 240)
  return { before: b, after: a }
}

function getParagraphSpacingTwips(para) {
  const spacingTag = para.match(/<w:spacing\b[^/]*\/>/)?.[0] || ''
  return getSpacingTwipsFromTag(spacingTag)
}

/**
 * Detect huge vertical gaps between a section heading and its first content line.
 * Catches the common "SUMMARY header at top, bullets at bottom of page" failure.
 */
export function findSectionContentGapDefects(xml) {
  const defects = []
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((m) => m[0])
  const isSectionHeading = (plain) => plain.length > 0
    && plain.length < 72
    && /^(?:professional\s+)?(?:summary|profile|objective|experience|work experience|professional experience|education|skills|technical skills|certifications|projects)\b/i.test(plain)

  for (let i = 0; i < paras.length - 1; i += 1) {
    const plain = [...paras[i].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
    if (!isSectionHeading(plain)) continue

    let spacerParas = 0
    let firstContent = null
    for (let j = i + 1; j < Math.min(i + 10, paras.length); j += 1) {
      const p2 = [...paras[j].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
      const spacing = getParagraphSpacingTwips(paras[j])
      if (!p2) {
        if (spacing.before >= 120 || spacing.after >= 120) spacerParas += 1
        continue
      }
      if (isSectionHeading(p2)) break
      firstContent = { para: paras[j], spacing, index: j }
      break
    }

    if (!firstContent) continue
    const gapParas = firstContent.index - i - 1
    // Only high-severity when empties actually have large spacing (real visual gap)
    if (spacerParas >= 1) {
      defects.push({
        code: 'section_content_gap',
        severity: 'high',
        message: `Large spacer chain after "${plain}" (${spacerParas} spaced empty paragraphs)`,
      })
    } else if (gapParas >= 3) {
      defects.push({
        code: 'section_content_gap',
        severity: 'medium',
        message: `Empty paragraphs after "${plain}" (${gapParas}) — likely structural`,
      })
    }
    if (firstContent.spacing.before >= 480 || firstContent.spacing.after >= 480) {
      defects.push({
        code: 'section_content_gap',
        severity: 'high',
        message: `Oversized spacing after "${plain}" (before=${firstContent.spacing.before}, after=${firstContent.spacing.after})`,
      })
    }
  }

  // Tall table rows push content to bottom of page
  for (const m of xml.matchAll(/<w:trHeight\b[^>]*w:val="(\d+)"[^/]*\/>/g)) {
    const n = parseInt(m[1], 10)
    if (n > 2400) {
      defects.push({
        code: 'tall_row',
        severity: 'high',
        message: `Very tall table row (${n} twips) — content may sit at page bottom`,
      })
    }
  }

  const seen = new Set()
  return defects.filter((d) => {
    if (seen.has(d.message)) return false
    seen.add(d.message)
    return true
  })
}

/**
 * Detect empty / spacer paragraphs that create visible half-page or full-page gaps.
 * Only flag REAL layout traps — normal empty structural paras must not lock download.
 */
export function findBlankGapDefects(xml) {
  const defects = []
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((m) => m[0])
  let emptyRun = 0
  let largeSpacerParas = 0
  let largeContentSpacing = 0

  for (const para of paras) {
    const plain = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
    const { after: a, before: b } = getParagraphSpacingTwips(para)

    if (!plain) {
      emptyRun += 1
      // Only count empty paras that actually push content (large spacing)
      if (a >= 360 || b >= 360) largeSpacerParas += 1
      continue
    }
    // Long empty runs with no spacing are usually table/structure noise — medium only
    if (emptyRun >= 4) {
      defects.push({
        code: 'blank_page_gap',
        severity: 'medium',
        message: `Long empty paragraph run (${emptyRun}) — usually structural, not a page gap`,
      })
    }
    emptyRun = 0

    const isBullet = /w:numPr/.test(para) || /^[•\u2022\-–]/.test(plain)
    // ~0.35"+ spacing on content is a real visual gap
    if (isBullet && (a >= 360 || b >= 360)) largeContentSpacing += 1
    else if (a >= 480 || b >= 480) largeContentSpacing += 1
  }

  if (largeSpacerParas > 0) {
    defects.push({
      code: 'blank_page_gap',
      severity: 'high',
      message: `Blank/spacer paragraphs creating page gaps (${largeSpacerParas})`,
    })
  }
  if (largeContentSpacing > 0) {
    defects.push({
      code: 'resume_gap_spacing',
      severity: 'high',
      message: `Oversized spacing on content lines (${largeContentSpacing}) — likely resume gaps`,
    })
  }

  return defects
}

/**
 * Detect bullet indent stagger within the same experience block (original vs enhanced drift).
 * Only compares bullets at the same list level — nested bullets are not defects.
 */
export function findIndentConsistencyDefects(xml) {
  const defects = []
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((m) => m[0])

  const layoutKey = (para) => {
    const ilvl = /w:ilvl\s[^>]*w:val="(\d+)"/.exec(para)
    const left = /w:ind\b[^>]*w:left="(\d+)"/.exec(para)
    const hanging = /w:ind\b[^>]*w:hanging="(\d+)"/.exec(para)
    const hasNum = /w:numPr/.test(para) ? '1' : '0'
    return [
      hasNum,
      ilvl ? ilvl[1] : 'x',
      left ? left[1] : 'x',
      hanging ? hanging[1] : 'x',
    ].join(':')
  }

  const isBulletPara = (para) => {
    const plain = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
    if (!plain || plain.length < 12) return false
    if (/w:numPr/.test(para)) return true
    return /^[•\u2022\-–]\s?/.test(plain)
  }

  const isSectionHeading = (para) => {
    const plain = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
    if (!plain || plain.length > 80) return false
    return /^(?:professional\s+)?(?:summary|experience|education|skills|technical skills|work experience|certifications|projects)\b/i.test(plain)
  }

  let block = []
  const flush = () => {
    if (block.length < 3) {
      block = []
      return
    }
    // Group by list level so nested bullets don't look like stagger
    const byLevel = new Map()
    for (const key of block) {
      const level = key.split(':')[1] || 'x'
      if (!byLevel.has(level)) byLevel.set(level, [])
      byLevel.get(level).push(key)
    }
    for (const [, keys] of byLevel) {
      if (keys.length < 3) continue
      const counts = new Map()
      for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1)
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const [majorityKey, majorityCount] = sorted[0]
      const minority = keys.length - majorityCount
      if (minority < 1 || majorityCount < 2 || sorted.length < 2) continue
      const lefts = sorted.map(([k]) => {
        const leftPart = k.split(':')[2]
        return leftPart === 'x' ? null : parseInt(leftPart, 10)
      }).filter((n) => Number.isFinite(n))
      if (lefts.length < 2) continue
      const min = Math.min(...lefts)
      const max = Math.max(...lefts)
      if (max - min >= 180) {
        defects.push({
          code: 'indent_inconsistency',
          severity: 'high',
          message: `Bullet indent stagger in a block (${minority}/${keys.length} off majority ${majorityKey})`,
        })
      }
    }
    block = []
  }

  for (const para of paras) {
    if (isSectionHeading(para)) {
      flush()
      continue
    }
    if (isBulletPara(para)) {
      block.push(layoutKey(para))
      continue
    }
    // Company/role lines end a bullet block
    const plain = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('').trim()
    if (plain && !isBulletPara(para)) flush()
  }
  flush()

  const seen = new Set()
  return defects.filter((d) => {
    if (seen.has(d.message)) return false
    seen.add(d.message)
    return true
  })
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

  // List bullets without explicit keepNext=0 still inherit style keepNext → blank pages
  const listParas = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].filter((m) => {
    const para = m[0]
    return /w:numPr/.test(para) || /w:pStyle\s[^>]*w:val="[^"]*List/i.test(para)
  })
  let missingOverride = 0
  for (const m of listParas) {
    const para = m[0]
    const pPr = para.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)
    if (!pPr || !/<w:keepNext\b[^>]*w:val="0"/.test(pPr[0])) missingOverride += 1
  }
  if (missingOverride > 0) {
    defects.push({
      code: 'missing_keepnext_override',
      severity: 'high',
      message: `${missingOverride} list paragraphs missing explicit keepNext=0 override`,
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
    const { after: a, before: b } = getSpacingTwipsFromTag(m[0])
    // ~0.35 inch+ after/before is enough to look like a page gap on resumes
    if (a >= 480 || b >= 480) hugeSpacing.push({ a, b, tag: m[0] })
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

  // Geometry traps: huge left margins / skinny columns / extreme indents
  defects.push(...findGeometryDefects(xml))
  defects.push(...findBlankGapDefects(xml))
  defects.push(...findSectionContentGapDefects(xml))
  defects.push(...findIndentConsistencyDefects(xml))

  return defects
}

/**
 * Detect layout geometry that causes huge left gaps, vertical section titles,
 * and clipped leading letters after enhance.
 */
export function findGeometryDefects(xml) {
  const defects = []

  for (const m of xml.matchAll(/<w:pgMar\b[^/]*\/>/g)) {
    const left = /w:left="(\d+)"/.exec(m[0])
    const n = left ? parseInt(left[1], 10) : 0
    if (n > 1440) {
      defects.push({
        code: 'huge_page_margin',
        severity: 'high',
        message: `Page left margin too large (${n} twips) — content will look shoved right`,
      })
      break
    }
  }

  let skinnyCols = 0
  for (const m of xml.matchAll(/<w:gridCol\b[^/]*\/>/g)) {
    const w = /w:w="(\d+)"/.exec(m[0])
    const n = w ? parseInt(w[1], 10) : 0
    // Align with MIN_ANY_COL (2160) — 1600 still letter-wraps "Business"
    if (n > 0 && n < 2160) skinnyCols += 1
  }
  for (const m of xml.matchAll(/<w:tcW\b[^/]*\/>/g)) {
    if (/w:type="pct"/.test(m[0])) {
      skinnyCols += 1
      continue
    }
    const w = /w:w="(\d+)"/.exec(m[0])
    const n = w ? parseInt(w[1], 10) : 0
    if (n > 0 && n < 2160) skinnyCols += 1
  }
  if (skinnyCols > 0) {
    defects.push({
      code: 'narrow_table_col',
      severity: 'high',
      message: `Narrow table column(s) found (${skinnyCols}) — section titles may wrap vertically`,
    })
  }

  if (/<w:textDirection\b/.test(xml)) {
    defects.push({
      code: 'text_direction',
      severity: 'high',
      message: 'Vertical textDirection found on table cells',
    })
  }

  let extremeInd = 0
  for (const m of xml.matchAll(/<w:ind\b[^/]*\/>/g)) {
    const left = /w:left="(\d+)"/.exec(m[0])
    const hang = /w:hanging="(\d+)"/.exec(m[0])
    const n = left ? parseInt(left[1], 10) : 0
    const hanging = hang ? parseInt(hang[1], 10) : 0
    // Tab-column skills use large left≈hanging — not a layout defect
    if (hanging >= 720 && n >= hanging - 240) continue
    if (n > 1440) extremeInd += 1
  }
  if (extremeInd > 0) {
    defects.push({
      code: 'extreme_indent',
      severity: 'high',
      message: `Extreme left indent found (${extremeInd}) — causes large left whitespace`,
    })
  }

  // Mashed skills: multiple Category: labels in one paragraph inside skills section
  const skillsHeading = /<(?:w:t)[^>]*>[^<]*(?:technical skills|core competencies|skills)[^<]*<\/w:t>/i.exec(xml)
  if (skillsHeading) {
    const from = skillsHeading.index
    const nextSection = xml.slice(from + 1).search(
      /<(?:w:t)[^>]*>[^<]*(?:professional experience|work experience|education|certifications|projects)[^<]*<\/w:t>/i,
    )
    const skillsXml = nextSection === -1 ? xml.slice(from) : xml.slice(from, from + 1 + nextSection)
    const mashed = []
    for (const m of skillsXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
      const plain = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(' ')
      if (/^(?:technical\s+)?skills$|core competencies/i.test(plain.trim())) continue
      const labels = plain.match(/\b[A-Z][A-Za-z0-9 &/+-]{1,42}:\s/g) || []
      if (labels.length >= 2) mashed.push(plain.slice(0, 120))
    }
    if (mashed.length) {
      defects.push({
        code: 'skills_mashed',
        severity: 'high',
        message: `Skills categories mashed into one line (${mashed.length})`,
        samples: mashed.slice(0, 2),
      })
    }
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
 * Company matching is fuzzy — parsed names often differ slightly from DOCX text
 * and must NEVER permanently lock download.
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

  const companyPresent = (companyRaw) => {
    const company = String(companyRaw || '').split(/[|,•]/)[0].trim()
    if (!company || company.length < 3) return true
    const cn = normalize(company)
    if (enh.includes(cn)) return true
    // Brand token: first significant word (≥4 chars), e.g. Capgemini / Cerebrone / Concordia
    const tokens = cn.split(/\s+/).filter((t) => t.length >= 4 && !/^(inc|llc|ltd|corp|co|the|and)$/.test(t))
    if (tokens.some((t) => enh.includes(t))) return true
    // Compact form without spaces/punctuation
    const compact = cn.replace(/[^a-z0-9]/g, '')
    if (compact.length >= 5 && enh.replace(/[^a-z0-9]/g, '').includes(compact)) return true
    return false
  }

  let missingCompanies = 0
  for (const exp of resumeData?.experience || []) {
    if (companyPresent(exp.company)) continue
    missingCompanies += 1
    defects.push({
      code: 'missing_company',
      // Advisory only — fuzzy parse mismatches must not lock download
      severity: 'medium',
      message: `Company not clearly matched in enhanced resume: ${exp.company}`,
    })
  }

  // Only hard-fail if EVERY experience company is gone (likely wiped document)
  if (
    missingCompanies > 0
    && (resumeData?.experience || []).length > 0
    && missingCompanies >= (resumeData.experience || []).length
  ) {
    defects.push({
      code: 'content_shrink',
      severity: 'high',
      message: 'All experience companies missing from enhanced resume',
    })
  }

  return defects
}

/**
 * Codes that must block download if still high after repair/rebuild.
 * Everything else is advisory — users must still be able to download.
 */
const DOWNLOAD_BLOCKING_CODES = new Set([
  'empty_enhanced',
  'content_shrink',
  'missing_name',
  'keep_next',
  'page_break',
  'huge_spacing',
  'huge_page_margin',
  'extreme_indent',
  'text_direction',
  'narrow_table_col',
  'skills_mashed',
  'skills_dump',
  'section_content_gap',
  'resume_gap_spacing',
  'blank_page_gap',
  'indent_inconsistency',
  'missing_keepnext_override',
])

/**
 * Soft advisory codes that should never permanently lock download after repair attempts.
 */
const NON_BLOCKING_AFTER_REPAIR = new Set([
  'missing_company',
  'qa_text_error',
  'keep_lines',
  'cant_split',
  'frame',
  'tall_row',
])

function blockingHighDefects(qa) {
  return (qa?.defects || []).filter(
    (d) => d.severity === 'high' && DOWNLOAD_BLOCKING_CODES.has(d.code),
  )
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
  const blocking = high.filter((d) => DOWNLOAD_BLOCKING_CODES.has(d.code))
  return {
    ok: blocking.length === 0,
    defects,
    highCount: high.length,
    mediumCount: defects.filter((d) => d.severity === 'medium').length,
    blockingCount: blocking.length,
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

  const needsLayout = [
    'keep_next',
    'keep_lines',
    'page_break',
    'cant_split',
    'huge_spacing',
    'frame',
    'tall_row',
    'missing_keepnext_override',
    'huge_page_margin',
    'narrow_table_col',
    'text_direction',
    'extreme_indent',
    'skills_mashed',
    'blank_page_gap',
    'resume_gap_spacing',
    'section_content_gap',
    'indent_inconsistency',
  ].some((c) => codes.has(c))

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
 * Run QA → repair → re-QA (and optional rebuild) until the resume is download-ready.
 * Returns readyForDownload=true only when high-severity defects are gone.
 */
export function ensureEnhancedResumeQuality(originalBuffer, enhancedBuffer, resumeData, {
  maxAttempts = 3,
  rebuild = null,
  maxRebuilds = 3,
  log = () => {},
} = {}) {
  // Permanent: always run layout repair + skills-dump strip after enhance
  let buffer = repairDocxLayout(enhancedBuffer)
  buffer = stripSoftSkillDumpPhrases(buffer)
  let qa = qaEnhancedResume(originalBuffer, buffer, resumeData)
  const history = [{ attempt: 0, ok: qa.ok, defects: qa.defects.map((d) => d.code), actions: ['layout_sanitize', 'strip_skills_dump'] }]

  const runRepairLoop = (startAttempt = 1) => {
    for (let attempt = startAttempt; attempt <= maxAttempts; attempt += 1) {
      if (qa.ok) break
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
    }
  }

  if (qa.ok) {
    log('qa: passed (after mandatory layout repair)')
  } else {
    log(`qa: failed (${qa.defects.map((d) => d.code).join(', ')}) — repairing`)
    runRepairLoop(1)
  }

  // If still failing, rebuild from original DOCX + same plan, then re-check
  let rebuilds = 0
  while (!qa.ok && typeof rebuild === 'function' && rebuilds < maxRebuilds) {
    rebuilds += 1
    log(`qa: rebuilding enhanced DOCX from original (attempt ${rebuilds})`)
    try {
      const rebuilt = rebuild({ attempt: rebuilds, qa, buffer })
      if (!rebuilt) break
      buffer = repairDocxLayout(rebuilt)
      qa = qaEnhancedResume(originalBuffer, buffer, resumeData)
      history.push({
        attempt: `rebuild-${rebuilds}`,
        ok: qa.ok,
        actions: ['rebuild_from_original', 'layout_sanitize'],
        defects: qa.defects.map((d) => d.code),
      })
      if (!qa.ok) {
        log(`qa: rebuild #${rebuilds} still failing — ${qa.defects.map((d) => d.code).join(', ')}`)
        runRepairLoop(1)
      } else {
        log(`qa: rebuild #${rebuilds} passed`)
      }
    } catch (err) {
      log(`qa: rebuild #${rebuilds} error — ${err.message}`)
      history.push({
        attempt: `rebuild-${rebuilds}`,
        ok: false,
        actions: ['rebuild_error'],
        defects: [err.message],
      })
      break
    }
  }

  const readyBlocking = blockingHighDefects(qa)
  // After repair/rebuild: unlock if only advisory leftovers remain
  let readyForDownload = readyBlocking.length === 0
  if (!readyForDownload && rebuilds >= maxRebuilds) {
    const residual = readyBlocking.map((d) => d.code)
    // Soft unlock only when residual defects are empty-para noise that repair already sanitized
    const onlySoftBlank = residual.every((c) => c === 'blank_page_gap' || NON_BLOCKING_AFTER_REPAIR.has(c))
    if (onlySoftBlank) {
      readyForDownload = true
      log(`qa: soft-unlock after rebuilds — residual advisory: ${residual.join(', ')}`)
      qa = {
        ...qa,
        ok: true,
        defects: qa.defects.map((d) => (
          d.severity === 'high' && (d.code === 'blank_page_gap' || NON_BLOCKING_AFTER_REPAIR.has(d.code))
            ? { ...d, severity: 'medium', message: `${d.message} (advisory — download unlocked)` }
            : d
        )),
        highCount: qa.defects.filter((d) => d.severity === 'high' && DOWNLOAD_BLOCKING_CODES.has(d.code) && d.code !== 'blank_page_gap').length,
      }
    }
  }

  if (readyForDownload) {
    log('qa: resume verified — ready for download')
  } else {
    log(`qa: blocked download — remaining defects: ${readyBlocking.map((d) => d.code).join(', ')}`)
  }

  return {
    buffer,
    qa,
    repaired: true,
    history,
    readyForDownload,
    rebuilds,
  }
}
