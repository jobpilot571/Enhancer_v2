import PizZip from 'pizzip'
import { SOFT_SKILLS, KNOWN_TOOLS } from './scoringDictionary.js'

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

/** Split category-label vs skills body around the first <w:tab/> (tab-column layouts). */
function getParagraphTextPartsAroundTab(chunk) {
  const tabIdx = chunk.search(/<w:tab[\s/>]/)
  if (tabIdx === -1) return null
  return {
    before: getRawParagraphText(chunk.slice(0, tabIdx)).trim(),
    after: getRawParagraphText(chunk.slice(tabIdx)).trim(),
  }
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
function clampBulletLength(text, maxChars = 175) {
  let t = stripLeadingBulletGlyphs(text)
  if (!t) return ''
  // Drop incomplete trailing glue left by skill-weaving / truncation
  t = t.replace(/\s+(and|or|with|using|via|for|to|of|in)\s*[.,;:]*$/i, '').trim()
  if (!/[.!?]$/.test(t)) t = `${t}.`
  if (t.length <= maxChars) return t
  const cut = t.slice(0, maxChars)
  const at = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','), cut.lastIndexOf(' '))
  let trimmed = (at > 80 ? cut.slice(0, at) : cut).trim().replace(/[,;:\-–—]+$/, '')
  trimmed = trimmed.replace(/\s+(and|or|with|using|via|for|to|of|in)$/i, '').trim()
  return `${trimmed}.`
}

/** True short skill/tool names only — reject JD sentences, soft phrases, domain outcomes, and dumps. */
function isValidSkillName(skill) {
  const s = (skill || '').trim()
  if (!s) return false
  if (s.length > 36) return false
  if (s.split(/\s+/).length > 4) return false
  if (/[.!?]/.test(s)) return false
  if (/,/.test(s)) return false // never accept comma-lists as one "skill"
  if (/[:;]/.test(s)) return false
  const lower = s.toLowerCase()
  const banned = [
    'pto', 'flexible', 'apple equipment', 'track record', 'customer engagement',
    'technical fluency', 'owning complex', 'build integrations', 'salary',
    'benefits', 'remote work', 'work from home', 'equal opportunity',
    'cloud environments', 'cloud deployments', 'cloud infrastructure',
    'cloud-native applications', 'cloud-native platforms', 'cloud-native systems',
    'cloud-native technologies', 'cloud-native tools', 'cloud platforms',
    'cloud services', 'developer-facing', 'internal tools', 'ai tools',
    'continuous delivery', 'continuous integration', 'exceptional',
    'operations experience', 'problem solving', 'cross-functional',
    'best practices', 'hands-on', 'self-starter', 'team player',
    // Domain outcomes / soft phrases that must NEVER land in Technical Skills
    'student success', 'learner behavior', 'learner behaviors', 'data-driven research',
    'data driven research', 'business value', 'stakeholder alignment',
    'operational collaboration', 'decision making', 'decision-making',
    'communication skills', 'analytical thinking', 'critical thinking',
    'leadership', 'teamwork', 'collaboration', 'creativity', 'judgment',
    'payment integrity', 'hospital billing', 'claims editing',
    'reimbursement methodologies', 'payer reimbursement',
    'state and federal', 'years of experience', '4+ years', '5+ years',
    // Soft / adjective / process fluff (not concrete tools)
    'iterative', 'facilitation', 'facilitation skills', 'reporting',
    'manufacturing processes', 'order-to-cash workflows', 'enterprise integrations',
    'customer service', 'data security', 'system administration',
    'continuous improvement', 'stakeholder management', 'change management',
    'user adoption', 'user adoption support', 'testing coordination',
  ]
  if (banned.some((b) => (b.includes(' ') ? lower.includes(b) : lower === b))) return false
  if (SOFT_SKILLS.has(lower)) return false
  // Outcome / research / behavior / soft-skill phrasing is not a tool
  if (/\b(success|behavior|behaviours?|research|initiative|outcomes?|alignment|engagement|culture|mindset|facilitation|iterative)\b/i.test(lower)) {
    return false
  }
  // Soft/generic fluff that is not a concrete tool
  if (/^(cloud|software|hardware|systems?|applications?|platforms?|tools?|technologies|environments?|deployments?|services?|products?|dashboards?|reporting|etl)$/i.test(s)) {
    return false
  }
  if (!/[a-z0-9]/i.test(s)) return false
  // Prefer concrete tools: known tool, acronym, or short technical token
  const words = lower.split(/\s+/)
  if (words.length >= 3 && !/\b(sql|api|aws|azure|bi|dbt|qa|uat|ci|cd|ml|ai|data|power|office|dynamics)\b/i.test(lower)) {
    return false
  }
  // Allow ETL as part of a compound only (Azure Data Factory, Informatica ETL) — not alone
  if (lower === 'etl' || lower === 'reporting') return false
  // Prefer known tools when available; still allow short technical tokens / acronyms
  if (KNOWN_TOOLS.has(lower)) return true
  if (/^[A-Z]{2,6}$/.test(s)) return true // SQL, JIRA, UAT, etc.
  if (words.length === 1 && s.length <= 18) return true
  if (/\b(sql|jira|azure|aws|power bi|tableau|python|excel|visio|confluence|sharepoint|salesforce|dynamics|sap|oracle|snowflake|databricks|dbt|informatica|ssis|ssrs|qlik|looker|figma|miro|postman|selenium|cucumber)\b/i.test(lower)) {
    return true
  }
  return false
}

/**
 * Skills forced onto the resume must be missing HARD skills/tools only —
 * never domain keywords or soft outcomes.
 */
function hardMissingSkillCandidates(comparison) {
  const pool = [
    ...(comparison?.missingHardSkills || []),
    ...(comparison?.report?.missingRequiredSkills || []),
    ...(comparison?.report?.missingTools || []),
  ]
  // Do NOT fall back to comparison.missing — that list includes soft/domain fluff
  return pool.filter((s) => isValidSkillName(s))
}

/** Expand a plan skill entry that may be a comma-dump into individual candidates. */
function expandSkillCandidates(raw) {
  const text = (raw || '').trim()
  if (!text) return []
  if (!text.includes(',')) return isValidSkillName(text) ? [text] : []
  return text
    .split(',')
    .map((p) => p.trim())
    .filter(isValidSkillName)
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

function mergeFontIntoRPr(targetRPr, sourceRPr) {
  let rPr = targetRPr || ''
  if (!sourceRPr) return rPr
  if (!rPr) return sourceRPr

  const copyTag = (tag) => {
    if (new RegExp(`<w:${tag}\\b`).test(rPr)) return
    const m = sourceRPr.match(new RegExp(`<w:${tag}\\b[^/]*/>|<w:${tag}\\b[\\s\\S]*?</w:${tag}>`))
    if (m) rPr = rPr.replace('</w:rPr>', `${m[0]}</w:rPr>`)
  }
  copyTag('rFonts')
  copyTag('sz')
  copyTag('szCs')
  copyTag('color')
  copyTag('kern')
  copyTag('spacing')
  return rPr
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
  let anyFontRPr = ''
  const boldPhrases = []
  let hasNormalText = false
  let boldKeywordRuns = 0

  for (const run of runs) {
    const text = getRunText(run)
    const cleaned = text.replace(/^[•\u2022▪◦\-\*\s]+/, '').trim()
    const rPr = getRunRPr(run)
    if (rPr && /w:rFonts|w:sz/.test(rPr) && !anyFontRPr) anyFontRPr = rPr
    if (!cleaned) continue

    const bold = isBoldRPr(rPr)

    if (bold) {
      if (!boldRPr) boldRPr = rPr
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

  const keywordBold = hasNormalText && boldKeywordRuns > 0

  if (!baseRPr && boldRPr) {
    baseRPr = stripBold(boldRPr)
  }
  baseRPr = stripBold(baseRPr || '')
  // Guarantee font family/size so Word does not fall back to a different font
  baseRPr = mergeFontIntoRPr(baseRPr || '<w:rPr></w:rPr>', anyFontRPr || boldRPr)
  baseRPr = stripBold(baseRPr)
  if (!baseRPr.includes('</w:rPr>')) {
    baseRPr = baseRPr ? `<w:rPr>${baseRPr}</w:rPr>` : ''
  }

  if (!boldRPr && baseRPr) {
    boldRPr = baseRPr.includes('</w:rPr>')
      ? baseRPr.replace('</w:rPr>', '<w:b/><w:bCs/></w:rPr>')
      : '<w:rPr><w:b/><w:bCs/></w:rPr>'
  } else if (boldRPr) {
    boldRPr = mergeFontIntoRPr(boldRPr, baseRPr)
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
 * Remove pagination traps that create blank half/full pages in Word:
 * keepNext chains, forced page breaks, and absurd before/after spacing.
 * Preserves indent, list numbering, and fonts.
 */
function sanitizeParagraphPPr(pPr, { isBullet = false } = {}) {
  if (!pPr) {
    return '<w:pPr><w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:spacing w:before="0" w:after="40"/></w:pPr>'
  }

  let next = pPr
    .replace(/<w:keepNext\b[^/]*\/>/g, '')
    .replace(/<w:keepNext\b[\s\S]*?<\/w:keepNext>/g, '')
    .replace(/<w:keepLines\b[^/]*\/>/g, '')
    .replace(/<w:keepLines\b[\s\S]*?<\/w:keepLines>/g, '')
    .replace(/<w:pageBreakBefore\b[^/]*\/>/g, '')
    .replace(/<w:pageBreakBefore\b[\s\S]*?<\/w:pageBreakBefore>/g, '')

  next = next.replace(/<w:spacing\b[^/]*\/>/g, (tag) => {
    const beforeTwip = /(?:^|\s)w:before="(\d+)"/.exec(tag)
    const afterTwip = /(?:^|\s)w:after="(\d+)"/.exec(tag)
    const beforeLines = /w:beforeLines="(\d+)"/.exec(tag)
    const afterLines = /w:afterLines="(\d+)"/.exec(tag)
    const line = /w:line="(\d+)"/.exec(tag)
    const lineRule = /w:lineRule="([^"]+)"/.exec(tag)

    let b = beforeTwip ? parseInt(beforeTwip[1], 10) : 0
    let a = afterTwip ? parseInt(afterTwip[1], 10) : 0
    if (!beforeTwip && beforeLines) b = Math.round(parseInt(beforeLines[1], 10) * 2.4)
    if (!afterTwip && afterLines) a = Math.round(parseInt(afterLines[1], 10) * 2.4)

    let ln = line ? parseInt(line[1], 10) : null
    const rule = lineRule ? lineRule[1] : null

    const maxBefore = isBullet ? 60 : 160
    const maxAfter = isBullet ? 80 : 200
    if (b > maxBefore) b = isBullet ? 0 : 80
    if (a > maxAfter) a = isBullet ? 40 : 80
    if (ln && (rule === 'auto' || !rule) && ln >= 360) ln = 240
    // Exact line spacing with huge values also creates blank bands
    if (ln && rule === 'exact' && ln > 480) ln = 240

    const parts = [`w:before="${b}"`, `w:after="${a}"`]
    if (ln != null) {
      parts.push(`w:line="${ln}"`)
      parts.push(`w:lineRule="${rule === 'exact' ? 'auto' : (rule || 'auto')}"`)
    }
    return `<w:spacing ${parts.join(' ')}/>`
  })

  // ALWAYS set explicit off — required to override List Paragraph / basedOn style inheritance
  if (/<\/w:pPr>/.test(next)) {
    next = next
      .replace(/<w:keepNext\b[^/]*\/>/g, '')
      .replace(/<w:keepLines\b[^/]*\/>/g, '')
      .replace('</w:pPr>', '<w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:pageBreakBefore w:val="0"/></w:pPr>')
  }

  return next
}

/**
 * Permanent fix: EVERY body paragraph must explicitly disable keep-with-next.
 * Paragraphs with no pPr were still inheriting keepNext from list styles — that
 * creates the classic "1 bullet on a blank page, rest on the next page" gap.
 */
function forceSafePaginationOnAllParagraphs(xml) {
  if (!xml) return xml

  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    // Skip sectPr-only / empty structural noise carefully — still sanitize real content paras
    const openMatch = para.match(/^<w:p\b[^>]*>/)
    if (!openMatch) return para
    const open = openMatch[0]
    const rest = para.slice(open.length)

    if (/^<w:pPr\b[\s\S]*?<\/w:pPr>/.test(rest)) {
      return para.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, (pPr) => {
        const isBullet = /w:numPr/.test(pPr)
          || /w:ilvl/.test(pPr)
          || /w:pStyle\s[^>]*w:val="[^"]*List/i.test(pPr)
          || /[•\u2022]/.test(para)
        return sanitizeParagraphPPr(pPr, { isBullet })
      })
    }

    // No pPr — inject explicit safe pagination so styles cannot reintroduce keepNext
    const isBullet = /w:numPr/.test(para) || /[•\u2022]/.test(para)
    const safePPr = sanitizeParagraphPPr(null, { isBullet })
    return `${open}${safePPr}${rest}`
  })
}

/**
 * Document-wide pass: stop Word from leaving blank pages after enhance inserts.
 */
function sanitizeDocumentPagination(xml) {
  if (!xml) return xml

  let out = xml
    .replace(/<w:lastRenderedPageBreak\s*\/>/g, '')
    .replace(/<w:br\b[^>]*w:type="page"[^/]*\/>/g, '')
    .replace(/<w:br\b[^>]*w:type="page"[^>]*>\s*<\/w:br>/g, '')

  // Drop empty page-break-only / huge-spacer paragraphs
  out = out.replace(
    /<w:p\b[^>]*>\s*(?:<w:pPr\b[\s\S]*?<\/w:pPr>\s*)?(?:<w:r\b[\s\S]*?<\/w:r>\s*)*<\/w:p>/g,
    (para) => {
      const plain = getPlainTextFromParagraph(para).trim()
      if (!plain && (/w:type="page"/.test(para) || /w:lastRenderedPageBreak/.test(para))) {
        return ''
      }
      if (!plain) {
        const spacing = getParagraphSpacingMetrics(para)
        if (spacing.after > 120 || spacing.before > 120) return ''
      }
      return para
    },
  )

  // Nuclear: every paragraph gets explicit keepNext/keepLines off
  out = forceSafePaginationOnAllParagraphs(out)

  out = out.replace(/<w:cantSplit\b[^/]*\/>/g, '')
  out = out.replace(/<w:cantSplit\b[\s\S]*?<\/w:cantSplit>/g, '')
  out = out.replace(/<w:trHeight\b[^>]*w:val="(\d+)"[^/]*\/>/g, (tag, val) => {
    const n = parseInt(val, 10)
    if (n > 600) return '<w:trHeight w:val="0" w:hRule="auto"/>'
    return tag
  })
  out = out.replace(/<w:framePr\b[^/]*\/>/g, '')
  out = out.replace(/<w:framePr\b[\s\S]*?<\/w:framePr>/g, '')

  // Permanent layout geometry pass — margins, skinny columns, extreme indents
  out = normalizeDocxGeometry(out)

  return out
}

/** Twips helpers (1440 twips = 1 inch). */
const TWIP_IN = 1440
const MIN_PAGE_MARGIN = 504 // 0.35"
const MAX_PAGE_MARGIN = 1440 // 1"
const SAFE_PAGE_MARGIN = 720 // 0.5"
const MIN_CONTENT_COL = 2880 // 2" — body column floor
const MIN_ANY_COL = 2160 // 1.5" — stop letter-wrap ("Business", "Experience")
const MIN_SIDEBAR_COL = 2400 // left label column floor after stripping vertical text
const CHAR_WIDTH_TWIPS = 160 // ~11pt Calibri average glyph width
const MAX_PARA_LEFT_IND = 1080 // 0.75"
const MAX_PARA_HANGING = 360
const DEFAULT_CONTENT_WIDTH = 9360 // ~6.5" usable page width

/**
 * Permanent fix for production layout failures seen across many resumes:
 * - huge left whitespace / content shoved right (pgMar + extreme w:ind)
 * - section titles wrapping vertically ("B\nu\ns...") in skinny table cells
 * - clipped leading letters from hanging indent > usable cell width
 * - Technical Skills categories mashed onto one line
 * - heading borders cutting through headline text
 *
 * Deterministic OOXML rewrite — no AI.
 */
export function normalizeDocxGeometry(xml) {
  if (!xml) return xml
  let out = xml
  out = normalizePageMargins(out)
  out = normalizeParagraphIndents(out)
  out = normalizeTableGeometry(out)
  out = relocateSkinnySidebarText(out)
  out = ensureTableCellsHaveParagraph(out)
  out = splitMashedSkillCategoryParagraphs(out)
  out = normalizeHeadingBorders(out)
  return out
}

function normalizePageMargins(xml) {
  return xml.replace(/<w:pgMar\b[^/]*\/>/g, (tag) => {
    const attrs = {}
    for (const m of tag.matchAll(/\b(w:(?:top|right|bottom|left|header|footer|gutter))="(\d+)"/g)) {
      // Last value wins if the source tag already had duplicates
      attrs[m[1]] = parseInt(m[2], 10)
    }
    const clamp = (key) => {
      if (attrs[key] == null) return
      if (attrs[key] > MAX_PAGE_MARGIN) attrs[key] = SAFE_PAGE_MARGIN
      if (attrs[key] < MIN_PAGE_MARGIN) attrs[key] = MIN_PAGE_MARGIN
    }
    // Left margin is the usual culprit for "huge left space"
    if (attrs['w:left'] != null && attrs['w:left'] > 1260) {
      attrs['w:left'] = SAFE_PAGE_MARGIN
    }
    if (attrs['w:right'] != null && attrs['w:right'] > 1440) {
      attrs['w:right'] = SAFE_PAGE_MARGIN
    }
    clamp('w:top')
    clamp('w:bottom')
    clamp('w:left')
    clamp('w:right')
    // Keep gutter as-is (0 is valid). Never re-emit it via "other" — that caused
    // "Attribute w:gutter redefined" and broke the enhanced preview XML parse.

    const parts = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`)
    const seen = new Set(Object.keys(attrs))
    const other = []
    for (const m of tag.matchAll(/\b(w:[a-zA-Z]+)="([^"]*)"/g)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      other.push(`${m[1]}="${m[2]}"`)
    }
    return `<w:pgMar ${[...parts, ...other].join(' ')}/>`
  })
}

function normalizeParagraphIndents(xml) {
  // Process per paragraph so we can preserve tab-column skills layouts
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const hasTabLayout = /<w:tabs\b/.test(para) || /<w:tab[\s/>]/.test(para)
    const tabPosMatch = [...para.matchAll(/<w:tab\b[^>]*w:pos="(\d+)"/g)]
    const designedCol = tabPosMatch.length
      ? Math.max(...tabPosMatch.map((m) => parseInt(m[1], 10)))
      : null

    // Classic skills layout: left indent ≈ hanging indent (both large) to align wrapped lines
    const indTag = para.match(/<w:ind\b[^/]*\/>/)
    let isHangingColumn = false
    if (indTag) {
      const leftM = /w:left="(\d+)"/.exec(indTag[0])
      const hangM = /w:hanging="(\d+)"/.exec(indTag[0])
      const left = leftM ? parseInt(leftM[1], 10) : 0
      const hanging = hangM ? parseInt(hangM[1], 10) : 0
      if (hanging >= 720 && left >= hanging - 240) isHangingColumn = true
    }

    // Skills / two-column lines: never crush hanging indent — that causes the
    // "label then huge gap then skills / wrapped lines misaligned" mess.
    if (hasTabLayout || isHangingColumn || designedCol) {
      return para.replace(/<w:ind\b[^/]*\/>/g, (tag) => {
        const get = (name) => {
          const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tag)
          return m ? parseInt(m[1], 10) : null
        }
        let left = get('w:left')
        let hanging = get('w:hanging')
        let firstLine = get('w:firstLine')
        let right = get('w:right')
        let changed = false
        const col = designedCol || hanging || left || 2880

        // Restore hanging if a prior pass destroyed the column align
        if (designedCol && (hanging == null || hanging < designedCol * 0.55)) {
          hanging = designedCol
          left = Math.max(left || 0, designedCol)
          changed = true
        }
        // Only clamp absurd >5" indents
        if (left != null && left > 7200) {
          left = col
          changed = true
        }
        if (hanging != null && hanging > 7200) {
          hanging = col
          changed = true
        }
        if (right != null && right > 1440) {
          right = 0
          changed = true
        }
        if (!changed) return tag

        const parts = []
        if (left != null) parts.push(`w:left="${left}"`)
        if (hanging != null) parts.push(`w:hanging="${hanging}"`)
        if (firstLine != null && hanging == null) parts.push(`w:firstLine="${firstLine}"`)
        if (right != null) parts.push(`w:right="${right}"`)
        return parts.length ? `<w:ind ${parts.join(' ')}/>` : tag
      })
    }

    // Non-column body text: clamp extreme shove-right indents only
    return para.replace(/<w:ind\b[^/]*\/>/g, (tag) => {
      const get = (name) => {
        const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tag)
        return m ? parseInt(m[1], 10) : null
      }
      let left = get('w:left')
      let hanging = get('w:hanging')
      let firstLine = get('w:firstLine')
      let right = get('w:right')
      let changed = false

      // Only clamp pathological body indents (>1"), not normal list bullets (~720)
      if (left != null && left > 1440) {
        left = 720
        changed = true
      }
      if (hanging != null && hanging > 720 && !(left != null && hanging >= (left - 240))) {
        hanging = MAX_PARA_HANGING
        changed = true
      }
      if (left != null && hanging != null && hanging > left) {
        hanging = Math.min(hanging, Math.max(0, left))
        changed = true
      }
      if (firstLine != null && firstLine > 720) {
        firstLine = 360
        changed = true
      }
      if (right != null && right > 720) {
        right = 0
        changed = true
      }
      if (!changed) return tag

      const parts = []
      if (left != null) parts.push(`w:left="${left}"`)
      if (hanging != null) parts.push(`w:hanging="${hanging}"`)
      if (firstLine != null && hanging == null) parts.push(`w:firstLine="${firstLine}"`)
      if (right != null) parts.push(`w:right="${right}"`)
      for (const name of ['w:start', 'w:end']) {
        const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tag)
        if (m) {
          let v = parseInt(m[1], 10)
          if (v > 1440) v = 720
          parts.push(`${name}="${v}"`)
        }
      }
      return parts.length ? `<w:ind ${parts.join(' ')}/>` : tag
    })
  })
}

/**
 * Widen skinny table columns that force section titles to wrap one letter per line.
 * Also strips vertical textDirection that makes headings unreadable in body layouts.
 */
function normalizeTableGeometry(xml) {
  const contentWidth = estimateContentWidthTwips(xml)

  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tbl) => {
    let next = tbl

    // Remove vertical text direction on cells (common sidebar title pattern gone wrong)
    next = next
      .replace(/<w:textDirection\b[^/]*\/>/g, '')
      .replace(/<w:textDirection\b[\s\S]*?<\/w:textDirection>/g, '')

    // Convert percentage cell widths to absolute dxa so floors apply
    next = convertPctTcWidths(next, contentWidth)

    // Collect gridCol widths
    const gridCols = [...next.matchAll(/<w:gridCol\b[^/]*\/>/g)]
    if (!gridCols.length) {
      return widenTcWidths(next)
    }

    const widths = gridCols.map((m) => {
      const w = /w:w="(\d+)"/.exec(m[0])
      return w ? parseInt(w[1], 10) : 0
    })

    // Per-column: any text + longest word (letter-wrap risk)
    const colHasText = widths.map(() => false)
    const colLongestWord = widths.map(() => 0)
    const rows = [...next.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    for (const row of rows) {
      let colIdx = 0
      const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
      for (const cell of cells) {
        const spanMatch = /w:gridSpan[^>]*w:val="(\d+)"/.exec(cell[0])
        const span = spanMatch ? parseInt(spanMatch[1], 10) : 1
        const text = getCellPlainText(cell[0])
        const compact = text.replace(/\s+/g, '')
        if (compact.length >= 1 && colIdx < colHasText.length) {
          colHasText[colIdx] = true
          const longest = longestWordLen(text)
          if (longest > colLongestWord[colIdx]) colLongestWord[colIdx] = longest
        }
        colIdx += span
      }
    }

    let changed = false
    const newWidths = widths.map((w, i) => {
      if (!colHasText[i] || w <= 0) return w
      const need = Math.max(MIN_ANY_COL, colLongestWord[i] * CHAR_WIDTH_TWIPS + 240)
      if (w < need) {
        changed = true
        return need
      }
      return w
    })

    // 2-col sidebar layouts: left label must fit a full word after textDirection strip
    if (newWidths.length === 2) {
      const [a, b] = newWidths
      if (colHasText[0] && a > 0 && a < MIN_SIDEBAR_COL) {
        newWidths[0] = Math.max(MIN_SIDEBAR_COL, colLongestWord[0] * CHAR_WIDTH_TWIPS + 240)
        changed = true
      }
      if (colHasText[1] && b > 0 && b < MIN_CONTENT_COL) {
        newWidths[1] = Math.max(MIN_CONTENT_COL, b)
        changed = true
      }
      // Keep total roughly page-sized — borrow from the wider column if needed
      const total = newWidths[0] + newWidths[1]
      if (total > contentWidth + 720 && newWidths[1] > MIN_CONTENT_COL) {
        const overflow = total - contentWidth
        newWidths[1] = Math.max(MIN_CONTENT_COL, newWidths[1] - overflow)
      }
    }

    for (let i = 0; i < newWidths.length; i++) {
      if (colHasText[i] && newWidths[i] > 0 && newWidths[i] < MIN_ANY_COL) {
        newWidths[i] = MIN_ANY_COL
        changed = true
      }
    }

    if (changed) {
      let gi = 0
      next = next.replace(/<w:gridCol\b[^/]*\/>/g, (tag) => {
        const w = newWidths[gi++]
        if (w == null) return tag
        if (/w:w="\d+"/.test(tag)) return tag.replace(/w:w="\d+"/, `w:w="${w}"`)
        return tag.replace(/\/?>/, ` w:w="${w}"/>`).replace(/\/\/>/, '/>')
      })
    }

    next = widenTcWidths(next, newWidths)
    return next
  })
}

function getCellPlainText(cellXml) {
  return [...cellXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((t) => unescapeXml(t[1]))
    .join('')
}

function longestWordLen(text) {
  let max = 0
  for (const w of String(text || '').split(/[^A-Za-z0-9+#./-]+/)) {
    if (w.length > max) max = w.length
  }
  return max
}

function estimateContentWidthTwips(xml) {
  const pgMar = xml.match(/<w:pgMar\b[^/]*\/>/)
  const pgSz = xml.match(/<w:pgSz\b[^/]*\/>/)
  const pageW = pgSz && /w:w="(\d+)"/.exec(pgSz[0]) ? parseInt(/w:w="(\d+)"/.exec(pgSz[0])[1], 10) : 12240
  let left = SAFE_PAGE_MARGIN
  let right = SAFE_PAGE_MARGIN
  if (pgMar) {
    const l = /w:left="(\d+)"/.exec(pgMar[0])
    const r = /w:right="(\d+)"/.exec(pgMar[0])
    if (l) left = parseInt(l[1], 10)
    if (r) right = parseInt(r[1], 10)
  }
  const usable = pageW - left - right
  return usable > 4000 ? usable : DEFAULT_CONTENT_WIDTH
}

function convertPctTcWidths(tblXml, contentWidth) {
  return tblXml.replace(/<w:tcW\b[^/]*\/>/g, (tag) => {
    if (!/w:type="pct"/.test(tag)) return tag
    const wMatch = /w:w="(\d+)"/.exec(tag)
    if (!wMatch) return tag
    // OOXML pct is 1/50 of a percent (5000 = 100%)
    const pct = parseInt(wMatch[1], 10)
    const dxa = Math.max(MIN_ANY_COL, Math.round((pct / 5000) * contentWidth))
    return `<w:tcW w:w="${dxa}" w:type="dxa"/>`
  })
}

function widenTcWidths(tblXml, gridWidths = null) {
  let colCursor = 0
  return tblXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    colCursor = 0
    return row.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
      const spanMatch = /w:gridSpan[^>]*w:val="(\d+)"/.exec(cell)
      const span = spanMatch ? parseInt(spanMatch[1], 10) : 1
      const plain = getCellPlainText(cell)
      const textLen = plain.replace(/\s+/g, '').length
      const wordFloor = Math.max(MIN_ANY_COL, longestWordLen(plain) * CHAR_WIDTH_TWIPS + 240)

      let target = null
      if (gridWidths && gridWidths.length) {
        let sum = 0
        for (let i = 0; i < span; i++) sum += gridWidths[colCursor + i] || 0
        if (sum > 0) target = sum
      }

      let nextCell = cell
      if (textLen >= 1) {
        const floor = span > 1 ? Math.max(MIN_CONTENT_COL, wordFloor) : wordFloor
        const tcW = /<w:tcW\b[^/]*\/>/.exec(cell)
        if (tcW) {
          const wMatch = /w:w="(\d+)"/.exec(tcW[0])
          const cur = wMatch ? parseInt(wMatch[1], 10) : 0
          const want = Math.max(cur < floor ? floor : cur, target || 0, floor)
          if (want > cur) {
            let replacement = tcW[0]
              .replace(/w:w="\d+"/, `w:w="${want}"`)
              .replace(/w:type="pct"/, 'w:type="dxa"')
            if (!/w:type=/.test(replacement)) {
              replacement = replacement.replace(/\/>$/, ' w:type="dxa"/>')
            }
            nextCell = nextCell.replace(tcW[0], replacement)
          }
        } else {
          const want = Math.max(target || floor, floor)
          if (/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.test(nextCell)) {
            nextCell = nextCell.replace(
              /<w:tcPr\b[\s\S]*?<\/w:tcPr>/,
              (tcPr) => tcPr.replace('</w:tcPr>', `<w:tcW w:w="${want}" w:type="dxa"/></w:tcPr>`),
            )
          } else {
            nextCell = nextCell.replace(
              /^<w:tc\b[^>]*>/,
              (open) => `${open}<w:tcPr><w:tcW w:w="${want}" w:type="dxa"/></w:tcPr>`,
            )
          }
        }
      }

      colCursor += span
      return nextCell
    })
  })
}

/**
 * Nuclear fix for letter-stacked sidebar labels ("B\nu\ns\ni\nn\ne\ss\ss"):
 * when left cell is still too narrow for its text, move that text into the right cell.
 */
function relocateSkinnySidebarText(xml) {
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const gridCols = [...tbl.matchAll(/<w:gridCol\b[^/]*\/>/g)]
    if (gridCols.length !== 2) return tbl
    const widths = gridCols.map((m) => {
      const w = /w:w="(\d+)"/.exec(m[0])
      return w ? parseInt(w[1], 10) : 0
    })

    return tbl.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
      const cells = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
      if (cells.length !== 2) return row
      const left = cells[0][0]
      const right = cells[1][0]
      const leftText = getCellPlainText(left).trim()
      const rightText = getCellPlainText(right).trim()
      if (!leftText || leftText.length > 48) return row
      if (rightText.length < 20) return row
      if ((left.match(/<w:p\b/g) || []).length > 3) return row

      const tcW = /w:w="(\d+)"/.exec(left.match(/<w:tcW\b[^/]*\/>/)?.[0] || '')
      const leftW = tcW ? parseInt(tcW[1], 10) : widths[0]
      const need = leftText.replace(/\s+/g, '').length * CHAR_WIDTH_TWIPS + 240
      if (!(leftW > 0 && leftW < Math.min(need, 1600))) return row

      const escaped = escapeXml(leftText)
      const injected = `<w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>`
        + `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`

      const leftOpen = left.match(/^<w:tc\b[^>]*>/)?.[0] || '<w:tc>'
      let leftTcPr = left.match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/)?.[0]
      if (leftTcPr) {
        if (/<w:tcW\b/.test(leftTcPr)) {
          leftTcPr = leftTcPr.replace(/<w:tcW\b[^/]*\/>/, '<w:tcW w:w="0" w:type="dxa"/>')
        } else {
          leftTcPr = leftTcPr.replace('</w:tcPr>', '<w:tcW w:w="0" w:type="dxa"/></w:tcPr>')
        }
      } else {
        leftTcPr = '<w:tcPr><w:tcW w:w="0" w:type="dxa"/></w:tcPr>'
      }
      const newLeft = `${leftOpen}${leftTcPr}<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:tc>`

      const rightOpen = right.match(/^<w:tc\b[^>]*>/)?.[0] || '<w:tc>'
      const rightTcPr = right.match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/)?.[0] || ''
      const rightBody = right.slice(rightOpen.length + rightTcPr.length).replace(/<\/w:tc>$/, '')
      const newRight = `${rightOpen}${rightTcPr}${injected}${rightBody}</w:tc>`

      return row.replace(left, newLeft).replace(right, newRight)
    })
  })
}

/**
 * Split skills paragraphs that mashed multiple "Category:" blocks onto one line.
 * e.g. "...Wireframes BI and Reporting Tools: Power BI..."
 */
function splitMashedSkillCategoryParagraphs(xml) {
  const skillsStart = findSectionStart(xml, SECTION_ANCHORS.skills)
  if (skillsStart === -1) return xml
  const skillsEnd = findNextSectionStart(xml, skillsStart)
  if (skillsEnd <= skillsStart) return xml

  const before = xml.slice(0, skillsStart)
  let section = xml.slice(skillsStart, skillsEnd)
  const after = xml.slice(skillsEnd)

  section = section.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    if (isSkillsSectionTitle(getPlainTextFromParagraph(para))) return para
    const plain = getPlainTextFromParagraph(para)
    const segments = splitPlainIntoSkillCategories(plain)
    if (segments.length < 2) return para

    const open = para.match(/^<w:p\b[^>]*>/)?.[0] || '<w:p>'
    const pPr = para.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '<w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr>'
    const styles = extractRunStyles(para)
    const rPr = stripUnderline(styles.baseRPr || stripBold(styles.boldRPr) || '')
    const labelRPr = styles.boldRPr || (rPr ? rPr.replace(/<\/w:rPr>/, '<w:b/></w:rPr>') : '<w:rPr><w:b/></w:rPr>')

    return segments.map((seg) => {
      const label = escapeXml(seg.label)
      const rest = escapeXml(seg.rest)
      const labelRun = `<w:r>${labelRPr}<w:t xml:space="preserve">${label}:</w:t></w:r>`
      const bodyRun = rest
        ? `<w:r>${rPr}<w:t xml:space="preserve"> ${rest}</w:t></w:r>`
        : ''
      return `${open}${pPr}${labelRun}${bodyRun}</w:p>`
    }).join('')
  })

  return before + section + after
}

function splitPlainIntoSkillCategories(plain) {
  const colonRe = /:\s*/g
  const hits = []
  let m
  while ((m = colonRe.exec(plain))) {
    const before = plain.slice(0, m.index)
    const labelMatch = before.match(/([A-Z][A-Za-z0-9/+-]*(?:\s+(?:and|&|of|\/|[A-Z][A-Za-z0-9/+-]*)){0,4})$/)
    if (!labelMatch) continue
    const label = labelMatch[1].trim()
    const words = label.split(/\s+/).filter(Boolean)
    if (words.length < 1 || words.length > 5) continue
    if (label.length < 2 || label.length > 48) continue
    hits.push({
      label,
      labelStart: m.index - labelMatch[1].length,
      contentStart: m.index + m[0].length,
    })
  }
  if (hits.length < 2) return []

  const segments = []
  for (let i = 0; i < hits.length; i++) {
    const contentEnd = i + 1 < hits.length ? hits[i + 1].labelStart : plain.length
    const rest = plain.slice(hits[i].contentStart, contentEnd).replace(/[,\s]+$/, '').trim()
    segments.push({ label: hits[i].label, rest })
  }
  return segments
}

/** Keep bottom borders from cutting through heading text. */
function normalizeHeadingBorders(xml) {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    if (!/<w:pBdr\b/.test(para)) return para
    const plain = getPlainTextFromParagraph(para)
    // Only touch short heading-like lines or lines with bottom border
    if (!/<w:bottom\b/.test(para) && !/<w:top\b/.test(para)) return para
    if (plain.length > 180) return para

    return para.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, (pPr) => {
      let next = pPr
      if (/<w:spacing\b[^/]*\/>/.test(next)) {
        next = next.replace(/<w:spacing\b[^/]*\/>/, (sp) => {
          const after = /w:after="(\d+)"/.exec(sp)
          const before = /w:before="(\d+)"/.exec(sp)
          let a = after ? parseInt(after[1], 10) : 0
          let b = before ? parseInt(before[1], 10) : 0
          if (a < 120) a = 120
          if (b < 60) b = 60
          let out = sp
          if (after) out = out.replace(/w:after="\d+"/, `w:after="${a}"`)
          else out = out.replace(/\/>$/, ` w:after="${a}"/>`)
          if (before) out = out.replace(/w:before="\d+"/, `w:before="${b}"`)
          else out = out.replace(/\/>$/, ` w:before="${b}"/>`)
          return out
        })
      } else {
        next = next.replace('</w:pPr>', '<w:spacing w:before="60" w:after="120"/></w:pPr>')
      }
      return next
    })
  })
}

/** OOXML requires every table cell to contain at least one paragraph. */
function ensureTableCellsHaveParagraph(xml) {
  return xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    if (/<w:p\b/.test(cell)) return cell
    return cell.replace(/<\/w:tc>/, '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:tc>')
  })
}

/**
 * Strip keepNext from styles AND force explicit off on every style pPr.
 */
function sanitizeStylesXml(stylesXml) {
  if (!stylesXml) return stylesXml
  let out = stylesXml
    .replace(/<w:keepNext\b[^/]*\/>/g, '')
    .replace(/<w:keepNext\b[\s\S]*?<\/w:keepNext>/g, '')
    .replace(/<w:keepLines\b[^/]*\/>/g, '')
    .replace(/<w:keepLines\b[\s\S]*?<\/w:keepLines>/g, '')
    .replace(/<w:pageBreakBefore\b[^/]*\/>/g, '')
    .replace(/<w:pageBreakBefore\b[\s\S]*?<\/w:pageBreakBefore>/g, '')
    .replace(/<w:cantSplit\b[^/]*\/>/g, '')
    .replace(/<w:cantSplit\b[\s\S]*?<\/w:cantSplit>/g, '')

  // Inject explicit off into every style paragraph properties block
  out = out.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/g, (pPr) => {
    let next = pPr
      .replace(/<w:keepNext\b[^/]*\/>/g, '')
      .replace(/<w:keepLines\b[^/]*\/>/g, '')
      .replace(/<w:pageBreakBefore\b[^/]*\/>/g, '')
    if (/<\/w:pPr>/.test(next) && !/<w:keepNext\b/.test(next)) {
      next = next.replace('</w:pPr>', '<w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:pageBreakBefore w:val="0"/></w:pPr>')
    }
    return next
  })

  return out
}

function sanitizeAllStyleParts(zip) {
  for (const name of ['word/styles.xml', 'word/stylesWithEffects.xml']) {
    const file = zip.file(name)
    if (file) zip.file(name, sanitizeStylesXml(file.asText()))
  }
}

/**
 * Post-enhance layout repair: re-sanitize document + ALL style parts.
 * Does not re-run AI — deterministic XML cleanup only.
 */
export function repairDocxLayout(docxBuffer) {
  const zip = new PizZip(docxBuffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Invalid DOCX: missing document.xml')

  let xml = sanitizeDocumentPagination(docFile.asText())
  xml = sanitizeDocumentPagination(xml) // second pass after structural deletes
  // Geometry is included in sanitizeDocumentPagination; run once more for safety
  xml = normalizeDocxGeometry(xml)
  zip.file('word/document.xml', xml)
  sanitizeAllStyleParts(zip)

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** Fast plain-text extract from DOCX for QA (no mammoth). */
export function extractDocxPlainText(docxBuffer) {
  const zip = new PizZip(docxBuffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return ''
  return [...docFile.asText().matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  // Keep indent/numPr; strip pagination traps + bold/underline from nested rPr
  let pPr = pPrMatch ? pPrMatch[0] : '<w:pPr></w:pPr>'
  pPr = pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (rPr) => stripUnderline(stripBold(rPr)))
  pPr = sanitizeParagraphPPr(pPr, { isBullet: true })

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
  const isBullet = /w:numPr/.test(paraXml)
    || /w:ilvl/.test(paraXml)
    || /w:pStyle\s[^>]*w:val="[^"]*List/i.test(paraXml)
    || !!detectLiteralBulletPrefix(paraXml)
  const pPr = sanitizeParagraphPPr(stripBoldFromPPr(pPrMatch ? pPrMatch[0] : ''), { isBullet })
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

/** Keep only the dominant bullet layout in a block so inserts stay on one vertical line. */
function filterMajorityLayoutEnds(xml, bulletEnds) {
  const usable = []
  for (const end of bulletEnds || []) {
    const chunk = getParagraphChunk(xml, end)
    if (!isUsableBulletTemplateChunk(chunk)) continue
    usable.push({ end, key: getBulletLayoutKey(chunk) })
  }
  if (!usable.length) return bulletEnds || []

  const counts = new Map()
  for (const u of usable) counts.set(u.key, (counts.get(u.key) || 0) + 1)
  let bestKey = usable[0].key
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  const filtered = usable.filter((u) => u.key === bestKey).map((u) => u.end)
  return filtered.length ? filtered : usable.map((u) => u.end)
}

/**
 * Detect whether the original SUMMARY is bullet-style or a prose paragraph.
 * Rule: bullets for bullet summaries, paragraph weave for paragraph summaries.
 */
export function detectSummaryFormat(xml) {
  const summaryStart = findSectionStart(xml, SECTION_ANCHORS.summary)
  if (summaryStart === -1) return 'bullets'
  const summaryEnd = findNextSectionStart(xml, summaryStart)
  return detectSummaryFormatInRange(xml, summaryStart, summaryEnd)
}

function detectSummaryFormatInRange(xml, summaryStart, summaryEnd) {
  const bulletEnds = getBulletParagraphEnds(xml, summaryStart, summaryEnd)
    .filter((end) => isUsableBulletTemplateChunk(getParagraphChunk(xml, end)))
  const allEnds = getParagraphEndsInRange(xml, summaryStart, summaryEnd)
  const proseEnds = allEnds.filter((end) => {
    const chunk = getParagraphChunk(xml, end)
    if (!chunk || isBulletParagraph(chunk) || detectLiteralBulletPrefix(chunk)) return false
    const plain = getPlainTextFromParagraph(chunk)
    if (!plain || plain.length < 40) return false
    // Skip short section labels that slipped through
    if (/^(professional\s+)?summary|profile|objective$/i.test(plain.trim())) return false
    return true
  })

  if (bulletEnds.length >= 2) return 'bullets'
  if (proseEnds.length >= 1 && bulletEnds.length === 0) return 'paragraph'
  if (proseEnds.length >= 1 && bulletEnds.length === 1) return 'paragraph'
  if (bulletEnds.length >= 1) return 'bullets'
  if (proseEnds.length >= 1) return 'paragraph'
  return 'bullets'
}

function findSummaryProseParagraph(xml, summaryStart, summaryEnd) {
  const allEnds = getParagraphEndsInRange(xml, summaryStart, summaryEnd)
  let best = null
  let bestLen = 0
  for (const end of allEnds) {
    const start = findParagraphStart(xml, end)
    if (start === -1) continue
    const chunk = xml.slice(start, end)
    if (isBulletParagraph(chunk) || detectLiteralBulletPrefix(chunk)) continue
    const plain = getPlainTextFromParagraph(chunk)
    if (!plain || plain.length < 40) continue
    if (/^(professional\s+)?summary|profile|objective$/i.test(plain.trim())) continue
    if (plain.length > bestLen) {
      bestLen = plain.length
      best = { start, end, para: chunk, plain }
    }
  }
  return best
}

/** Turn plan "summary bullets" into prose sentences for paragraph summaries. */
function summaryAdditionsToProse(items) {
  const sentences = []
  for (const item of items || []) {
    let t = stripLeadingBulletGlyphs(item || '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    // Soft length for paragraph weave (not the short bullet clamp)
    if (t.length > 220) {
      const cut = t.slice(0, 220)
      const at = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','), cut.lastIndexOf(' '))
      t = (at > 100 ? cut.slice(0, at) : cut).trim().replace(/[,;:\-–—]+$/, '')
    }
    if (!/[.!?]$/.test(t)) t += '.'
    sentences.push(t)
  }
  return sentences.join(' ')
}

/**
 * Enhance a paragraph-style summary by weaving new sentences into the existing
 * prose paragraph — never insert bullet list items.
 */
function enhanceParagraphSummary(xml, summaryStart, summaryEnd, plan, mark, applied) {
  const additions = (plan.summaryBullets || []).slice(0, 2)
  const proseAdd = summaryAdditionsToProse(additions)
  if (!proseAdd) return xml

  const found = findSummaryProseParagraph(xml, summaryStart, summaryEnd)
  if (!found) return xml

  // Prefer an explicit summary rewrite when it targets this paragraph
  const summaryRewrite = (plan.bulletRewrites || []).find((r) => {
    if (!isSummaryRewrite(r) || !r.replacement) return false
    return textMatches(found.plain, r.original) || textMatches(found.plain, r.replacement)
  })

  let replacement
  if (summaryRewrite?.replacement && !isBulletParagraph(found.para)) {
    // If rewrite is already full prose, use it; still append unique addition if missing
    replacement = stripLeadingBulletGlyphs(summaryRewrite.replacement).replace(/\s+/g, ' ').trim()
    if (proseAdd && !normalizeText(replacement).includes(normalizeText(proseAdd).slice(0, 40))) {
      replacement = `${replacement.replace(/[.!?]?$/, '')}. ${proseAdd}`.replace(/\s+/g, ' ').trim()
    }
  } else {
    const base = found.plain.replace(/\s+/g, ' ').trim()
    replacement = `${base.replace(/[.!?]?$/, '')}. ${proseAdd}`.replace(/\s+/g, ' ').trim()
  }

  const newPara = rewriteParagraphWithAppendHighlight(found.para, found.plain, replacement, mark)
  applied.summary.added.push(...additions.map((a) => stripLeadingBulletGlyphs(a)))
  return xml.slice(0, found.start) + newPara + xml.slice(found.end)
}

/**
 * Rewrite a paragraph; if mark is set, highlight only the newly appended tail.
 */
function rewriteParagraphWithAppendHighlight(paraXml, originalPlain, replacement, mark) {
  const openMatch = paraXml.match(/^<w:p\b[^>]*>/)
  const pOpen = openMatch ? openMatch[0] : '<w:p>'
  const pPrMatch = paraXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)
  const pPr = sanitizeParagraphPPr(stripBoldFromPPr(pPrMatch ? pPrMatch[0] : ''), { isBullet: false })
  const styles = extractRunStyles(paraXml)
  const baseRPr = applyMarkToRPr(stripUnderline(stripBold(styles.baseRPr || '')), null)
  const markedRPr = applyMarkToRPr(stripUnderline(stripBold(styles.baseRPr || '')), mark)

  const cleanReplacement = stripLeadingBulletGlyphs(replacement).replace(/\s+/g, ' ').trim()
  const origNorm = (originalPlain || '').replace(/\s+/g, ' ').trim()

  // Find shared prefix so only the new tail is highlighted
  let splitAt = 0
  if (mark && origNorm) {
    const max = Math.min(origNorm.length, cleanReplacement.length)
    while (splitAt < max && origNorm[splitAt].toLowerCase() === cleanReplacement[splitAt].toLowerCase()) {
      splitAt += 1
    }
    // Prefer splitting on a sentence/word boundary near the end of the original
    if (splitAt > 20) {
      const near = cleanReplacement.lastIndexOf('. ', splitAt)
      if (near >= Math.floor(origNorm.length * 0.5)) splitAt = near + 2
    } else {
      splitAt = 0
    }
  }

  let runs
  if (mark && splitAt > 0 && splitAt < cleanReplacement.length) {
    const head = cleanReplacement.slice(0, splitAt)
    const tail = cleanReplacement.slice(splitAt)
    runs = `<w:r>${baseRPr}<w:t xml:space="preserve">${escapeXml(head)}</w:t></w:r>`
      + `<w:r>${markedRPr}<w:t xml:space="preserve">${escapeXml(tail)}</w:t></w:r>`
  } else {
    const rPr = mark ? markedRPr : baseRPr
    runs = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(cleanReplacement)}</w:t></w:r>`
  }

  return `${pOpen}${pPr}${runs}</w:p>`
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
  bulletEnds = filterMajorityLayoutEnds(xml, bulletEnds)

  let insertAt = getMiddleInsertionPoint(bulletEnds)
  if (!insertAt && bulletEnds.length >= 2) {
    insertAt = bulletEnds[Math.max(0, Math.floor(bulletEnds.length / 2) - 1)]
  }

  // Thin / prose summary: insert after the first body paragraph (or heading)
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
  let bulletEnds = filterMajorityLayoutEnds(xml, getCompanyContentEnds(xml, block))
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

/** List level + left indent — used to keep new bullets on the same vertical start line. */
function getBulletLayoutKey(chunk) {
  if (!chunk) return 'none'
  const ilvl = /w:ilvl\s[^>]*w:val="(\d+)"/.exec(chunk)
  const left = /w:ind\b[^>]*w:left="(\d+)"/.exec(chunk)
  const hanging = /w:ind\b[^>]*w:hanging="(\d+)"/.exec(chunk)
  const hasNum = /w:numPr/.test(chunk) ? '1' : '0'
  return [
    hasNum,
    ilvl ? ilvl[1] : 'x',
    left ? left[1] : 'x',
    hanging ? hanging[1] : 'x',
  ].join(':')
}

function isUsableBulletTemplateChunk(chunk) {
  if (!chunk) return false
  const plain = getPlainTextFromParagraph(chunk)
  if (!plain || plain.length < 12) return false
  if (isSkillsSectionTitle(plain)) return false
  if (!isBulletParagraph(chunk) && !detectLiteralBulletPrefix(chunk) && !/w:numPr/.test(chunk)) {
    return false
  }
  // Skip nested/sub-bullets when possible — they sit further right than main bullets
  const ilvl = /w:ilvl\s[^>]*w:val="(\d+)"/.exec(chunk)
  if (ilvl && parseInt(ilvl[1], 10) > 0) return false
  return true
}

/**
 * Cap absurd before/after spacing that creates half-page / full-page gaps.
 * Keeps original spacing when it is already resume-normal.
 */
function tightenTemplateSpacing(template) {
  if (!template?.pPr) return template
  return {
    ...template,
    pPr: sanitizeParagraphPPr(template.pPr, { isBullet: true }),
  }
}

/**
 * Clone ONLY a sibling bullet in the same section/block.
 * Never borrow indent/font from another section (that caused staggered bullets + font flips).
 */
function pickNearestSiblingTemplate(xml, bulletEnds, insertAt) {
  const usable = []
  for (const end of bulletEnds || []) {
    const chunk = getParagraphChunk(xml, end)
    if (!isUsableBulletTemplateChunk(chunk)) continue
    usable.push({ end, chunk, key: getBulletLayoutKey(chunk) })
  }
  if (!usable.length) return null

  // Prefer the layout used by the majority of bullets in this block
  const keyCounts = new Map()
  for (const u of usable) {
    keyCounts.set(u.key, (keyCounts.get(u.key) || 0) + 1)
  }
  let majorityKey = usable[0].key
  let majorityCount = 0
  for (const [key, count] of keyCounts) {
    if (count > majorityCount) {
      majorityCount = count
      majorityKey = key
    }
  }
  const sameLayout = usable.filter((u) => u.key === majorityKey)
  const pool = sameLayout.length ? sameLayout : usable

  // Nearest sibling to the insert point (same vertical start line as neighbors)
  const anchor = insertAt || pool[0].end
  pool.sort((a, b) => Math.abs(a.end - anchor) - Math.abs(b.end - anchor))
  const chosen = pool[0]

  const sectionPhrases = collectBoldPhrasesFromEnds(xml, pool.map((u) => u.end))
  return tightenTemplateSpacing(extractParagraphTemplate(xml, chosen.end, sectionPhrases))
}

/** Absolute last resort when a section has zero bullets (e.g. prose-only summary). */
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

  for (const [start, end] of regions) {
    const ends = getBulletParagraphEnds(xml, start, end)
    const template = pickNearestSiblingTemplate(xml, ends, ends[0] || null)
    if (template) return template
  }
  return null
}

function resolveBulletTemplate(xml, bulletEnds, insertAt) {
  // 1) Always prefer a real sibling in THIS block — same indent + font as existing lines
  let template = pickNearestSiblingTemplate(xml, bulletEnds, insertAt)
  if (template) return template

  // 2) No local bullets: clone Experience/Summary bullet style, then tighten gaps
  const docTemplate = findDocumentBulletTemplate(xml)
  if (docTemplate) {
    return tightenTemplateSpacing({
      ...docTemplate,
      boldPhrases: uniqueBoldPhrases([
        ...(docTemplate.boldPhrases || []),
        ...collectBoldPhrasesFromEnds(xml, bulletEnds || []),
      ]),
      keywordBold: docTemplate.keywordBold || (docTemplate.boldPhrases || []).length > 0,
    })
  }

  // 3) Last resort: clone the paragraph at insertAt but force tight spacing (never keep huge gaps)
  if (insertAt) {
    const weak = extractParagraphTemplate(xml, insertAt)
    if (weak) {
      let pPr = weak.pPr || '<w:pPr></w:pPr>'
      if (/<w:spacing\b/.test(pPr)) {
        pPr = pPr.replace(/<w:spacing\b[^/]*\/>/g, '<w:spacing w:before="0" w:after="60"/>')
      } else if (/<\/w:pPr>/.test(pPr)) {
        pPr = pPr.replace('</w:pPr>', '<w:spacing w:before="0" w:after="60"/></w:pPr>')
      } else {
        pPr = '<w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>'
      }
      return {
        ...weak,
        pPr,
        literalPrefix: weak.hasNumPr ? '' : (weak.literalPrefix || '• '),
      }
    }
  }

  return null
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
      const colonMatch = plain.match(/^([^:]{2,48}):\s*(.*)$/)
      // Tab-column "Category<TAB>skills..." — w:tab is not present in plain text
      const tabParts = !colonMatch ? getParagraphTextPartsAroundTab(chunk) : null
      const label = colonMatch
        ? colonMatch[1].replace(/[•\u2022]/g, '').trim()
        : (tabParts?.before || '').replace(/[•\u2022]/g, '').trim()
      const rest = colonMatch
        ? (colonMatch[2] || '').trim()
        : (tabParts?.after || '')

      if (
        label
        && label.length >= 2
        && label.length <= 48
        && label.split(/\s+/).length <= 8
        && !label.includes(',')
        && rest.length < 350
        && (colonMatch || tabParts)
      ) {
        lines.push({
          label,
          plain,
          raw,
          paraEnd,
          pStart,
          restLen: rest.length,
          inTable: isParagraphInsideTable(xml, pStart),
          hasTabLayout: /<w:tabs\b/.test(chunk) || /<w:tab[\s/>]/.test(chunk) || Boolean(tabParts),
        })
      }
    }

    pos = paraEnd
  }

  return lines
}

function isParagraphInsideTable(xml, paraStart) {
  const before = xml.slice(Math.max(0, paraStart - 2500), paraStart)
  const lastTc = before.lastIndexOf('<w:tc')
  const lastTcEnd = before.lastIndexOf('</w:tc>')
  return lastTc !== -1 && lastTc > lastTcEnd
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
 * Caps per-line inserts so table layouts cannot explode into dumps.
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
      for (const part of expandSkillCandidates(skill)) {
        allSkills.push({ skill: part, preferred: entry.category })
      }
    }
  }
  for (const skill of plan.skillsToAdd || []) {
    for (const part of expandSkillCandidates(skill)) {
      if (!allSkills.some((s) => normalizeText(s.skill) === normalizeText(part))) {
        allSkills.push({ skill: part, preferred: '' })
      }
    }
  }

  const skipped = []
  for (const { skill, preferred } of allSkills) {
    if (!isValidSkillName(skill)) {
      skipped.push(skill)
      continue
    }
    const line = pickBestCategoryLine(skill, categoryLines, preferred)
    if (!line) {
      skipped.push(skill)
      continue
    }
    const bucket = ensureBucket(line)
    const maxPerLine = line.inTable ? 4 : (line.hasTabLayout ? 6 : 12)
    if (bucket.skills.length >= maxPerLine) {
      skipped.push(skill)
      continue
    }
    // Skip if line is already long — appending more breaks table/column layouts
    const maxRest = line.inTable ? 160 : (line.hasTabLayout ? 220 : 320)
    const projected = (line.restLen || 0) + bucket.skills.join(', ').length + skill.length
    if (projected > maxRest) {
      skipped.push(skill)
      continue
    }
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
      inTable: !!b.line.inTable,
      hasTabLayout: !!b.line.hasTabLayout,
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
  return (entry?.bullets || []).slice(0, 3)
}

export function mergeExperienceAdditions(plan, resumeData) {
  const companies = resumeData.experience || []
  const byCompany = new Map()

  for (const entry of plan.experienceAdditions || []) {
    if (!entry.company || !entry.bullets?.length) continue
    const key = entry.company.toLowerCase()
    const existing = byCompany.get(key) || []
    byCompany.set(key, [...existing, ...entry.bullets].slice(0, 3))
  }

  const experienceAdditions = companies
    .map((c) => ({
      company: c.company,
      bullets: (byCompany.get(c.company?.toLowerCase()) || []).slice(0, 3),
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

/** Prefer run props from the skills body (after the category tab), not the bold label. */
function extractSkillsBodyRPr(xml, paragraphEnd) {
  const chunk = getParagraphChunk(xml, paragraphEnd)
  const tabIdx = chunk.search(/<w:tab[\s/>]/)
  const bodyChunk = tabIdx >= 0 ? chunk.slice(tabIdx) : chunk
  const styles = extractRunStyles(bodyChunk)
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

/**
 * Yellow = light edit of an existing bullet (skills/keywords woven in).
 * Kept for callers/tests; patchDocx always uses yellow for full rewrites.
 */
export function isPolishRewrite(original, replacement) {
  const a = bulletTokens(original)
  const b = bulletTokens(replacement)
  if (a.size < 3 || b.size < 3) return false
  let overlap = 0
  for (const t of a) if (b.has(t)) overlap += 1
  const ratio = overlap / Math.min(a.size, b.size)
  return ratio >= 0.5
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
      if (ratio >= 0.55) return true
    }
  }
  return false
}

/** Reject summary lines that restate years-of-experience already present in the resume. */
function repeatsYearsClaim(newBullet, resumeData) {
  const yearsRe = /(\d+)\s*\+?\s*(?:\+\s*)?(?:years?|yrs)/i
  const m = String(newBullet || '').match(yearsRe)
  if (!m) return false
  const existing = [
    resumeData?.summary || '',
    ...(resumeData?.summaryBullets || []),
  ].join(' ')
  if (!yearsRe.test(existing)) return false
  // Same or similar tenure claim already stated
  const existingMatch = existing.match(yearsRe)
  if (existingMatch && existingMatch[1] === m[1]) return true
  return /\d+\s*\+?\s*(?:years?|yrs)/i.test(existing) && yearsRe.test(newBullet)
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
    if (repeatsYearsClaim(cleaned, resumeData)) continue
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

  // Only hard skills / tools count as skill gaps — never domain keyword phrases
  const missingSet = new Set(
    hardMissingSkillCandidates(comparison).map((s) => s.toLowerCase().trim()),
  )

  const isMissing = (skill) => {
    const lower = skill.toLowerCase().trim()
    if (!missingSet.size) return false
    if (missingSet.has(lower)) return true
    return [...missingSet].some((m) => m.includes(lower) || lower.includes(m))
  }

  const existingSummary = resumeData.summaryBullets || []
  const allExistingBullets = [
    ...existingSummary,
    ...(resumeData.experience || []).flatMap((e) => e.bullets || []),
  ]

  // Summary: reject near-duplicates, years restatements, paraphrases; clamp to ~2 lines
  let summaryBullets = (plan.summaryBullets || [])
    .map((b) => clampBulletLength(b))
    .filter((b) => b
      && !isNearExactSummaryDuplicate(b, existingSummary)
      && !repeatsYearsClaim(b, resumeData)
      && !isDuplicateBullet(b, allExistingBullets))
    .slice(0, 3)

  const summaryRewrites = (plan.bulletRewrites || []).filter(isSummaryRewrite)

  const experienceAdditions = (plan.experienceAdditions || [])
    .map((entry) => ({
      company: entry.company,
      bullets: (entry.bullets || [])
        .map((b) => clampBulletLength(b))
        .filter((b) => b && !isDuplicateBullet(b, allExistingBullets))
        .slice(0, 3),
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
        .flatMap(expandSkillCandidates)
        .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s) && isMissing(s))
        .slice(0, 12)
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
      .flatMap(expandSkillCandidates)
      .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s) && isMissing(s))
      .slice(0, 18)
    if (flat.length) {
      // Prefer a real category heading from the resume — never invent "Technical Skills"
      const realCats = [...(resumeData.headings || []), ...(resumeData.allSections || [])]
        .filter((h) => h && !isSkillsSectionTitle(h))
      const fallbackCat = realCats.find((h) => /tool|platform|skill|technolog/i.test(h)) || realCats[0] || 'Tools & Platforms'
      skillsByCategory.push({ category: fallbackCat, skills: flat })
      flat.forEach((s) => existingSkills.add(s.toLowerCase().trim()))
    }
  }

  // Force-add remaining missing HARD skills/tools only (never domain phrases)
  const stillMissing = hardMissingSkillCandidates(comparison)
    .flatMap(expandSkillCandidates)
    .filter((s) => isValidSkillName(s) && !isDuplicateSkill(s))
    .slice(0, 16)
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
/**
 * Ensure planned (and partial-only) hard skills appear in experience bullets
 * so After scoring can award full evidence credit — not skills-list stuffing.
 */
export function ensureSkillsInBullets(plan, comparison = null, resumeData = null) {
  const fromPlan = [...(plan.skillsToAdd || [])].filter(isValidSkillName)
  const fromPartial = [
    ...(comparison?.weak || []),
    ...(comparison?.report?.partiallyMatchedRequiredSkills || []),
  ]
    .map((s) => String(s || '').trim())
    .filter(isValidSkillName)
    .slice(0, 4)

  const skills = [...new Set([...fromPlan, ...fromPartial])]
  if (!skills.length) return plan

  const allText = [
    ...(plan.summaryBullets || []),
    ...(plan.experienceAdditions || []).flatMap((e) => e.bullets || []),
    ...(plan.bulletRewrites || []).map((r) => r.replacement || ''),
    ...(resumeData?.experience || []).flatMap((e) => e.bullets || []),
  ].join(' ').toLowerCase()

  const missingInBullets = skills.filter((s) => !allText.includes(String(s).toLowerCase()))
  if (!missingInBullets.length) return plan

  const clause = ` using ${missingInBullets.slice(0, 2).join(' and ')}`
  const next = {
    ...plan,
    summaryBullets: [...(plan.summaryBullets || [])],
    experienceAdditions: (plan.experienceAdditions || []).map((e) => ({
      ...e,
      bullets: [...(e.bullets || [])],
    })),
    bulletRewrites: (plan.bulletRewrites || []).map((r) => ({ ...r })),
  }

  // Prefer weaving into an existing rewrite (keeps storytelling; avoids generic adds)
  if (next.bulletRewrites.length) {
    const target = next.bulletRewrites[0]
    let base = String(target.replacement || '').replace(/\.$/, '').trim()
    base = base.replace(/\s+(and|or|with|using|via)\s*$/i, '').trim()
    if (!new RegExp(`\\b${missingInBullets[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(base)) {
      target.replacement = clampBulletLength(`${base}${clause}.`)
    }
    return next
  }

  // Prefer experience additions over inventing a new generic bullet
  if (next.experienceAdditions?.length && next.experienceAdditions[0].bullets?.length) {
    const bullets = next.experienceAdditions[0].bullets
    bullets[0] = clampBulletLength(`${bullets[0].replace(/\.$/, '')}${clause}.`)
    return next
  }

  // Last resort: extend a named system/project from the first company's existing bullets
  const firstExp = resumeData?.experience?.[0]
  const firstCompany = firstExp?.company
  if (firstCompany) {
    const named = String(firstExp.bullets?.[0] || '')
      .match(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\s+(?:App|Application|System|Platform|Portal|Suite|Module))\b/)
    const projectHint = named?.[1] || 'existing operational systems'
    next.experienceAdditions = [
      {
        company: firstCompany,
        bullets: [
          clampBulletLength(
            `Partnered with stakeholders on ${projectHint} requirements and validation${clause} to improve delivery quality.`,
          ),
        ],
      },
      ...next.experienceAdditions.filter(
        (e) => e.company?.toLowerCase() !== firstCompany.toLowerCase(),
      ),
    ]
    return next
  }

  if (next.summaryBullets?.length) {
    next.summaryBullets[0] = clampBulletLength(`${next.summaryBullets[0].replace(/\.$/, '')}${clause}.`)
  }

  return next
}

/**
 * Weave missing JD domain keywords into planned bullets so After keyword
 * coverage can reach a strong match (without dumping a keyword list).
 */
export function ensureDomainKeywordsInBullets(plan, comparison, limit = 6) {
  const missing = [
    ...(comparison?.missingKeywords || []),
    ...(comparison?.report?.missingKeywords || []),
  ]
    .map((k) => String(k || '').trim())
    .filter((k) => k && k.length > 2 && k.length < 48)
    .filter((k) => !/job title alignment/i.test(k))

  if (!missing.length) return plan

  const allText = [
    ...(plan.summaryBullets || []),
    ...(plan.experienceAdditions || []).flatMap((e) => e.bullets || []),
    ...(plan.bulletRewrites || []).map((r) => r.replacement || ''),
  ].join(' ').toLowerCase()

  const stillMissing = missing.filter((k) => !allText.includes(k.toLowerCase()))
  if (!stillMissing.length) return plan

  const toWeave = stillMissing.slice(0, limit)
  const next = {
    ...plan,
    summaryBullets: [...(plan.summaryBullets || [])],
    experienceAdditions: (plan.experienceAdditions || []).map((e) => ({
      ...e,
      bullets: [...(e.bullets || [])],
    })),
  }

  // Distribute phrases across NEW experience bullets first (avoid restating summary tenure)
  let idx = 0
  const targets = []
  for (let ei = 0; ei < next.experienceAdditions.length; ei++) {
    for (let bi = 0; bi < (next.experienceAdditions[ei].bullets || []).length; bi++) {
      targets.push({ kind: 'exp', ei, bi })
    }
  }
  // Only weave into summary if we already have a new summary bullet (never invent years claims)
  for (let i = 0; i < next.summaryBullets.length; i++) {
    targets.push({ kind: 'summary', i })
  }

  if (!targets.length) {
    // Prefer a clean keyword-aligned line without inventing tenure claims
    const phrase = toWeave.slice(0, 3).join(', ')
    next.summaryBullets = [
      clampBulletLength(`Delivered reporting and analysis aligned with ${phrase} across stakeholder programs.`),
    ]
    return next
  }

  for (const t of targets) {
    if (idx >= toWeave.length) break
    const chunk = toWeave.slice(idx, idx + 2)
    idx += chunk.length
    const clause = ` supporting ${chunk.join(' and ')}`
    if (t.kind === 'summary') {
      next.summaryBullets[t.i] = clampBulletLength(
        `${next.summaryBullets[t.i].replace(/\.$/, '')}${clause}.`,
      )
    } else {
      const bullets = next.experienceAdditions[t.ei].bullets
      bullets[t.bi] = clampBulletLength(`${bullets[t.bi].replace(/\.$/, '')}${clause}.`)
    }
  }

  // If phrases remain, append a focused summary line
  if (idx < toWeave.length) {
    const rest = toWeave.slice(idx, idx + 3).join(', ')
    next.summaryBullets.push(
      clampBulletLength(`Advanced ${rest} initiatives with clear requirements and measurable outcomes.`),
    )
    next.summaryBullets = next.summaryBullets.slice(0, 3)
  }

  return next
}

/**
 * Force JD selection coverage: skills + at least one new bullet per company when gaps remain.
 * Used when the LLM under-covers companies or missing skills.
 */
export function ensureAggressiveJdCoverage(plan, resumeData, jdData, comparison) {
  const next = {
    ...plan,
    summaryBullets: [...(plan.summaryBullets || [])],
    experienceAdditions: (plan.experienceAdditions || []).map((e) => ({
      company: e.company,
      bullets: [...(e.bullets || [])],
    })),
    bulletRewrites: [...(plan.bulletRewrites || [])],
    skillsByCategory: (plan.skillsByCategory || []).map((e) => ({
      category: e.category,
      skills: [...(e.skills || [])],
    })),
    skillsToAdd: [...(plan.skillsToAdd || [])],
  }

  const missingSkills = hardMissingSkillCandidates(comparison)
    .flatMap(expandSkillCandidates)
    .filter((s) => isValidSkillName(s))
    .slice(0, 16)

  const existingSkillSet = new Set(
    [
      ...(resumeData?.skills || []),
      ...(resumeData?.technicalSkills || []),
      ...next.skillsToAdd,
      ...next.skillsByCategory.flatMap((e) => e.skills || []),
    ].map((s) => normalizeText(s)),
  )

  const toAddSkills = missingSkills.filter((s) => !existingSkillSet.has(normalizeText(s)))
  if (toAddSkills.length) {
    const realCats = [...(resumeData?.headings || []), ...(resumeData?.allSections || [])]
      .filter((h) => h && !isSkillsSectionTitle(h))
    const defaultCat = realCats.find((h) => /tool|platform|skill|technolog/i.test(h))
      || realCats[0]
      || 'Tools & Platforms'
    let bucket = next.skillsByCategory.find(
      (e) => normalizeText(e.category) === normalizeText(defaultCat),
    )
    if (!bucket) {
      bucket = { category: defaultCat, skills: [] }
      next.skillsByCategory.push(bucket)
    }
    for (const skill of toAddSkills) {
      if (bucket.skills.some((s) => normalizeText(s) === normalizeText(skill))) continue
      bucket.skills.push(skill)
      next.skillsToAdd.push(skill)
    }
  }

  const responsibilities = (jdData?.responsibilities || [])
    .map((r) => String(r || '').trim())
    .filter((r) => r.length > 12)
    .slice(0, 12)
  const tools = [
    ...missingSkills,
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.requiredSkills || []),
  ]
    .map((s) => String(s || '').trim())
    .filter((s) => isValidSkillName(s))
    .slice(0, 10)

  const companies = resumeData?.experience || []
  const allExisting = [
    ...(resumeData?.summaryBullets || []),
    ...companies.flatMap((e) => e.bullets || []),
    ...next.experienceAdditions.flatMap((e) => e.bullets || []),
    ...next.bulletRewrites.map((r) => r.replacement || ''),
  ]

  companies.forEach((exp, expIdx) => {
    if (!exp?.company) return
    let entry = next.experienceAdditions.find(
      (e) => e.company?.toLowerCase() === exp.company.toLowerCase(),
    )
    if (!entry) {
      entry = { company: exp.company, bullets: [] }
      next.experienceAdditions.push(entry)
    }

    if (entry.bullets.length >= 1) return

    const company = exp.company
    const title = exp.title || 'Business Analyst'
    const named = String(exp.bullets?.[0] || '')
      .match(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\s+(?:App|Application|System|Platform|Portal|Suite|Module|ERP|CRM))\b/)
    const projectHint = named?.[1]
      || String(exp.bullets?.[0] || '')
        .split(/[,.]/)
        .map((p) => p.trim())
        .find((p) => p.length > 18 && p.length < 70)
      || `${company} delivery initiatives`
    const resp = responsibilities[(expIdx) % Math.max(responsibilities.length, 1)]
      || 'gather and validate business requirements'
    const shortResp = resp.replace(/^(to\s+|and\s+)/i, '').slice(0, 58)
    const skillA = tools[(expIdx * 2) % Math.max(tools.length, 1)] || 'Jira'
    const skillB = tools[(expIdx * 2 + 1) % Math.max(tools.length, 1)] || 'SQL'
    const candidates = [
      clampBulletLength(
        `As ${title} at ${company}, delivered ${shortResp} on ${projectHint} using ${skillA} and ${skillB}, cutting cycle time by 20%.`,
      ),
      clampBulletLength(
        `Partnered with ${company} stakeholders on ${projectHint} to advance ${shortResp} with ${skillA}, improving accuracy by 15%.`,
      ),
    ]

    for (const bullet of candidates) {
      if (entry.bullets.length >= 2) break
      if (!bullet || isDuplicateBullet(bullet, [...allExisting, ...entry.bullets])) continue
      entry.bullets.push(bullet)
      allExisting.push(bullet)
    }
  })

  next.experienceAdditions = next.experienceAdditions.filter((e) => e.company && e.bullets?.length)
  next.skillsToAdd = [...new Set(next.skillsByCategory.flatMap((e) => e.skills || []))]
  return next
}

export function buildMatchAnalysis(beforeComparison, afterComparison, applied, processingMeta = null) {
  const expAdded = Object.values(applied.experience || {}).reduce((n, e) => n + (e.added?.length || 0), 0)
  const expRewritten = Object.values(applied.experience || {}).reduce((n, e) => n + (e.rewritten?.length || 0), 0)

  const normKey = (s) => String(s || '').toLowerCase().replace(/[^\w+#./-]+/g, ' ').replace(/\s+/g, ' ').trim()

  // "Added keywords" must not repeat newly added skills (same term in both sections)
  const addedSkillKeys = new Set(
    (applied.skills || [])
      .map((s) => normKey(s.skill || s))
      .filter(Boolean),
  )

  const keywordListFrom = (comparison) => {
    if (comparison?.matchedKeywords?.length) return comparison.matchedKeywords
    if (comparison?.report?.matchedKeywords?.length) return comparison.report.matchedKeywords
    const details = comparison?.scoreBreakdown?.details?.keywords || []
    return details.filter((d) => d.matched).map((d) => d.item)
  }

  const beforeKw = new Set(keywordListFrom(beforeComparison).map(normKey).filter(Boolean))
  const seen = new Set()
  const addedKeywords = []
  for (const k of keywordListFrom(afterComparison)) {
    const key = normKey(k)
    if (!key || beforeKw.has(key) || addedSkillKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    addedKeywords.push(k)
  }

  const addedBullets = [
    ...(applied.summary?.added || []).map((text) => ({ section: 'Summary', text })),
    ...(applied.summary?.rewritten || []).map((r) => ({ section: 'Summary', text: r.text, rewritten: true })),
    ...Object.entries(applied.experience || {}).flatMap(([company, data]) => [
      ...(data.added || []).map((text) => ({ section: company, text })),
      ...(data.rewritten || []).map((r) => ({ section: company, text: r.text, rewritten: true })),
    ]),
  ]

  function compactPillar(raw, key) {
    const p = raw?.[key] || {}
    return {
      matched: p.matched ?? 0,
      total: p.total ?? 0,
      pct: p.pct ?? 0,
      score: p.score ?? 0,
      max: p.max,
      coveragePct: p.coveragePct ?? p.pct ?? 0,
      label: p.label,
    }
  }

  function compactBreakdown(comparison) {
    const raw = comparison?.scoreBreakdown
    if (!raw) {
      const matched = (comparison?.present || []).length
      const missing = (comparison?.missing || []).length
      const total = matched + missing
      const pct = total ? Math.round((matched / total) * 100) : 0
      return {
        skills: { matched, total, pct, score: 0, max: 24 },
        keywords: { matched, total, pct, score: 0, max: 16 },
        bullets: { matched: 0, total: 0, pct: 0, score: 0, max: 40 },
        format: { matched: 0, total: 0, pct: 0, score: 0, max: 20 },
        weights: {
          keywordPillar: 40,
          experiencePillar: 40,
          formatPillar: 20,
          skills: 24,
          keywords: 16,
          experience: 40,
          format: 20,
        },
        details: { skills: [], keywords: [], bullets: [], format: [] },
      }
    }
    return {
      skills: compactPillar(raw, 'skills'),
      keywords: compactPillar(raw, 'keywords'),
      bullets: compactPillar(raw, 'bullets'),
      format: compactPillar(raw, 'format'),
      weights: raw.weights || {
        keywordPillar: 40,
        experiencePillar: 40,
        formatPillar: 20,
        skills: 24,
        keywords: 16,
        experience: 40,
        format: 20,
      },
      details: {
        skills: raw.details?.skills || [],
        keywords: raw.details?.keywords || [],
        bullets: raw.details?.bullets || [],
        format: raw.details?.format || [],
      },
    }
  }

  const beforeBreakdown = compactBreakdown(beforeComparison)
  const afterBreakdown = compactBreakdown(afterComparison)

  const pillarPairs = [
    ['requiredSkills', 'skills', 24],
    ['keywords', 'keywords', 16],
    ['experience', 'bullets', 40],
    ['format', 'format', 20],
  ]
  const breakdown = {}
  for (const [reportKey, uiKey, max] of pillarPairs) {
    const before = beforeComparison.report?.categories?.[reportKey]?.score
      ?? beforeBreakdown[uiKey]?.score
      ?? 0
    const after = afterComparison.report?.categories?.[reportKey]?.score
      ?? afterBreakdown[uiKey]?.score
      ?? 0
    breakdown[reportKey] = {
      before: Math.round(before * 10) / 10,
      after: Math.round(after * 10) / 10,
      max,
      change: Math.round((after - before) * 10) / 10,
    }
  }

  const scoreComparison = {
    beforeScore: beforeComparison.atsScore,
    afterScore: afterComparison.atsScore,
    improvement: afterComparison.atsScore - beforeComparison.atsScore,
    breakdown,
  }

  return {
    beforeScore: beforeComparison.atsScore,
    afterScore: afterComparison.atsScore,
    scoreDelta: afterComparison.atsScore - beforeComparison.atsScore,
    beforeBreakdown,
    afterBreakdown,
    scoreComparison,
    scoreReport: {
      ...scoreComparison,
      beforeReport: beforeComparison.report || null,
      afterReport: afterComparison.report || null,
      penalties: afterComparison.penalties || [],
      processingMeta: processingMeta || null,
    },
    processingMeta: processingMeta || null,
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
    atsMarks: afterComparison.atsMarks || processingMeta?.atsMarks || null,
    llmScoring: processingMeta?.llmScoring || null,
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
  const summaryFormat = detectSummaryFormat(xml)

  for (const rewrite of plan.bulletRewrites || []) {
    if (!rewrite.original || !rewrite.replacement) continue

    let rangeStart = 0
    let rangeEnd = xml.length
    let section = 'experience'
    let companyKey = rewrite.company || 'Unknown'

    if (isSummaryRewrite(rewrite)) {
      // Paragraph summaries are enhanced later via weave — avoid double rewrite / bullet conversion
      if (summaryFormat === 'paragraph') continue
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
    // Yellow = rewrite of an existing bullet; green is only for brand-new inserts
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

      const template = resolveBulletTemplate(xml, bulletEnds, insertAt)
      if (!template) continue
      const companyApplied = ensureExperienceEntry(applied, expEntry.company)
      xml = insertBulletsAt(xml, insertAt, bullets, template, mark, companyApplied.added)
    }
  }

  const summaryStart = findSectionStart(xml, SECTION_ANCHORS.summary)
  if (summaryStart !== -1 && plan.summaryBullets?.length) {
    const summaryEnd = findNextSectionStart(xml, summaryStart)
    const summaryFormat = detectSummaryFormatInRange(xml, summaryStart, summaryEnd)

    if (summaryFormat === 'paragraph') {
      // Original is prose — weave additions into the paragraph (never insert bullets)
      xml = enhanceParagraphSummary(xml, summaryStart, summaryEnd, plan, mark, applied)
    } else {
      const { insertAt, bulletEnds } = resolveSummaryInsertPoint(xml, summaryStart, summaryEnd)
      if (insertAt) {
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
  }

  // Skills: append ONLY into existing category lines (Tools & Platforms:, etc.).
  // Never create a new Technical Skills heading / underlined dump block.
  // Cap inserts so table/column skill layouts cannot explode.
  const { entries: skillEntries } = redistributeSkillsToExistingCategories(plan, xml)
  const orderedSkillEntries = [...skillEntries].sort((a, b) => b.paraEnd - a.paraEnd)

  for (const entry of orderedSkillEntries) {
    if (!entry.skills?.length || !entry.paraEnd) continue

    const chunk = getParagraphChunk(xml, entry.paraEnd)
    if (!chunk || isSkillsSectionTitle(getPlainTextFromParagraph(chunk))) continue

    const existingText = getRawParagraphText(chunk).trimEnd()
    const hasTabLayout = entry.hasTabLayout
      || /<w:tabs\b/.test(chunk)
      || /<w:tab[\s/>]/.test(chunk)
    // Tab/hanging-column skills lines break easily — keep appends tiny
    const maxLineLen = entry.inTable ? 140 : (hasTabLayout ? 180 : 240)
    const maxAdd = entry.inTable ? 2 : (hasTabLayout ? 3 : 5)
    if (existingText.length > maxLineLen) continue

    const room = Math.max(0, maxLineLen - existingText.length - 2)
    const toAdd = []
    let used = 0
    for (const skill of entry.skills) {
      if (!isValidSkillName(skill)) continue
      const addLen = skill.length + 2
      if (used + addLen > room) break
      if (toAdd.length >= maxAdd) break
      toAdd.push(skill)
      used += addLen
    }
    if (!toAdd.length) continue

    // Never insert before the tab that separates category label from skills list
    const needsComma = existingText.length > 0 && !/[,;:\t]$/.test(existingText)
    const rPr = extractSkillsBodyRPr(xml, entry.paraEnd)
    const runs = toAdd.map((s, i) => buildSkillRun(s, rPr, mark, {
      leadingSeparator: i === 0 ? (needsComma ? ', ' : ' ') : ', ',
    })).join('')
    xml = xml.slice(0, entry.paraEnd - 6) + runs + xml.slice(entry.paraEnd - 6)

    for (const skill of toAdd) {
      applied.skills.push({ skill, category: entry.category })
    }
  }

  // Kill blank half/full pages caused by keepNext chains, page breaks, and huge spacing.
  // Indent/fonts stay intact — only pagination traps are removed.
  xml = sanitizeDocumentPagination(xml)

  if (!highlight) {
    xml = stripAllHighlights(xml)
  }

  zip.file('word/document.xml', xml)
  sanitizeAllStyleParts(zip)

  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    applied,
  }
}
