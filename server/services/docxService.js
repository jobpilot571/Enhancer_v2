import PizZip from 'pizzip'

const SECTION_ANCHORS = {
  summary: ['professional summary', 'summary', 'profile', 'objective'],
  skills: ['technical skills', 'skills', 'core competencies', 'technologies'],
  experience: ['work experience', 'professional experience', 'professional experience', 'experience'],
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unescapeXml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function markTag(kind) {
  if (!kind) return ''
  if (kind === 'new') return '<w:shd w:val="clear" w:color="auto" w:fill="D1FAE5"/>'
  if (kind === 'rewrite') return '<w:shd w:val="clear" w:color="auto" w:fill="FEF9C3"/>'
  return ''
}

function stripShading(rPr) {
  if (!rPr) return ''
  return rPr
    .replace(/<w:shd[^/]*\/>/g, '')
    .replace(/<w:highlight[^/]*\/>/g, '')
}

function stripBold(rPr) {
  if (!rPr) return ''
  return rPr
    .replace(/<w:b\s*\/>/g, '')
    .replace(/<w:b\s[^/]*\/>/g, '')
    .replace(/<w:bCs\s*\/>/g, '')
    .replace(/<w:bCs\s[^/]*\/>/g, '')
    .replace(/<w:b\b[^>]*>[\s\S]*?<\/w:b>/g, '')
    .replace(/<w:bCs\b[^>]*>[\s\S]*?<\/w:bCs>/g, '')
}

function stripUnderline(rPr) {
  if (!rPr) return ''
  return rPr
    .replace(/<w:u\s*\/>/g, '')
    .replace(/<w:u\s[^/]*\/>/g, '')
    .replace(/<w:u\b[^>]*>[\s\S]*?<\/w:u>/g, '')
}

/** Remove bold from paragraph-level rPr so new bullets are not wholly bold. */
function stripBoldFromPPr(pPr) {
  if (!pPr) return ''
  return pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (rPr) => stripUnderline(stripBold(rPr)))
}

function isBoldRPr(rPr) {
  if (!rPr) return false
  return /<w:b[\s/>]/.test(rPr) || /<w:bCs[\s/>]/.test(rPr)
}

function applyMarkToRPr(rPr, mark) {
  const shading = markTag(mark)
  if (!shading) return rPr || ''
  const base = stripShading(rPr)
  if (base) return base.replace('</w:rPr>', `${shading}</w:rPr>`)
  return `<w:rPr>${shading}</w:rPr>`
}

function getPlainTextFromParagraph(paraXml) {
  return [...paraXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join('')
    .replace(/^\s*[•\u2022]\s*/, '')
    .trim()
}

/** True start of a paragraph — must not match <w:pPr>, <w:pgSz>, etc. */
function isParagraphOpenAt(xml, idx) {
  if (idx < 0 || xml.slice(idx, idx + 4) !== '<w:p') return false
  const ch = xml[idx + 4]
  return ch === '>' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
}

function findParagraphStart(xml, beforeIndex) {
  let searchFrom = beforeIndex
  while (searchFrom > 0) {
    const idx = xml.lastIndexOf('<w:p', searchFrom - 1)
    if (idx === -1) return -1
    if (isParagraphOpenAt(xml, idx)) return idx
    searchFrom = idx
  }
  return -1
}

function findNextParagraphStart(xml, fromIndex, end = xml.length) {
  let pos = fromIndex
  while (pos < end) {
    const idx = xml.indexOf('<w:p', pos)
    if (idx === -1 || idx >= end) return -1
    if (isParagraphOpenAt(xml, idx)) return idx
    pos = idx + 4
  }
  return -1
}

function getParagraphChunk(xml, paragraphEnd) {
  const start = findParagraphStart(xml, paragraphEnd)
  if (start === -1) return ''
  return xml.slice(start, paragraphEnd)
}

function isBulletParagraph(chunk) {
  if (!chunk) return false
  // Real list markers only — do NOT treat plain indentation as a bullet
  if (/w:numPr/.test(chunk) || /w:ilvl/.test(chunk)) return true
  if (/w:pStyle\s[^>]*w:val="[^"]*List/i.test(chunk)) return true
  if (/<w:t[^>]*>[^<]*[•\u2022▪◦]/.test(chunk)) return true
  return false
}

function getRawParagraphText(chunk) {
  return [...chunk.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join('')
}

function detectLiteralBulletPrefix(chunk) {
  const raw = getRawParagraphText(chunk)
  const m = raw.match(/^(\s*[•\u2022▪◦]\s+)/)
  return m ? m[1] : ''
}

/** Strip leading bullet glyphs / dashes so we never create "• • text". */
function stripLeadingBulletGlyphs(text) {
  let t = (text || '').trim()
  // Repeat until no leading bullet/dash markers remain (handles "• • text")
  for (let i = 0; i < 5; i += 1) {
    const next = t.replace(/^(?:[•\u2022▪◦\-\*]+\s*)+/, '').trim()
    if (next === t) break
    t = next
  }
  return t
}

/**
 * Keep summary/experience bullets short (~2 lines in typical resume fonts).
 */
function clampBulletLength(text, maxChars = 155) {
  let t = stripLeadingBulletGlyphs(text)
  if (!t) return ''
  if (t.length <= maxChars) return t
  const cut = t.slice(0, maxChars)
  const at = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','), cut.lastIndexOf(' '))
  const trimmed = (at > 80 ? cut.slice(0, at) : cut).trim().replace(/[,;:\-–—]+$/, '')
  return `${trimmed}.`
}

/** True short skill/tool names only — reject JD sentences and soft benefits. */
function isValidSkillName(skill) {
  const s = (skill || '').trim()
  if (!s) return false
  if (s.length > 42) return false
  if (s.split(/\s+/).length > 5) return false
  if (/[.!?]/.test(s)) return false
  if (/,.*,/.test(s)) return false // multi-clause dumps
  const lower = s.toLowerCase()
  const banned = [
    'pto', 'flexible', 'apple equipment', 'track record', 'customer engagement',
    'technical fluency', 'owning complex', 'build integrations', 'salary',
    'benefits', 'remote work', 'work from home', 'equal opportunity',
  ]
  if (banned.some((b) => lower.includes(b))) return false
  // Prefer tool-like tokens (letters/numbers/+/#/.)
  if (!/[a-z0-9]/i.test(s)) return false
  return true
}

function getRunText(runXml) {
  return [...runXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join('')
}

function getRunRPr(runXml) {
  const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
  return rPrMatch ? stripShading(rPrMatch[0]) : ''
}

/**
 * Read original resume run styles:
 * - baseRPr: normal body text (never whole-bullet bold)
 * - boldRPr: keyword highlight style, if the resume uses it
 * - boldPhrases: exact bold snippets from the template (e.g. "Kubernetes", "AWS")
 */
function extractRunStyles(chunk) {
  const runs = [...chunk.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map((m) => m[0])
  const paraPlain = getPlainTextFromParagraph(chunk)
  const paraLen = paraPlain.length || 1

  let baseRPr = ''
  let boldRPr = ''
  const boldPhrases = []
  let hasNormalText = false
  let boldKeywordRuns = 0

  for (const run of runs) {
    const text = getRunText(run)
    const cleaned = text.replace(/^[•\u2022▪◦\-\*\s]+/, '').trim()
    if (!cleaned) continue

    const rPr = getRunRPr(run)
    const bold = isBoldRPr(rPr)

    if (bold) {
      if (!boldRPr) boldRPr = rPr
      // Keyword-sized bold only — skip whole-bullet bold runs
      const isKeywordSized = cleaned.length >= 2
        && cleaned.length <= 48
        && cleaned.length < paraLen * 0.55
      if (isKeywordSized) {
        boldKeywordRuns += 1
        boldPhrases.push(cleaned)
      }
    } else {
      hasNormalText = true
      if (!baseRPr) baseRPr = rPr
    }
  }

  // Resume bolds only keywords when normal body text exists alongside short bold runs
  const keywordBold = hasNormalText && boldKeywordRuns > 0

  // If we only found bold runs, strip bold for body text (don't make whole new bullets bold)
  if (!baseRPr && boldRPr) {
    baseRPr = stripBold(boldRPr)
  }
  // Always ensure body style is not bold — keyword bolding is applied per-run only
  baseRPr = stripBold(baseRPr)

  if (!boldRPr && baseRPr) {
    boldRPr = baseRPr.includes('</w:rPr>')
      ? baseRPr.replace('</w:rPr>', '<w:b/><w:bCs/></w:rPr>')
      : '<w:rPr><w:b/><w:bCs/></w:rPr>'
  } else if (boldRPr) {
    // Keep fonts from bold run but that's fine for keyword spans
  }

  return {
    baseRPr: baseRPr || '',
    boldRPr: boldRPr || '',
    keywordBold,
    boldPhrases: uniqueBoldPhrases(boldPhrases),
  }
}

function uniqueBoldPhrases(phrases) {
  const out = []
  const seen = new Set()
  for (const p of phrases || []) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  // Longer phrases first so "Azure DevOps" wins over "Azure"
  return out.sort((a, b) => b.length - a.length)
}

function collectBoldPhrasesFromEnds(xml, ends) {
  const phrases = []
  for (const end of ends || []) {
    const chunk = getParagraphChunk(xml, end)
    if (!chunk) continue
    phrases.push(...extractRunStyles(chunk).boldPhrases)
  }
  return uniqueBoldPhrases(phrases)
}

/**
 * Split text into normal / bold runs using phrases the original resume bolds.
 * If the resume does not use keyword bolding, return a single normal run.
 */
function buildTextRuns(text, template, mark) {
  const cleanText = stripLeadingBulletGlyphs(text)
  // Word list numbering already draws the bullet — never also prefix "• "
  const useLiteral = !template.hasNumPr && !!template.literalPrefix
  const prefix = useLiteral ? template.literalPrefix : ''
  const full = `${prefix}${cleanText}`
  const baseRPr = applyMarkToRPr(stripUnderline(stripBold(template.baseRPr || template.rPr || '')), mark)

  if (!template.keywordBold || !(template.boldPhrases || []).length) {
    return `<w:r>${baseRPr}<w:t xml:space="preserve">${escapeXml(full)}</w:t></w:r>`
  }

  const boldRPr = applyMarkToRPr(template.boldRPr || template.baseRPr || '', mark)
  const phrases = template.boldPhrases
  const lower = full.toLowerCase()
  const parts = []
  let cursor = 0

  while (cursor < full.length) {
    let hitAt = -1
    let hitPhrase = null
    for (const phrase of phrases) {
      const idx = lower.indexOf(phrase.toLowerCase(), cursor)
      if (idx === -1) continue
      if (hitAt === -1 || idx < hitAt) {
        hitAt = idx
        hitPhrase = phrase
      }
    }

    if (hitAt === -1 || !hitPhrase) {
      parts.push({ text: full.slice(cursor), bold: false })
      break
    }

    if (hitAt > cursor) {
      parts.push({ text: full.slice(cursor, hitAt), bold: false })
    }
    parts.push({ text: full.slice(hitAt, hitAt + hitPhrase.length), bold: true })
    cursor = hitAt + hitPhrase.length
  }

  return parts
    .filter((p) => p.text.length)
    .map((p) => {
      const rPr = p.bold ? boldRPr : baseRPr
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r>`
    })
    .join('')
}

/**
 * Clone formatting from an existing resume bullet so new bullets keep the same
 * indent, spacing, list numbering, and font as the original document.
 */
function extractParagraphTemplate(xml, paragraphEnd, extraBoldPhrases = []) {
  const chunk = getParagraphChunk(xml, paragraphEnd)
  if (!chunk) {
    return {
      pPr: '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>',
      rPr: '',
      baseRPr: '',
      boldRPr: '',
      keywordBold: false,
      boldPhrases: [],
      hasNumPr: false,
      literalPrefix: '',
      pOpen: '<w:p>',
    }
  }

  const openMatch = chunk.match(/^<w:p\b[^>]*>/)
  const pOpen = openMatch ? openMatch[0] : '<w:p>'
  const pPrMatch = chunk.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)
  // Keep original spacing/indent/numPr EXACTLY — only strip bold/underline from nested rPr in pPr
  let pPr = pPrMatch ? pPrMatch[0] : '<w:pPr></w:pPr>'
  pPr = pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (rPr) => stripUnderline(stripBold(rPr)))

  const hasNumPr = /w:numPr/.test(pPr)
    || /w:numPr/.test(chunk)
    || /w:pStyle\s[^>]*w:val="[^"]*List/i.test(chunk)
  const sourceGlyph = detectLiteralBulletPrefix(chunk)
  const literalPrefix = hasNumPr ? '' : (sourceGlyph || '')
  const styles = extractRunStyles(chunk)
  const boldPhrases = styles.keywordBold
    ? uniqueBoldPhrases([...(styles.boldPhrases || []), ...extraBoldPhrases])
    : []

  return {
    pPr,
    rPr: styles.baseRPr,
    baseRPr: styles.baseRPr,
    boldRPr: styles.boldRPr,
    keywordBold: styles.keywordBold && boldPhrases.length > 0,
    boldPhrases,
    hasNumPr,
    literalPrefix,
    pOpen,
  }
}

function buildParagraph(text, template, { mark = null } = {}) {
  const pOpen = template.pOpen || '<w:p>'
  const pPr = template.pPr || ''
  const runs = buildTextRuns(text, template, mark)
  return `${pOpen}${pPr}${runs}</w:p>`
}

function rewriteParagraph(paraXml, replacement, mark, extraBoldPhrases = []) {
  const openMatch = paraXml.match(/^<w:p\b[^>]*>/)
  const pOpen = openMatch ? openMatch[0] : '<w:p>'
  const pPrMatch = paraXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)
  const pPr = stripBoldFromPPr(pPrMatch ? pPrMatch[0] : '')
  const hasNumPr = /w:numPr/.test(pPr)
    || /w:numPr/.test(paraXml)
    || /w:pStyle\s[^>]*w:val="[^"]*List/i.test(paraXml)
  const sourceGlyph = detectLiteralBulletPrefix(paraXml)
  const literalPrefix = hasNumPr ? '' : (sourceGlyph || '')
  const styles = extractRunStyles(paraXml)
  const phrases = styles.keywordBold
    ? uniqueBoldPhrases([...(styles.boldPhrases || []), ...extraBoldPhrases])
    : []
  const template = {
    hasNumPr,
    literalPrefix,
    baseRPr: styles.baseRPr,
    boldRPr: styles.boldRPr,
    keywordBold: styles.keywordBold && phrases.length > 0,
    boldPhrases: phrases,
    rPr: styles.baseRPr,
  }
  const runs = buildTextRuns(replacement, template, mark)
  return `${pOpen}${pPr}${runs}</w:p>`
}

function buildSkillRun(skill, rPr, mark, { leadingSeparator = ', ' } = {}) {
  const safe = escapeXml(skill)
  const runRPr = applyMarkToRPr(rPr, mark)
  return `<w:r>${runRPr}<w:t xml:space="preserve">${leadingSeparator}${safe}</w:t></w:r>`
}

function findSectionStart(xml, anchors) {
  const lower = xml.toLowerCase()
  for (const anchor of anchors) {
    const idx = lower.indexOf(anchor.toLowerCase())
    if (idx !== -1) {
      const closeP = xml.indexOf('</w:p>', idx)
      if (closeP !== -1) return closeP + 6
    }
  }
  return -1
}

function isLikelySectionHeading(xml, idx, marker) {
  const paraStart = findParagraphStart(xml, idx + 1)
  if (paraStart === -1 || paraStart > idx) return false
  const paraEnd = xml.indexOf('</w:p>', idx)
  if (paraEnd === -1) return false
  const plain = normalizeText(getPlainTextFromParagraph(xml.slice(paraStart, paraEnd + 6)))
  const m = marker.toLowerCase()
  if (!plain || plain.length > 85) return false
  if (!plain.includes(m)) return false
  if (m === 'experience' && plain.split(/\s+/).length > 5) return false
  if (m === 'skills' && plain.split(/\s+/).length > 4 && !plain.startsWith('technical')) return false
  return true
}

function findNextSectionStart(xml, fromIndex) {
  const lower = xml.toLowerCase()
  const markers = [
    'technical skills',
    'work experience',
    'professional experience',
    'core competencies',
    'education',
    'certification',
    'certifications',
    'projects',
    'skills',
    'experience',
  ]
  let next = xml.length
  for (const marker of markers) {
    let idx = fromIndex + 20
    while (idx < xml.length) {
      const hit = lower.indexOf(marker, idx)
      if (hit === -1) break
      if (isLikelySectionHeading(xml, hit, marker) && hit < next) {
        next = hit
        break
      }
      idx = hit + marker.length
    }
  }
  return next
}

function getParagraphEndsInRange(xml, start, end) {
  const ends = []
  let pos = start
  while (pos < end) {
    const idx = xml.indexOf('</w:p>', pos)
    if (idx === -1 || idx >= end) break
    ends.push(idx + 6)
    pos = idx + 6
  }
  return ends
}

function getBulletParagraphEnds(xml, start, end) {
  const ends = []
  let pos = start
  while (pos < end) {
    const pStart = findNextParagraphStart(xml, pos, end)
    if (pStart === -1) break
    const pEnd = xml.indexOf('</w:p>', pStart)
    if (pEnd === -1 || pEnd >= end) break
    const chunk = xml.slice(pStart, pEnd + 6)
    if (isBulletParagraph(chunk)) ends.push(pEnd + 6)
    pos = pEnd + 6
  }
  return ends
}

function getCompanyContentEnds(xml, block) {
  const all = getParagraphEndsInRange(xml, block.start, block.end)
  const bullets = getBulletParagraphEnds(xml, block.start, block.end)
  const substantive = all.filter((end) => {
    const plain = getPlainTextFromParagraph(getParagraphChunk(xml, end))
    return plain.length > 20
  })

  if (bullets.length >= 2) return bullets
  if (substantive.length >= 3) {
    const middle = substantive.slice(1, -1)
    return middle.length ? middle : substantive.slice(1)
  }
  if (substantive.length >= 2) return substantive.slice(0, -1)
  return bullets.length ? bullets : substantive
}

function resolveSummaryInsertPoint(xml, summaryStart, summaryEnd) {
  // Prefer real bullets only — never treat a prose summary paragraph as a bullet template source
  let bulletEnds = getBulletParagraphEnds(xml, summaryStart, summaryEnd)
  if (bulletEnds.length < 2) {
    const maybeBullets = getParagraphEndsInRange(xml, summaryStart, summaryEnd).filter((end) => {
      const chunk = getParagraphChunk(xml, end)
      return isUsableBulletTemplateChunk(chunk)
    })
    if (maybeBullets.length) bulletEnds = maybeBullets
  }

  let insertAt = getMiddleInsertionPoint(bulletEnds)
  if (!insertAt && bulletEnds.length >= 2) {
    insertAt = bulletEnds[Math.max(0, Math.floor(bulletEnds.length / 2) - 1)]
  }

  // Thin / prose summary: insert after the first body paragraph (or heading), using Experience bullet style later
  if (!insertAt) {
    const allEnds = getParagraphEndsInRange(xml, summaryStart, summaryEnd)
    if (allEnds.length >= 1) {
      insertAt = allEnds[0]
    } else {
      const headingEnd = xml.indexOf('</w:p>', summaryStart)
      if (headingEnd !== -1 && headingEnd < summaryEnd) {
        insertAt = headingEnd + 6
      }
    }
  }

  return { insertAt, bulletEnds }
}

function resolveExperienceInsertPoint(xml, block) {
  const bulletEnds = getCompanyContentEnds(xml, block)
  let insertAt = getMiddleInsertionPoint(bulletEnds)
  if (!insertAt && bulletEnds.length >= 2) {
    insertAt = bulletEnds[0]
  }
  if (!insertAt && bulletEnds.length === 1) {
    const all = getParagraphEndsInRange(xml, block.start, block.end)
    if (all.length >= 2) insertAt = all[0]
  }
  return { insertAt, bulletEnds }
}

function insertBulletsAt(xml, insertAt, bullets, template, mark, appliedList) {
  if (!template) return xml
  const toInsert = []
  for (const bullet of bullets) {
    toInsert.push(buildParagraph(bullet, template, { mark }))
    appliedList.push(bullet)
  }
  return xml.slice(0, insertAt) + toInsert.join('') + xml.slice(insertAt)
}

/**
 * Prefer a real bullet paragraph (list numPr / literal •) so new bullets inherit
 * the same indent + spacing as neighboring bullets — not a title/date/prose line.
 */
function getParagraphSpacingMetrics(chunkOrPPr) {
  const src = chunkOrPPr || ''
  const pPrMatch = src.includes('<w:pPr') ? src.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/) : null
  const pPr = pPrMatch ? pPrMatch[0] : src
  const after = /w:after(?:Lines)?="(\d+)"/.exec(pPr)
  const before = /w:before(?:Lines)?="(\d+)"/.exec(pPr)
  const line = /w:line="(\d+)"/.exec(pPr)
  const lineRule = /w:lineRule="([^"]+)"/.exec(pPr)
  return {
    after: after ? parseInt(after[1], 10) : 0,
    before: before ? parseInt(before[1], 10) : 0,
    line: line ? parseInt(line[1], 10) : null,
    lineRule: lineRule ? lineRule[1] : null,
  }
}

function replaceParagraphSpacing(pPr, spacingSourcePPr) {
  if (!pPr) return spacingSourcePPr || ''
  if (!spacingSourcePPr) return pPr

  const srcSpacing = spacingSourcePPr.match(/<w:spacing\b[^/]*\/>/)
  if (!srcSpacing) {
    return pPr.replace(/<w:spacing\b[^/]*\/>/g, '')
  }
  if (/<w:spacing\b/.test(pPr)) {
    return pPr.replace(/<w:spacing\b[^/]*\/>/g, srcSpacing[0])
  }
  if (/<\/w:pPr>/.test(pPr)) {
    return pPr.replace('</w:pPr>', `${srcSpacing[0]}</w:pPr>`)
  }
  return pPr
}

function isUsableBulletTemplateChunk(chunk) {
  if (!chunk) return false
  const plain = getPlainTextFromParagraph(chunk)
  if (!plain || plain.length < 12) return false
  if (isSkillsSectionTitle(plain)) return false
  if (!isBulletParagraph(chunk) && !detectLiteralBulletPrefix(chunk) && !/w:numPr/.test(chunk)) {
    return false
  }
  return true
}

function pickBulletTemplate(xml, bulletEnds, fallbackEnd) {
  const candidates = [...(bulletEnds || [])]
  if (fallbackEnd && !candidates.includes(fallbackEnd)) candidates.push(fallbackEnd)

  let best = null
  let bestScore = -1
  for (const end of candidates) {
    const chunk = getParagraphChunk(xml, end)
    if (!isUsableBulletTemplateChunk(chunk)) continue

    let score = 0
    if (/w:numPr/.test(chunk)) score += 6
    if (detectLiteralBulletPrefix(chunk)) score += 5
    if (/w:ind\b/.test(chunk)) score += 2
    if (getPlainTextFromParagraph(chunk).length > 40) score += 1

    const spacing = getParagraphSpacingMetrics(chunk)
    if (spacing.after <= 80) score += 4
    else if (spacing.after <= 120) score += 2
    else if (spacing.after > 160) score -= 5
    if (spacing.before > 120) score -= 3
    if (spacing.line && spacing.lineRule === 'auto' && spacing.line >= 360) score -= 4

    const styles = extractRunStyles(chunk)
    if (styles.baseRPr && !isBoldRPr(styles.baseRPr)) score += 2
    if (styles.keywordBold) score += 1
    if (/w:b[\s/>]/.test(chunk) && getPlainTextFromParagraph(chunk).length < 60) score -= 2

    if (score > bestScore) {
      bestScore = score
      best = end
    }
  }

  if (!best) return null
  const sectionPhrases = collectBoldPhrasesFromEnds(xml, candidates)
  return extractParagraphTemplate(xml, best, sectionPhrases)
}

/** Find a real list bullet anywhere in the doc (prefer Experience) for spacing/indent clone. */
function findDocumentBulletTemplate(xml) {
  const regions = []
  const expStart = findSectionStart(xml, SECTION_ANCHORS.experience)
  if (expStart !== -1) {
    regions.push([expStart, findNextSectionStart(xml, expStart)])
  }
  const sumStart = findSectionStart(xml, SECTION_ANCHORS.summary)
  if (sumStart !== -1) {
    regions.push([sumStart, findNextSectionStart(xml, sumStart)])
  }
  regions.push([0, xml.length])

  for (const [start, end] of regions) {
    const ends = getBulletParagraphEnds(xml, start, end)
    const template = pickBulletTemplate(xml, ends, null)
    if (template) return template
  }
  return null
}

function alignTemplateSpacing(template, referenceTemplate) {
  if (!template) return null
  if (!referenceTemplate?.pPr) return template

  if (referenceTemplate.hasNumPr && !template.hasNumPr) {
    return {
      ...template,
      pPr: referenceTemplate.pPr,
      hasNumPr: referenceTemplate.hasNumPr,
      literalPrefix: referenceTemplate.literalPrefix,
      pOpen: referenceTemplate.pOpen || template.pOpen,
      baseRPr: template.baseRPr || referenceTemplate.baseRPr,
      boldRPr: template.boldRPr || referenceTemplate.boldRPr,
      keywordBold: template.keywordBold || referenceTemplate.keywordBold,
      boldPhrases: (template.boldPhrases?.length ? template.boldPhrases : referenceTemplate.boldPhrases) || [],
    }
  }

  return {
    ...template,
    pPr: replaceParagraphSpacing(template.pPr || '<w:pPr></w:pPr>', referenceTemplate.pPr),
  }
}

function resolveBulletTemplate(xml, bulletEnds, fallbackEnd) {
  const localEnds = (bulletEnds || []).filter((end) => {
    const chunk = getParagraphChunk(xml, end)
    return isUsableBulletTemplateChunk(chunk)
  })

  let template = pickBulletTemplate(xml, localEnds, null)
  const docTemplate = findDocumentBulletTemplate(xml)

  if (!template && docTemplate) {
    template = {
      ...docTemplate,
      boldPhrases: uniqueBoldPhrases([
        ...(docTemplate.boldPhrases || []),
        ...collectBoldPhrasesFromEnds(xml, bulletEnds || []),
      ]),
      keywordBold: docTemplate.keywordBold || (docTemplate.boldPhrases || []).length > 0,
    }
  } else if (template && docTemplate) {
    const localAfter = getParagraphSpacingMetrics(template.pPr || '').after
    const docAfter = getParagraphSpacingMetrics(docTemplate.pPr || '').after
    if (localAfter > 120 && docAfter <= localAfter) {
      template = alignTemplateSpacing(template, docTemplate)
    }
  }

  // Last resort: never inherit prose paragraph gaps — force tight spacing
  if (!template && fallbackEnd) {
    const weak = extractParagraphTemplate(xml, fallbackEnd)
    if (weak) {
      let pPr = weak.pPr || '<w:pPr></w:pPr>'
      if (/<w:spacing\b/.test(pPr)) {
        pPr = pPr.replace(/<w:spacing\b[^/]*\/>/g, '<w:spacing w:before="0" w:after="0"/>')
      } else if (/<\/w:pPr>/.test(pPr)) {
        pPr = pPr.replace('</w:pPr>', '<w:spacing w:before="0" w:after="0"/></w:pPr>')
      }
      template = {
        ...weak,
        pPr,
        literalPrefix: weak.hasNumPr ? '' : (weak.literalPrefix || ''),
      }
    }
  }

  return template
}

function getSummaryParagraphEnds(xml, start, end) {
  const bullets = getBulletParagraphEnds(xml, start, end)
  if (bullets.length >= 2) return bullets
  const all = getParagraphEndsInRange(xml, start, end)
  return all.length >= 2 ? all : bullets
}

function getMiddleInsertionPoint(paragraphEnds) {
  if (paragraphEnds.length < 2) return null
  if (paragraphEnds.length === 2) return paragraphEnds[0]
  const valid = paragraphEnds.slice(1, -1)
  if (!valid.length) return null
  return valid[Math.floor(valid.length / 2)]
}

function normalizeText(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function textMatches(plain, original) {
  const p = normalizeText(plain)
  const o = normalizeText(original)
  if (!p || !o) return false
  if (p === o || p.includes(o) || o.includes(p)) return true
  const short = o.slice(0, Math.min(55, o.length))
  const pShort = p.slice(0, Math.min(55, p.length))
  return p.includes(short) || short.includes(pShort)
}

function isExactDuplicate(a, b) {
  return normalizeText(a) === normalizeText(b)
}

function resolveCategory(category, resumeData) {
  const headings = [...(resumeData.headings || []), ...(resumeData.allSections || [])]
  const catLower = (category || '').toLowerCase().trim().replace(/:$/, '')
  if (!catLower) return category

  // Never resolve to a top-level section title — those create fake skill dumps
  if (isSkillsSectionTitle(catLower)) {
    const real = headings.find((h) => {
      const hl = h.toLowerCase().trim().replace(/:$/, '')
      return hl && !isSkillsSectionTitle(hl) && (hl.includes('tool') || hl.includes('platform') || hl.includes('skill') || hl.includes(':'))
    })
    return real || category
  }

  const match = headings.find((h) => {
    const hl = h.toLowerCase().trim().replace(/:$/, '')
    if (!hl || isSkillsSectionTitle(hl)) return false
    return hl.includes(catLower) || catLower.includes(hl)
  })
  return match || category
}

function isSkillsSectionTitle(text) {
  const t = normalizeText(text).replace(/:$/, '')
  return [
    'technical skills',
    'skills',
    'core competencies',
    'technologies',
    'technical skill',
  ].includes(t)
}

/**
 * Find existing skill category lines inside the skills section
 * (e.g. "Tools & Platforms: AWS, Azure"). Never returns the section heading itself.
 */
function discoverSkillCategoryLines(xml) {
  const skillsStart = findSectionStart(xml, SECTION_ANCHORS.skills)
  if (skillsStart === -1) return []

  const skillsEnd = findNextSectionStart(xml, skillsStart)
  const lines = []
  let pos = skillsStart

  while (pos < skillsEnd) {
    const pStart = findNextParagraphStart(xml, pos, skillsEnd)
    if (pStart === -1) break
    const pEnd = xml.indexOf('</w:p>', pStart)
    if (pEnd === -1 || pEnd >= skillsEnd) break

    const paraEnd = pEnd + 6
    const chunk = xml.slice(pStart, paraEnd)
    const plain = getPlainTextFromParagraph(chunk).trim()
    const raw = getRawParagraphText(chunk).trim()

    if (plain && !isSkillsSectionTitle(plain)) {
      // Prefer "Category: rest" lines; also accept short category-only labels
      const colonMatch = plain.match(/^([^:]{2,60}):\s*(.*)$/)
      if (colonMatch) {
        lines.push({
          label: colonMatch[1].replace(/[•\u2022]/g, '').trim(),
          plain,
          raw,
          paraEnd,
          pStart,
        })
      } else {
        // Short label-only line without colon (rare)
        const labelOnly = plain.replace(/[•\u2022]/g, '').trim()
        if (labelOnly.length >= 2 && labelOnly.length <= 48 && /[A-Za-z]/.test(labelOnly) && !labelOnly.includes(',')) {
          lines.push({
            label: labelOnly,
            plain,
            raw,
            paraEnd,
            pStart,
          })
        }
      }
    }

    pos = paraEnd
  }

  return lines
}

function scoreCategoryForSkill(skill, categoryLabel) {
  const s = normalizeText(skill)
  const c = normalizeText(categoryLabel)
  if (!s || !c) return 0
  let score = 0

  const rules = [
    { re: /network|tcp|dns|vlan|switch|router|firewall|fiber|copper|cabling|cable/, cats: /network|cabling|fiber|infra/ },
    { re: /security|compliance|governance|gpo|active directory|entra|iam|access/, cats: /security|governance|identity|compliance/ },
    { re: /linux|windows|server|os |system|vmware|hypervisor|virtual/, cats: /system|support|os|server|platform/ },
    { re: /ticket|jira|servicenow|service now|incident|mop|cmop|change/, cats: /tool|platform|ticket|support|document/ },
    { re: /aws|azure|gcp|cloud|nerdio/, cats: /cloud|platform|tool/ },
    { re: /document|runbook|sop|knowledge/, cats: /document/ },
    { re: /rack|stack|power|pdu|hvac|data center|datacenter/, cats: /data center|facility|infra|platform/ },
    { re: /monitor|nagios|solarwinds|observability/, cats: /monitor|tool|platform|system/ },
  ]

  for (const rule of rules) {
    if (rule.re.test(s) && rule.cats.test(c)) score += 3
  }
  if (c.includes('tool') || c.includes('platform')) score += 1
  return score
}

function pickBestCategoryLine(skill, categoryLines, preferredLabel = '') {
  if (!categoryLines.length) return null

  const preferred = normalizeText(preferredLabel).replace(/:$/, '')
  if (preferred && !isSkillsSectionTitle(preferred)) {
    const exact = categoryLines.find((l) => {
      const lab = normalizeText(l.label).replace(/:$/, '')
      return lab === preferred || lab.includes(preferred) || preferred.includes(lab)
    })
    if (exact) return exact
  }

  let best = categoryLines[0]
  let bestScore = -1
  for (const line of categoryLines) {
    const score = scoreCategoryForSkill(skill, line.label)
    if (score > bestScore) {
      bestScore = score
      best = line
    }
  }
  return best
}

/**
 * Map planned skills onto existing DOCX category lines only.
 * Never targets the top-level Technical Skills heading.
 */
function redistributeSkillsToExistingCategories(plan, xml) {
  const categoryLines = discoverSkillCategoryLines(xml)
  if (!categoryLines.length) {
    return { entries: [], categoryLines, skipped: (plan.skillsByCategory || []).flatMap((e) => e.skills || []) }
  }

  const buckets = new Map()
  const ensureBucket = (line) => {
    const key = line.paraEnd
    if (!buckets.has(key)) {
      buckets.set(key, { line, skills: [] })
    }
    return buckets.get(key)
  }

  const allSkills = []
  for (const entry of plan.skillsByCategory || []) {
    for (const skill of entry.skills || []) {
      allSkills.push({ skill, preferred: entry.category })
    }
  }
  for (const skill of plan.skillsToAdd || []) {
    if (!allSkills.some((s) => normalizeText(s.skill) === normalizeText(skill))) {
      allSkills.push({ skill, preferred: '' })
    }
  }

  const skipped = []
  for (const { skill, preferred } of allSkills) {
    const line = pickBestCategoryLine(skill, categoryLines, preferred)
    if (!line) {
      skipped.push(skill)
      continue
    }
    const bucket = ensureBucket(line)
    if (!bucket.skills.some((s) => normalizeText(s) === normalizeText(skill))) {
      bucket.skills.push(skill)
    }
  }

  const entries = [...buckets.values()]
    .filter((b) => b.skills.length)
    .map((b) => ({
      category: b.line.label,
      skills: b.skills,
      paraEnd: b.line.paraEnd,
    }))

  return { entries, categoryLines, skipped }
}

function findParagraphContaining(xml, searchText, rangeStart, rangeEnd) {
  let pos = rangeStart
  while (pos < rangeEnd) {
    const pStart = findNextParagraphStart(xml, pos, rangeEnd)
    if (pStart === -1) break
    const pEnd = xml.indexOf('</w:p>', pStart)
    if (pEnd === -1 || pEnd >= rangeEnd) break
    const para = xml.slice(pStart, pEnd + 6)
    const plain = getPlainTextFromParagraph(para)
    if (textMatches(plain, searchText)) {
      return { start: pStart, end: pEnd + 6, para, plain }
    }
    pos = pEnd + 6
  }
  return null
}

function companySearchTerms(companyName, title) {
  const terms = new Set()
  if (companyName) {
    terms.add(companyName.trim())
    const primary = companyName.split(/[•|,]/)[0].trim()
    if (primary) terms.add(primary)
    const words = primary.split(/\s+/).filter((w) => w.length > 3)
    if (words[0]) terms.add(words[0])
  }
  if (title) terms.add(title.trim())
  return [...terms]
}

function findCompanyBlock(xml, companyName, experienceStart, prevCompanyName, nextCompanyName, title) {
  const lower = xml.toLowerCase()
  const terms = companySearchTerms(companyName, title)

  for (const term of terms) {
    const termLower = term.toLowerCase()
    let searchFrom = experienceStart

    if (prevCompanyName) {
      const prevTerms = companySearchTerms(prevCompanyName, null)
      for (const pt of prevTerms) {
        const prevIdx = lower.indexOf(pt.toLowerCase(), experienceStart)
        if (prevIdx !== -1) searchFrom = Math.max(searchFrom, prevIdx + pt.length)
      }
    }

    const idx = lower.indexOf(termLower, searchFrom)
    if (idx === -1) continue

    let end = xml.length
    if (nextCompanyName) {
      const nextTerms = companySearchTerms(nextCompanyName, null)
      let nextIdx = -1
      for (const nt of nextTerms) {
        const hit = lower.indexOf(nt.toLowerCase(), idx + termLower.length)
        if (hit !== -1 && (nextIdx === -1 || hit < nextIdx)) nextIdx = hit
      }
      if (nextIdx !== -1) end = nextIdx
    } else {
      end = findNextSectionStart(xml, idx)
    }

    return { start: idx, end, matchedTerm: term }
  }

  return null
}

function findCompanyBlockByIndex(xml, experience, expIdx, experienceStart) {
  const entry = experience[expIdx]
  if (!entry?.company) return null
  return findCompanyBlock(
    xml,
    entry.company,
    experienceStart,
    expIdx > 0 ? experience[expIdx - 1].company : null,
    expIdx < experience.length - 1 ? experience[expIdx + 1].company : null,
    entry.title,
  )
}

function getPlanBulletsForCompany(plan, companyName) {
  const entry = (plan.experienceAdditions || []).find(
    (e) => e.company?.toLowerCase() === companyName?.toLowerCase(),
  )
  return (entry?.bullets || []).slice(0, 2)
}

export function mergeExperienceAdditions(plan, resumeData) {
  const companies = resumeData.experience || []
  const byCompany = new Map()

  for (const entry of plan.experienceAdditions || []) {
    if (!entry.company || !entry.bullets?.length) continue
    const key = entry.company.toLowerCase()
    const existing = byCompany.get(key) || []
    byCompany.set(key, [...existing, ...entry.bullets].slice(0, 2))
  }

  const experienceAdditions = companies
    .map((c) => ({
      company: c.company,
      bullets: (byCompany.get(c.company?.toLowerCase()) || []).slice(0, 2),
    }))
    .filter((e) => e.company && e.bullets.length)

  return { ...plan, experienceAdditions }
}

function findCategoryParagraphEnd(xml, category) {
  // Only match real category lines — never the top-level Skills section heading
  if (isSkillsSectionTitle(category)) return -1

  const categoryLines = discoverSkillCategoryLines(xml)
  if (!categoryLines.length) return -1

  const catLower = normalizeText(category).replace(/:$/, '')
  const exact = categoryLines.find((l) => {
    const lab = normalizeText(l.label).replace(/:$/, '')
    return lab === catLower || lab.includes(catLower) || catLower.includes(lab)
  })
  return exact ? exact.paraEnd : -1
}

function extractLastRunRPr(xml, paragraphEnd) {
  const chunk = getParagraphChunk(xml, paragraphEnd)
  const styles = extractRunStyles(chunk)
  // Skills lines often bold/underline category labels; append skills in normal body style
  return stripUnderline(styles.baseRPr || stripBold(styles.boldRPr) || '')
}

function stripAllHighlights(xml) {
  return xml.replace(/<w:shd[^/]*\/>/g, '')
}

function findParagraphForRewrite(xml, searchText, rangeStart, rangeEnd, resumeData, isSummary) {
  let found = findParagraphContaining(xml, searchText, rangeStart, rangeEnd)
  if (found) return found

  if (!isSummary) return null

  for (const sb of resumeData?.summaryBullets || []) {
    found = findParagraphContaining(xml, sb, rangeStart, rangeEnd)
    if (found) return found
    const short = normalizeText(sb).slice(0, 55)
    if (short.length > 20) {
      found = findParagraphContaining(xml, short, rangeStart, rangeEnd)
      if (found) return found
    }
  }

  return null
}

function bulletTokens(text) {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 3),
  )
}

function isDuplicateBullet(newBullet, existingBullets) {
  if (!newBullet) return true
  const nb = normalizeText(newBullet)
  for (const existing of existingBullets) {
    const eb = normalizeText(existing)
    if (!eb) continue
    if (nb === eb || nb.includes(eb) || eb.includes(nb)) return true
    const a = bulletTokens(newBullet)
    const b = bulletTokens(existing)
    let overlap = 0
    for (const t of a) if (b.has(t)) overlap += 1
    if (overlap >= Math.min(5, Math.ceil(a.size * 0.55))) return true
  }
  return false
}

/** Softer check for summary — avoid wiping JD-aligned bullets that share tools with experience. */
function isNearExactSummaryDuplicate(newBullet, existingSummaryBullets) {
  if (!newBullet?.trim()) return true
  const nb = normalizeText(newBullet)
  const nbTokens = bulletTokens(newBullet)
  for (const existing of existingSummaryBullets || []) {
    const eb = normalizeText(existing)
    if (!eb) continue
    if (nb === eb) return true
    if (nb.length > 40 && eb.length > 40 && (nb.includes(eb) || eb.includes(nb))) return true
    // Near-paraphrase of an existing summary bullet (same story, slightly reworded)
    const ebTokens = bulletTokens(existing)
    if (nbTokens.size >= 4 && ebTokens.size >= 4) {
      let overlap = 0
      for (const t of nbTokens) if (ebTokens.has(t)) overlap += 1
      const ratio = overlap / Math.min(nbTokens.size, ebTokens.size)
      if (ratio >= 0.6) return true
    }
  }
  return false
}

/**
 * Keep 1–2 summary bullets after repair even if fuzzy filters cleared them.
 * Only drops near-exact / paraphrased matches against existing summary + all resume bullets.
 */
export function keepSummaryBullets(candidates, resumeData, limit = 2) {
  const existingSummary = resumeData?.summaryBullets || []
  const allExisting = [
    ...existingSummary,
    ...(resumeData?.experience || []).flatMap((e) => e.bullets || []),
  ]
  const kept = []
  for (const b of candidates || []) {
    const cleaned = clampBulletLength(b)
    if (!cleaned) continue
    if (isNearExactSummaryDuplicate(cleaned, [...existingSummary, ...kept])) continue
    if (isDuplicateBullet(cleaned, [...allExisting, ...kept])) continue
    kept.push(cleaned)
    if (kept.length >= limit) break
  }
  return kept
}

function isSummaryRewrite(rewrite) {
  const company = (rewrite.company || '').toLowerCase()
  return !company || company === 'summary' || company === 'professional summary'
}

function emptyApplied() {
  return {
    skills: [],
    summary: { added: [], rewritten: [] },
    experience: {},
  }
}

function ensureExperienceEntry(applied, company) {
  if (!applied.experience[company]) {
    applied.experience[company] = { added: [], rewritten: [] }
  }
  return applied.experience[company]
}

export function filterEnhancementPlan(plan, resumeData, comparison) {
  const existingSkills = new Set([
    ...(resumeData.skills || []),
    ...(resumeData.technicalSkills || []),
  ].map((s) => s.toLowerCase().trim()))

  const isDuplicateSkill = (skill) => {
    const lower = skill.toLowerCase().trim()
    if (!lower) return true
    if (existingSkills.has(lower)) return true
    return [...existingSkills].some((e) => e.includes(lower) || lower.includes(e))
  }

  const missingSet = new Set((comparison?.missing || []).map((s) => s.toLowerCase().trim()))

  const isMissing = (skill) => {
    const lower = skill.toLowerCase().trim()
    if (missingSet.has(lower)) return true
    return [...missingSet].some((m) => m.includes(lower) || lower.includes(m))
  }

  const existingSummary = resumeData.summaryBullets || []
  const allExistingBullets = [
    ...existingSummary,
    ...(resumeData.experience || []).flatMap((e) => e.bullets || []),
  ]

  // Summary: reject near-duplicates / paraphrases; clamp to ~2 lines
  let summaryBullets = (plan.summaryBullets || [])
    .map((b) => clampBulletLength(b))
    .filter((b) => b
      && !isNearExactSummaryDuplicate(b, existingSummary)
      && !isDuplicateBullet(b, allExistingBullets))
    .slice(0, 2)

  const summaryRewrites = (plan.bulletRewrites || []).filter(isSummaryRewrite)

  const experienceAdditions = (plan.experienceAdditions || [])
    .map((entry) => ({
      company: entry.company,
      bullets: (entry.bullets || [])
        .map((b) => clampBulletLength(b))
        .filter((b) => b && !isDuplicateBullet(b, allExistingBullets))
        .slice(0, 2),
    }))
    .filter((entry) => entry.company && entry.bullets.length)

  const bulletRewrites = (plan.bulletRewrites || [])
    .filter((r) => r.original && r.replacement)
    .map((r) => ({ ...r, replacement: clampBulletLength(r.replacement) }))
    .filter((r) => r.replacement && !isDuplicateBullet(r.replacement, allExistingBullets))

  const skillsByCategory = []
  const rawSkills = plan.skillsByCategory || []

  if (rawSkills.length) {
    for (const entry of rawSkills) {
      const skills = (entry.skills || [])
        .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s) && isMissing(s))
      if (skills.length) {
        skillsByCategory.push({
          category: resolveCategory(entry.category, resumeData),
          skills,
        })
        skills.forEach((s) => existingSkills.add(s.toLowerCase().trim()))
      }
    }
  } else {
    const flat = (plan.skillsToAdd || [])
      .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s) && isMissing(s))
    if (flat.length) {
      // Prefer a real category heading from the resume — never invent "Technical Skills"
      const realCats = [...(resumeData.headings || []), ...(resumeData.allSections || [])]
        .filter((h) => h && !isSkillsSectionTitle(h))
      const fallbackCat = realCats.find((h) => /tool|platform|skill|technolog/i.test(h)) || realCats[0] || 'Tools & Platforms'
      skillsByCategory.push({ category: fallbackCat, skills: flat })
      flat.forEach((s) => existingSkills.add(s.toLowerCase().trim()))
    }
  }

  // Force-add remaining short missing skills only (never JD sentences)
  const stillMissing = (comparison?.missing || [])
    .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s))
  if (stillMissing.length) {
    const realCats = [...(resumeData.headings || []), ...(resumeData.allSections || [])]
      .filter((h) => h && !isSkillsSectionTitle(h))
    const defaultCat = realCats.find((h) => /tool|platform/i.test(h))
      || realCats[0]
      || 'Tools & Platforms'
    let bucket = skillsByCategory.find((e) => normalizeText(e.category) === normalizeText(defaultCat))
    if (!bucket) {
      bucket = { category: defaultCat, skills: [] }
      skillsByCategory.push(bucket)
    }
    for (const skill of stillMissing) {
      if (isDuplicateSkill(skill)) continue
      bucket.skills.push(skill)
      existingSkills.add(skill.toLowerCase().trim())
    }
  }

  return {
    ...plan,
    summaryBullets,
    experienceAdditions,
    bulletRewrites,
    skillsByCategory,
    skillsToAdd: skillsByCategory.flatMap((e) => e.skills),
    _summaryRewriteCount: summaryRewrites.length,
  }
}

/**
 * Ensure every skill in the plan also appears in at least one planned bullet.
 * Appends a natural "using X, Y" clause to the first experience/summary bullet when needed.
 */
export function ensureSkillsInBullets(plan) {
  const skills = [...(plan.skillsToAdd || [])].filter(isValidSkillName)
  if (!skills.length) return plan

  const allText = [
    ...(plan.summaryBullets || []),
    ...(plan.experienceAdditions || []).flatMap((e) => e.bullets || []),
    ...(plan.bulletRewrites || []).map((r) => r.replacement || ''),
  ].join(' ').toLowerCase()

  const missingInBullets = skills.filter((s) => !allText.includes(String(s).toLowerCase()))
  if (!missingInBullets.length) return plan

  // Weave at most 2 short tools so bullets stay ≤ ~2 lines
  const clause = ` using ${missingInBullets.slice(0, 2).join(' and ')}`
  const next = { ...plan }

  if (next.summaryBullets?.length) {
    next.summaryBullets = [...next.summaryBullets]
    next.summaryBullets[0] = clampBulletLength(`${next.summaryBullets[0].replace(/\.$/, '')}${clause}.`)
    return next
  }

  if (next.experienceAdditions?.length) {
    next.experienceAdditions = next.experienceAdditions.map((entry, idx) => {
      if (idx !== 0 || !entry.bullets?.length) return entry
      const bullets = [...entry.bullets]
      bullets[0] = clampBulletLength(`${bullets[0].replace(/\.$/, '')}${clause}.`)
      return { ...entry, bullets }
    })
  }

  return next
}

export function buildMatchAnalysis(beforeComparison, afterComparison, applied) {
  const expAdded = Object.values(applied.experience || {}).reduce((n, e) => n + (e.added?.length || 0), 0)
  const expRewritten = Object.values(applied.experience || {}).reduce((n, e) => n + (e.rewritten?.length || 0), 0)

  const beforePresent = new Set((beforeComparison.present || []).map((k) => k.toLowerCase().trim()))
  const addedKeywords = (afterComparison.present || []).filter(
    (k) => !beforePresent.has(k.toLowerCase().trim()),
  )

  const addedBullets = [
    ...(applied.summary?.added || []).map((text) => ({ section: 'Summary', text })),
    ...(applied.summary?.rewritten || []).map((r) => ({ section: 'Summary', text: r.text, rewritten: true })),
    ...Object.entries(applied.experience || {}).flatMap(([company, data]) => [
      ...(data.added || []).map((text) => ({ section: company, text })),
      ...(data.rewritten || []).map((r) => ({ section: company, text: r.text, rewritten: true })),
    ]),
  ]

  function compactBreakdown(comparison) {
    const raw = comparison?.scoreBreakdown
    if (!raw) {
      // Fallback so UI never shows "—" when only legacy comparison fields exist
      const matched = (comparison?.present || []).length
      const missing = (comparison?.missing || []).length
      const total = matched + missing
      const pct = total ? Math.round((matched / total) * 100) : 0
      return {
        skills: { matched, total, pct, score: 0 },
        keywords: { matched, total, pct, score: 0 },
        bullets: { matched: 0, total: 0, pct: 0, score: 0 },
        weights: { skills: 33.3, keywords: 33.3, bullets: 33.3 },
        details: { skills: [], keywords: [], bullets: [] },
      }
    }
    return {
      skills: {
        matched: raw.skills?.matched ?? 0,
        total: raw.skills?.total ?? 0,
        pct: raw.skills?.pct ?? 0,
        score: raw.skills?.score ?? 0,
      },
      keywords: {
        matched: raw.keywords?.matched ?? 0,
        total: raw.keywords?.total ?? 0,
        pct: raw.keywords?.pct ?? 0,
        score: raw.keywords?.score ?? 0,
      },
      bullets: {
        matched: raw.bullets?.matched ?? 0,
        total: raw.bullets?.total ?? 0,
        pct: raw.bullets?.pct ?? 0,
        coveragePct: raw.bullets?.coveragePct ?? raw.bullets?.pct ?? 0,
        score: raw.bullets?.score ?? 0,
      },
      weights: raw.weights || { skills: 33.3, keywords: 33.3, bullets: 33.3 },
      // Cap detail lists so production JSON stays small/reliable
      details: {
        skills: (raw.details?.skills || []).slice(0, 40),
        keywords: (raw.details?.keywords || []).slice(0, 40),
        bullets: (raw.details?.bullets || []).slice(0, 25),
      },
    }
  }

  const beforeBreakdown = compactBreakdown(beforeComparison)
  const afterBreakdown = compactBreakdown(afterComparison)

  return {
    beforeScore: beforeComparison.atsScore,
    afterScore: afterComparison.atsScore,
    scoreDelta: afterComparison.atsScore - beforeComparison.atsScore,
    beforeBreakdown,
    afterBreakdown,
    keywordsMatched: afterComparison.present || [],
    keywordsStrong: afterComparison.strong || [],
    keywordsWeak: afterComparison.weak || [],
    keywordsStillMissing: afterComparison.missing || [],
    addedKeywords,
    addedBullets,
    skillsAdded: applied.skills || [],
    summaryBulletsAdded: applied.summary?.added?.length || 0,
    summaryRewrites: applied.summary?.rewritten?.length || 0,
    experienceBulletsAdded: expAdded,
    bulletsRewritten: expRewritten,
    addedToResume: applied,
  }
}

export function patchDocx(originalBuffer, plan, { highlight = false, resumeData = null } = {}) {
  const zip = new PizZip(originalBuffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Invalid DOCX: missing document.xml')

  let xml = docFile.asText()
  const mark = highlight ? 'new' : null
  const rewriteMark = highlight ? 'rewrite' : null
  const experience = resumeData?.experience || []
  const applied = emptyApplied()
  let experienceStart = findSectionStart(xml, SECTION_ANCHORS.experience)

  for (const rewrite of plan.bulletRewrites || []) {
    if (!rewrite.original || !rewrite.replacement) continue

    let rangeStart = 0
    let rangeEnd = xml.length
    let section = 'experience'
    let companyKey = rewrite.company || 'Unknown'

    if (isSummaryRewrite(rewrite)) {
      section = 'summary'
      const summaryStart = findSectionStart(xml, SECTION_ANCHORS.summary)
      if (summaryStart === -1) continue
      rangeStart = summaryStart
      rangeEnd = findNextSectionStart(xml, summaryStart)
      companyKey = 'Summary'
    } else if (experienceStart !== -1) {
      rangeStart = experienceStart
      const expIdx = experience.findIndex(
        (e) => e.company?.toLowerCase() === rewrite.company?.toLowerCase(),
      )
      const expEntry = expIdx >= 0 ? experience[expIdx] : null
      const block = findCompanyBlock(
        xml,
        rewrite.company,
        experienceStart,
        expIdx > 0 ? experience[expIdx - 1].company : null,
        expIdx >= 0 && expIdx < experience.length - 1 ? experience[expIdx + 1].company : null,
        expEntry?.title,
      )
      if (!block) continue
      rangeStart = block.start
      rangeEnd = block.end
    }

    const found = findParagraphForRewrite(
      xml,
      rewrite.original,
      rangeStart,
      rangeEnd,
      resumeData,
      section === 'summary',
    )
    if (!found) continue

    // Reuse bold keyword phrases from nearby bullets in the same range
    const nearbyEnds = getBulletParagraphEnds(xml, rangeStart, rangeEnd)
    const sectionPhrases = collectBoldPhrasesFromEnds(xml, nearbyEnds)
    const newPara = rewriteParagraph(found.para, rewrite.replacement, rewriteMark, sectionPhrases)
    xml = xml.slice(0, found.start) + newPara + xml.slice(found.end)

    if (section === 'summary') {
      applied.summary.rewritten.push({
        original: found.plain,
        text: rewrite.replacement,
      })
    } else {
      ensureExperienceEntry(applied, companyKey).rewritten.push({
        original: found.plain,
        text: rewrite.replacement,
      })
    }
  }

  experienceStart = findSectionStart(xml, SECTION_ANCHORS.experience)
  if (experienceStart !== -1 && experience.length) {
    for (let expIdx = experience.length - 1; expIdx >= 0; expIdx--) {
      const expEntry = experience[expIdx]
      const bullets = getPlanBulletsForCompany(plan, expEntry.company)
      if (!bullets.length) continue

      const block = findCompanyBlockByIndex(xml, experience, expIdx, experienceStart)
      if (!block) continue

      const { insertAt, bulletEnds } = resolveExperienceInsertPoint(xml, block)
      if (!insertAt || !bulletEnds.length) continue

      const template = resolveBulletTemplate(xml, bulletEnds, bulletEnds[0])
      if (!template) continue
      const companyApplied = ensureExperienceEntry(applied, expEntry.company)
      xml = insertBulletsAt(xml, insertAt, bullets, template, mark, companyApplied.added)
    }
  }

  const summaryStart = findSectionStart(xml, SECTION_ANCHORS.summary)
  if (summaryStart !== -1 && plan.summaryBullets?.length) {
    const summaryEnd = findNextSectionStart(xml, summaryStart)
    const { insertAt, bulletEnds } = resolveSummaryInsertPoint(xml, summaryStart, summaryEnd)

    if (insertAt) {
      // Prefer real bullets in summary; if summary is prose-only, clone Experience bullet spacing
      const template = resolveBulletTemplate(xml, bulletEnds, insertAt)
      if (template) {
        xml = insertBulletsAt(
          xml,
          insertAt,
          plan.summaryBullets.slice(0, 2),
          template,
          mark,
          applied.summary.added,
        )
      }
    }
  }

  // Skills: append ONLY into existing category lines (Tools & Platforms:, etc.).
  // Never create a new Technical Skills heading / underlined dump block.
  const { entries: skillEntries } = redistributeSkillsToExistingCategories(plan, xml)
  // Apply from bottom to top so earlier paraEnd offsets stay valid
  const orderedSkillEntries = [...skillEntries].sort((a, b) => b.paraEnd - a.paraEnd)

  for (const entry of orderedSkillEntries) {
    if (!entry.skills?.length || !entry.paraEnd) continue

    const chunk = getParagraphChunk(xml, entry.paraEnd)
    if (!chunk || isSkillsSectionTitle(getPlainTextFromParagraph(chunk))) continue

    const existingText = getRawParagraphText(chunk).trimEnd()
    const needsComma = existingText.length > 0 && !/[,;:]$/.test(existingText)
    const rPr = extractLastRunRPr(xml, entry.paraEnd)
    const runs = entry.skills.map((s, i) => buildSkillRun(s, rPr, mark, {
      leadingSeparator: i === 0 ? (needsComma ? ', ' : ' ') : ', ',
    })).join('')
    xml = xml.slice(0, entry.paraEnd - 6) + runs + xml.slice(entry.paraEnd - 6)

    for (const skill of entry.skills) {
      applied.skills.push({ skill, category: entry.category })
    }
  }

  // Do NOT rewrite document-wide spacing — that breaks original margins/gaps.
  // New bullets already clone pPr (spacing/ind/numPr) from neighboring bullets.

  if (!highlight) {
    xml = stripAllHighlights(xml)
  }

  zip.file('word/document.xml', xml)
  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    applied,
  }
}
