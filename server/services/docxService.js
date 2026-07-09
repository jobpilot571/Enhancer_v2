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

function getParagraphChunk(xml, paragraphEnd) {
  const start = xml.lastIndexOf('<w:p', paragraphEnd)
  if (start === -1) return ''
  return xml.slice(start, paragraphEnd)
}

function isBulletParagraph(chunk) {
  return /w:numPr/.test(chunk)
    || /w:ilvl/.test(chunk)
    || /<w:t[^>]*>[^<]*•/.test(chunk)
    || /<w:t[^>]*>[^<]*\u2022/.test(chunk)
}

function extractParagraphTemplate(xml, paragraphEnd) {
  const chunk = getParagraphChunk(xml, paragraphEnd)
  const pPrMatch = chunk.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  const runMatch = chunk.match(/<w:r>[\s\S]*?<\/w:r>/)
  let rPr = ''
  if (runMatch) {
    const rPrMatch = runMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    rPr = rPrMatch ? stripShading(rPrMatch[0]) : ''
  }
  const hasNumPr = /w:numPr/.test(pPr)
  return { pPr, rPr, hasNumPr }
}

function buildParagraph(text, template, { mark = null } = {}) {
  const safe = escapeXml(text)
  const rPr = applyMarkToRPr(template.rPr, mark)
  const prefix = template.hasNumPr ? '' : '• '
  return `<w:p>${template.pPr}<w:r>${rPr}<w:t xml:space="preserve">${prefix}${safe}</w:t></w:r></w:p>`
}

function rewriteParagraph(paraXml, replacement, mark) {
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  const runMatch = paraXml.match(/<w:r>[\s\S]*?<\/w:r>/)
  let rPr = ''
  if (runMatch) {
    const rPrMatch = runMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    rPr = rPrMatch ? stripShading(rPrMatch[0]) : ''
  }
  const hasNumPr = /w:numPr/.test(pPr)
  const rPrMarked = applyMarkToRPr(rPr, mark)
  const prefix = hasNumPr ? '' : '• '
  const safe = escapeXml(replacement)
  return `<w:p>${pPr}<w:r>${rPrMarked}<w:t xml:space="preserve">${prefix}${safe}</w:t></w:r></w:p>`
}

function buildSkillRun(skill, rPr, mark) {
  const safe = escapeXml(skill)
  const runRPr = applyMarkToRPr(rPr, mark)
  return `<w:r>${runRPr}<w:t xml:space="preserve">, ${safe}</w:t></w:r>`
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
  const paraStart = xml.lastIndexOf('<w:p', idx)
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
    const pStart = xml.indexOf('<w:p', pos)
    if (pStart === -1 || pStart >= end) break
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
  let bulletEnds = getSummaryParagraphEnds(xml, summaryStart, summaryEnd)
  if (bulletEnds.length < 2) {
    bulletEnds = getParagraphEndsInRange(xml, summaryStart, summaryEnd).filter((end) => {
      const plain = getPlainTextFromParagraph(getParagraphChunk(xml, end))
      return plain.length > 20
    })
  }
  let insertAt = getMiddleInsertionPoint(bulletEnds)
  if (!insertAt && bulletEnds.length >= 2) {
    insertAt = bulletEnds[Math.max(0, Math.floor(bulletEnds.length / 2) - 1)]
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
  const toInsert = []
  for (const bullet of bullets) {
    toInsert.push(buildParagraph(bullet, template, { mark }))
    appliedList.push(bullet)
  }
  return xml.slice(0, insertAt) + toInsert.join('') + xml.slice(insertAt)
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
  const catLower = category.toLowerCase().trim()
  const match = headings.find((h) => {
    const hl = h.toLowerCase().trim()
    return hl.includes(catLower) || catLower.includes(hl)
  })
  return match || category
}

function findParagraphContaining(xml, searchText, rangeStart, rangeEnd) {
  let pos = rangeStart
  while (pos < rangeEnd) {
    const pStart = xml.indexOf('<w:p', pos)
    if (pStart === -1 || pStart >= rangeEnd) break
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
  const lower = xml.toLowerCase()
  const variants = [
    category,
    `${category}:`,
    category.replace(/:$/, ''),
    category.split(':')[0],
    category.split('/')[0],
  ].filter(Boolean)

  let bestIdx = -1
  for (const variant of variants) {
    const catLower = variant.toLowerCase().trim()
    let searchFrom = 0
    while (true) {
      const idx = lower.indexOf(catLower, searchFrom)
      if (idx === -1) break
      const closeP = xml.indexOf('</w:p>', idx)
      if (closeP !== -1) bestIdx = closeP + 6
      searchFrom = idx + catLower.length
    }
  }

  if (bestIdx !== -1) return bestIdx

  const skillsStart = findSectionStart(xml, SECTION_ANCHORS.skills)
  if (skillsStart === -1) return -1
  const skillsEnd = findNextSectionStart(xml, skillsStart)
  const ends = getParagraphEndsInRange(xml, skillsStart, skillsEnd)
  return ends[ends.length - 1] || -1
}

function extractLastRunRPr(xml, paragraphEnd) {
  const chunk = getParagraphChunk(xml, paragraphEnd)
  const runs = [...chunk.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)]
  if (!runs.length) return ''
  const rPrMatch = runs[runs.length - 1][0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
  return rPrMatch ? stripShading(rPrMatch[0]) : ''
}

function compactDocumentSpacing(xml) {
  return xml
    .replace(/<w:spacing([^>]*?)w:after="(\d+)"/g, (m, attrs, val) => {
      const n = parseInt(val, 10)
      if (n > 100) return `<w:spacing${attrs}w:after="${Math.max(60, Math.round(n * 0.55))}"`
      return m
    })
    .replace(/<w:spacing([^>]*?)w:before="(\d+)"/g, (m, attrs, val) => {
      const n = parseInt(val, 10)
      if (n > 100) return `<w:spacing${attrs}w:before="${Math.max(40, Math.round(n * 0.55))}"`
      return m
    })
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

  let summaryBullets = (plan.summaryBullets || [])
    .filter((b) => b?.trim() && !isDuplicateBullet(b, allExistingBullets))
    .slice(0, 2)

  const summaryRewrites = (plan.bulletRewrites || []).filter(isSummaryRewrite)

  const experienceAdditions = (plan.experienceAdditions || [])
    .map((entry) => ({
      company: entry.company,
      bullets: (entry.bullets || [])
        .filter((b) => b?.trim() && !isDuplicateBullet(b, allExistingBullets))
        .slice(0, 2),
    }))
    .filter((entry) => entry.company && entry.bullets.length)

  const bulletRewrites = (plan.bulletRewrites || [])
    .filter((r) => r.original && r.replacement)
    .filter((r) => !isDuplicateBullet(r.replacement, allExistingBullets))

  const skillsByCategory = []
  const rawSkills = plan.skillsByCategory || []

  if (rawSkills.length) {
    for (const entry of rawSkills) {
      const skills = (entry.skills || []).filter((s) => !isDuplicateSkill(s) && isMissing(s))
      if (skills.length) {
        skillsByCategory.push({
          category: resolveCategory(entry.category, resumeData),
          skills,
        })
        skills.forEach((s) => existingSkills.add(s.toLowerCase().trim()))
      }
    }
  } else {
    const flat = (plan.skillsToAdd || []).filter((s) => !isDuplicateSkill(s) && isMissing(s))
    if (flat.length) {
      skillsByCategory.push({ category: 'Technical Skills', skills: flat })
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

export function buildMatchAnalysis(beforeComparison, afterComparison, applied) {
  const expAdded = Object.values(applied.experience).reduce((n, e) => n + e.added.length, 0)
  const expRewritten = Object.values(applied.experience).reduce((n, e) => n + e.rewritten.length, 0)

  return {
    beforeScore: beforeComparison.atsScore,
    afterScore: afterComparison.atsScore,
    scoreDelta: afterComparison.atsScore - beforeComparison.atsScore,
    keywordsMatched: afterComparison.present || [],
    keywordsStrong: afterComparison.strong || [],
    keywordsWeak: afterComparison.weak || [],
    keywordsStillMissing: afterComparison.missing || [],
    skillsAdded: applied.skills,
    summaryBulletsAdded: applied.summary.added.length,
    summaryRewrites: applied.summary.rewritten.length,
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

    const newPara = rewriteParagraph(found.para, rewrite.replacement, rewriteMark)
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

      const refEnd = bulletEnds[Math.max(0, Math.floor(bulletEnds.length / 2) - 1)] || bulletEnds[0]
      const template = extractParagraphTemplate(xml, refEnd)
      const companyApplied = ensureExperienceEntry(applied, expEntry.company)
      xml = insertBulletsAt(xml, insertAt, bullets, template, mark, companyApplied.added)
    }
  }

  const summaryStart = findSectionStart(xml, SECTION_ANCHORS.summary)
  if (summaryStart !== -1 && plan.summaryBullets?.length) {
    const summaryEnd = findNextSectionStart(xml, summaryStart)
    const { insertAt, bulletEnds } = resolveSummaryInsertPoint(xml, summaryStart, summaryEnd)

    if (insertAt && bulletEnds.length) {
      const refEnd = bulletEnds[Math.max(0, Math.floor(bulletEnds.length / 2) - 1)] || bulletEnds[0]
      const template = extractParagraphTemplate(xml, refEnd)
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

  for (const entry of plan.skillsByCategory || []) {
    if (!entry.skills?.length) continue
    const paraEnd = findCategoryParagraphEnd(xml, entry.category)
    if (paraEnd === -1) continue

    const rPr = extractLastRunRPr(xml, paraEnd)
    const runs = entry.skills.map((s) => buildSkillRun(s, rPr, mark)).join('')
    xml = xml.slice(0, paraEnd - 6) + runs + xml.slice(paraEnd - 6)

    for (const skill of entry.skills) {
      applied.skills.push({ skill, category: entry.category })
    }
  }

  const addedCount = applied.summary.added.length
    + Object.values(applied.experience).reduce((n, e) => n + e.added.length, 0)
  if (addedCount > 0) {
    xml = compactDocumentSpacing(xml)
  }

  if (!highlight) {
    xml = stripAllHighlights(xml)
  }

  zip.file('word/document.xml', xml)
  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    applied,
  }
}
