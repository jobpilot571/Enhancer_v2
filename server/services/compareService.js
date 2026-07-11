/**
 * Deterministic Resume-to-JD scoring (0–100).
 *
 * Categories:
 *   1. Required Skills Match ............ 30
 *   2. Experience & Responsibilities .... 25
 *   3. JD Keywords Match ................ 15
 *   4. Tools & Technologies ............. 10
 *   5. Structure & Readability .......... 10
 *   6. Professional Summary Match .......  5
 *   7. Resume Completeness ..............  5
 *
 * Same function for before and after. Score rises only when coverage improves.
 */

import {
  SKILL_ALIASES,
  RESPONSIBILITY_ALIASES,
  KNOWN_TOOLS,
  STOP_WORDS,
  JD_NOISE_PATTERNS,
} from './scoringDictionary.js'

const WEIGHTS = {
  requiredSkills: 30,
  experience: 25,
  keywords: 15,
  tools: 10,
  structure: 10,
  summary: 5,
  completeness: 5,
}

/** In-memory cache: same (requirement, evidence) → same match result */
const semanticCache = new Map()

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s+#./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonical(term) {
  const n = normalize(term)
  if (!n) return ''
  if (SKILL_ALIASES[n]) return SKILL_ALIASES[n]
  const compact = n.replace(/[\s.-]+/g, '')
  for (const [alias, canon] of Object.entries(SKILL_ALIASES)) {
    if (alias.replace(/[\s.-]+/g, '') === compact) return canon
  }
  return n
}

function uniqueNormalized(items) {
  const out = []
  const seen = new Set()
  for (const item of items || []) {
    const raw = String(item || '').trim()
    if (!raw) continue
    const key = canonical(raw) || normalize(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function countOccurrences(haystack, needle) {
  if (!needle || !haystack) return 0
  try {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(needle)}(?:[^a-z0-9]|$)`, 'gi')
    return (haystack.match(re) || []).length
  } catch {
    return haystack.includes(needle) ? 1 : 0
  }
}

function tokens(text) {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

function tokenOverlap(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap += 1
  return overlap / ta.size
}

function cacheKey(a, b) {
  return `${canonical(a)}||${normalize(b).slice(0, 240)}`
}

/* ---------- Resume text collectors ---------- */

function collectResumeSkills(resumeData) {
  return uniqueNormalized([
    ...(resumeData.skills || []),
    ...(resumeData.technicalSkills || []),
  ])
}

function collectResumeSkillSet(resumeData) {
  return new Set(collectResumeSkills(resumeData).map(canonical))
}

function collectExperienceBullets(resumeData) {
  const out = []
  for (const exp of resumeData.experience || []) {
    for (const b of exp.bullets || []) {
      if (b?.trim()) {
        out.push({
          text: b.trim(),
          section: 'Experience',
          company: exp.company || '',
          role: exp.title || exp.role || '',
        })
      }
    }
  }
  for (const p of resumeData.projects || []) {
    const text = typeof p === 'string' ? p : (p?.description || p?.name || '')
    if (text?.trim()) {
      out.push({
        text: text.trim(),
        section: 'Projects',
        company: typeof p === 'object' ? (p.name || '') : '',
        role: '',
      })
    }
  }
  return out
}

function collectSummaryText(resumeData) {
  const parts = [
    resumeData.summary || '',
    ...(resumeData.summaryBullets || []),
  ]
  return parts.filter(Boolean).join(' ')
}

function resumeFullText(resumeData) {
  return normalize(JSON.stringify(resumeData || {}))
}

function findEvidence(term, resumeData) {
  const canon = canonical(term)
  const aliases = [canon, normalize(term)].filter(Boolean)
  for (const [alias, c] of Object.entries(SKILL_ALIASES)) {
    if (c === canon) aliases.push(alias)
  }
  const uniqAliases = [...new Set(aliases)]

  const skillList = collectResumeSkills(resumeData)
  for (const s of skillList) {
    const cs = canonical(s)
    if (uniqAliases.some((a) => cs === a || cs.includes(a) || a.includes(cs))) {
      return {
        resumeEvidence: s,
        section: 'Technical Skills',
        company: '',
        matchType: cs === canon ? 'normalized' : 'exact',
        location: 'skills',
      }
    }
  }

  const bullets = collectExperienceBullets(resumeData)
  for (const b of bullets) {
    const bt = normalize(b.text)
    for (const a of uniqAliases) {
      if (a.length >= 2 && (bt.includes(a) || countOccurrences(bt, a) > 0)) {
        return {
          resumeEvidence: b.text,
          section: b.section,
          company: b.company,
          matchType: a === normalize(term) ? 'exact' : 'normalized',
          location: 'experience',
        }
      }
    }
    // semantic via responsibility aliases / token overlap
    const sem = semanticMatch(term, b.text)
    if (sem.score >= 0.55) {
      return {
        resumeEvidence: b.text,
        section: b.section,
        company: b.company,
        matchType: 'semantic',
        location: 'experience',
        semanticScore: sem.score,
      }
    }
  }

  const summary = collectSummaryText(resumeData)
  const sn = normalize(summary)
  if (sn) {
    for (const a of uniqAliases) {
      if (a.length >= 2 && sn.includes(a)) {
        return {
          resumeEvidence: summary.slice(0, 220),
          section: 'Summary',
          company: '',
          matchType: a === normalize(term) ? 'exact' : 'normalized',
          location: 'summary',
        }
      }
    }
  }

  return null
}

function semanticMatch(requirement, evidence) {
  const key = cacheKey(requirement, evidence)
  if (semanticCache.has(key)) return semanticCache.get(key)

  const reqN = normalize(requirement)
  const evN = normalize(evidence)
  let score = tokenOverlap(reqN, evN)

  for (const group of RESPONSIBILITY_ALIASES) {
    const reqHit = group.concepts.some((c) => reqN.includes(c) || tokenOverlap(reqN, c) >= 0.5)
    if (!reqHit) continue
    const evHit = group.evidence.some((e) => evN.includes(e))
    if (evHit) score = Math.max(score, 0.85)
    else score = Math.max(score, tokenOverlap(reqN, group.evidence.join(' ')) * 0.7)
  }

  // Canonical skill presence in evidence
  const reqCanon = canonical(requirement)
  if (reqCanon && (evN.includes(reqCanon) || countOccurrences(evN, reqCanon) > 0)) {
    score = Math.max(score, 0.9)
  }

  const result = { score: round1(score) }
  semanticCache.set(key, result)
  return result
}

/* ---------- JD extractors ---------- */

function isShortSkill(s) {
  const t = (s || '').trim()
  if (!t || t.length > 48) return false
  if (t.split(/\s+/).length > 6) return false
  if (/[.!?]/.test(t)) return false
  return true
}

function extractRequiredSkills(jdData) {
  return uniqueNormalized(jdData.requiredSkills || []).filter(isShortSkill)
}

function extractPreferredSkills(jdData) {
  return uniqueNormalized(jdData.preferredSkills || []).filter(isShortSkill)
}

function extractTools(jdData) {
  const fromJd = uniqueNormalized(jdData.toolsTechnologies || []).filter(isShortSkill)
  const fromSkills = uniqueNormalized([
    ...(jdData.requiredSkills || []),
    ...(jdData.preferredSkills || []),
  ]).filter((s) => KNOWN_TOOLS.has(canonical(s)))

  const preferredSet = new Set(extractPreferredSkills(jdData).map(canonical))
  const requiredSet = new Set(extractRequiredSkills(jdData).map(canonical))

  const tools = uniqueNormalized([...fromJd, ...fromSkills])
  return tools.map((t) => {
    const c = canonical(t)
    let tier = 'optional'
    if (requiredSet.has(c) || fromJd.some((x) => canonical(x) === c && requiredSet.has(c))) {
      tier = 'required'
    } else if (preferredSet.has(c)) {
      tier = 'preferred'
    } else if (fromJd.some((x) => canonical(x) === c)) {
      tier = 'required'
    }
    return { term: t, canonical: c, weight: tier === 'required' ? 3 : tier === 'preferred' ? 2 : 1, tier }
  })
}

function extractResponsibilities(jdData) {
  const raw = uniqueNormalized(jdData.responsibilities || [])
  const preferredHints = new Set(
    extractPreferredSkills(jdData).map(canonical),
  )
  return raw.map((r) => {
    const n = normalize(r)
    const isPreferred = [...preferredHints].some((p) => p && n.includes(p))
    return {
      text: r,
      weight: isPreferred ? 1 : 2,
      required: !isPreferred,
    }
  })
}

function extractKeywords(jdData) {
  let blob = [
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.domainKeywords || []),
    ...(jdData.niceToHaveKeywords || []),
    ...(jdData.responsibilities || []).flatMap((r) => normalize(r).split(' ').filter((w) => w.length > 4)),
  ].join(' ')

  for (const pat of JD_NOISE_PATTERNS) blob = blob.replace(pat, ' ')

  const must = new Set((jdData.mustHaveKeywords || []).map(canonical))
  const domain = new Set((jdData.domainKeywords || []).map(canonical))
  const nice = new Set((jdData.niceToHaveKeywords || []).map(canonical))

  const candidates = uniqueNormalized([
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.domainKeywords || []),
    ...(jdData.niceToHaveKeywords || []),
  ]).filter((k) => {
    const n = normalize(k)
    if (!n || n.length < 3) return false
    if (STOP_WORDS.has(n)) return false
    if (n.split(' ').every((w) => STOP_WORDS.has(w))) return false
    return true
  })

  return candidates.map((k) => {
    const c = canonical(k)
    let weight = 1
    let tier = 'optional'
    if (must.has(c)) {
      weight = 3
      tier = 'critical'
    } else if (domain.has(c)) {
      weight = 2
      tier = 'important'
    } else if (nice.has(c)) {
      weight = 1
      tier = 'optional'
    }
    return { term: k, canonical: c, weight, tier }
  })
}

/* ---------- Category scorers ---------- */

function scoreRequiredSkills(resumeData, jdData) {
  const required = extractRequiredSkills(jdData)
  const maxPts = WEIGHTS.requiredSkills
  const evidence = []
  const matched = []
  const partial = []
  const missing = []

  if (!required.length) {
    return {
      score: maxPts,
      matched: 0,
      total: 0,
      pct: 100,
      details: [],
      matchedItems: [],
      partialItems: [],
      missingItems: [],
      evidence,
    }
  }

  let earnedWeight = 0
  const totalWeight = required.length // equal weight per required skill

  for (const skill of required) {
    const ev = findEvidence(skill, resumeData)
    let credit = 0
    let matchType = 'none'

    if (ev?.location === 'skills' || (ev?.location === 'experience' && ev.matchType !== 'semantic')) {
      credit = 1.0
      matchType = ev.matchType
    } else if (ev?.location === 'experience' && ev.matchType === 'semantic') {
      credit = 0.75
      matchType = 'semantic'
    } else if (ev?.location === 'summary') {
      credit = 0.4
      matchType = ev.matchType
    }

    const points = round1((credit / totalWeight) * maxPts)
    const row = {
      item: skill,
      matched: credit > 0,
      strong: credit >= 1,
      credit,
      coverage: Math.round(credit * 100),
    }

    if (credit >= 1) {
      matched.push(skill)
    } else if (credit > 0) {
      partial.push(skill)
    } else {
      missing.push(skill)
    }

    if (ev && credit > 0) {
      evidence.push({
        requirement: skill,
        resumeEvidence: ev.resumeEvidence,
        section: ev.section,
        company: ev.company || '',
        matchType,
        weight: 1,
        pointsAwarded: points,
        credit,
      })
    }

    earnedWeight += credit
  }

  const score = round1((earnedWeight / totalWeight) * maxPts)
  return {
    score,
    matched: matched.length,
    total: required.length,
    pct: Math.round((earnedWeight / totalWeight) * 100),
    details: [
      ...matched.map((s) => ({ item: s, matched: true, strong: true })),
      ...partial.map((s) => ({ item: s, matched: true, strong: false })),
      ...missing.map((s) => ({ item: s, matched: false, strong: false })),
    ],
    matchedItems: matched,
    partialItems: partial,
    missingItems: missing,
    evidence,
  }
}

function scoreExperience(resumeData, jdData) {
  const responsibilities = extractResponsibilities(jdData)
  const maxPts = WEIGHTS.experience
  const bullets = collectExperienceBullets(resumeData)
  const evidence = []
  const covered = []
  const partial = []
  const missing = []
  const details = []

  if (!responsibilities.length) {
    return {
      score: maxPts,
      matched: 0,
      total: 0,
      pct: 100,
      coveragePct: 100,
      details: [],
      coveredItems: [],
      partialItems: [],
      missingItems: [],
      evidence,
    }
  }

  const totalWeight = responsibilities.reduce((s, r) => s + r.weight, 0)
  let earned = 0

  for (const resp of responsibilities) {
    let best = 0
    let bestBullet = null

    for (const b of bullets) {
      // Must be demonstrated in experience/project — not skills section alone
      const sem = semanticMatch(resp.text, b.text)
      const overlap = tokenOverlap(resp.text, b.text)
      const score = Math.max(sem.score, overlap)
      if (score > best) {
        best = score
        bestBullet = b
      }
    }

    let coverage = 0
    if (best >= 0.55) coverage = 1.0
    else if (best >= 0.3) coverage = 0.5
    else coverage = 0

    earned += coverage * resp.weight
    const points = round1(((coverage * resp.weight) / totalWeight) * maxPts)

    details.push({
      item: resp.text,
      matched: coverage > 0,
      coverage: Math.round(coverage * 100),
      strong: coverage >= 1,
    })

    if (coverage >= 1) covered.push(resp.text)
    else if (coverage > 0) partial.push(resp.text)
    else missing.push(resp.text)

    if (bestBullet && coverage > 0) {
      evidence.push({
        requirement: resp.text,
        resumeEvidence: bestBullet.text,
        section: bestBullet.section,
        company: bestBullet.company || '',
        matchType: best >= 0.7 ? 'semantic' : 'normalized',
        weight: resp.weight,
        pointsAwarded: points,
        credit: coverage,
      })
    }
  }

  const ratio = earned / totalWeight
  return {
    score: round1(ratio * maxPts),
    matched: covered.length + partial.length,
    total: responsibilities.length,
    pct: Math.round(ratio * 100),
    coveragePct: Math.round(ratio * 100),
    details,
    coveredItems: covered,
    partialItems: partial,
    missingItems: missing,
    evidence,
  }
}

function scoreKeywords(resumeData, jdData) {
  const keywords = extractKeywords(jdData)
  const maxPts = WEIGHTS.keywords
  const text = resumeFullText(resumeData)
  const evidence = []
  const matched = []
  const missing = []
  const details = []
  const penalties = []

  if (!keywords.length) {
    return {
      score: maxPts,
      matched: 0,
      total: 0,
      pct: 100,
      details: [],
      matchedItems: [],
      missingItems: [],
      evidence,
      penalties,
    }
  }

  const totalWeight = keywords.reduce((s, k) => s + k.weight, 0)
  let earned = 0
  const seenConcepts = new Set()

  for (const kw of keywords) {
    if (seenConcepts.has(kw.canonical)) continue
    seenConcepts.add(kw.canonical)

    const count = Math.max(
      countOccurrences(text, kw.canonical),
      countOccurrences(text, normalize(kw.term)),
    )
    const hit = count > 0
    let credit = hit ? 1 : 0

    // Keyword-stuffing penalty: same important keyword repeated unnaturally
    if (hit && kw.weight >= 2 && count >= 6) {
      credit = 0.7
      penalties.push({
        type: 'keyword_stuffing',
        item: kw.term,
        detail: `"${kw.term}" repeated ${count} times`,
        amount: round1(((0.3 * kw.weight) / totalWeight) * maxPts),
      })
    }

    earned += credit * kw.weight
    const points = round1(((credit * kw.weight) / totalWeight) * maxPts)

    details.push({
      item: kw.term,
      matched: hit,
      strong: hit && count >= 2 && credit >= 1,
      count,
    })

    if (hit) {
      matched.push(kw.term)
      const ev = findEvidence(kw.term, resumeData)
      evidence.push({
        requirement: kw.term,
        resumeEvidence: ev?.resumeEvidence || `(found ${count}× in resume text)`,
        section: ev?.section || 'Resume',
        company: ev?.company || '',
        matchType: ev?.matchType || 'exact',
        weight: kw.weight,
        pointsAwarded: points,
        credit,
      })
    } else {
      missing.push(kw.term)
    }
  }

  const conceptWeight = [...seenConcepts].reduce((sum, c) => {
    const kw = keywords.find((k) => k.canonical === c)
    return sum + (kw?.weight || 1)
  }, 0) || totalWeight

  const ratio = earned / conceptWeight
  return {
    score: round1(ratio * maxPts),
    matched: matched.length,
    total: seenConcepts.size,
    pct: Math.round(ratio * 100),
    details,
    matchedItems: matched,
    missingItems: missing,
    evidence,
    penalties,
  }
}

function scoreTools(resumeData, jdData, options = {}) {
  const tools = extractTools(jdData)
  const maxPts = WEIGHTS.tools
  const evidence = []
  const matched = []
  const missing = []
  const details = []
  const penalties = []

  // Unsupported tools added during enhancement
  const appliedSkills = (options.applied?.skills || []).map((s) => canonical(s.skill || s))
  const jdToolSet = new Set(tools.map((t) => t.canonical))
  for (const added of appliedSkills) {
    if (!added) continue
    if (KNOWN_TOOLS.has(added) && !jdToolSet.has(added)) {
      penalties.push({
        type: 'unsupported_tool',
        item: added,
        detail: `Tool "${added}" added during enhancement but not required by JD`,
        amount: 1,
      })
    }
  }

  if (!tools.length) {
    return {
      score: maxPts,
      matched: 0,
      total: 0,
      pct: 100,
      details: [],
      matchedItems: [],
      missingItems: [],
      evidence,
      penalties,
    }
  }

  const totalWeight = tools.reduce((s, t) => s + t.weight, 0)
  let earned = 0
  const seen = new Set()

  for (const tool of tools) {
    if (seen.has(tool.canonical)) continue
    seen.add(tool.canonical)

    const ev = findEvidence(tool.term, resumeData)
    // Do not award for unsupported enhancement-only tools (already not in JD list)
    const hit = Boolean(ev)
    const credit = hit ? 1 : 0
    earned += credit * tool.weight
    const points = round1(((credit * tool.weight) / totalWeight) * maxPts)

    details.push({
      item: tool.term,
      matched: hit,
      strong: hit && (ev.location === 'skills' || ev.location === 'experience'),
    })

    if (hit) {
      matched.push(tool.term)
      evidence.push({
        requirement: tool.term,
        resumeEvidence: ev.resumeEvidence,
        section: ev.section,
        company: ev.company || '',
        matchType: ev.matchType,
        weight: tool.weight,
        pointsAwarded: points,
        credit,
      })
    } else {
      missing.push(tool.term)
    }
  }

  const ratio = earned / totalWeight
  return {
    score: round1(ratio * maxPts),
    matched: matched.length,
    total: seen.size,
    pct: Math.round(ratio * 100),
    details,
    matchedItems: matched,
    missingItems: missing,
    evidence,
    penalties,
  }
}

function scoreStructure(resumeData) {
  const maxPts = WEIGHTS.structure
  const checks = []
  let points = 0

  const hasContact = Boolean(
    resumeData.email || resumeData.phone || resumeData.location || resumeData.linkedin,
  )
  checks.push({ id: 'contact', ok: hasContact, pts: 1, label: 'Contact information present' })

  const hasSummary = Boolean(
    (resumeData.summary || '').trim() || (resumeData.summaryBullets || []).length,
  )
  checks.push({ id: 'summary', ok: hasSummary, pts: 1, label: 'Professional Summary present' })

  const hasSkills = collectResumeSkills(resumeData).length > 0
  checks.push({ id: 'skills', ok: hasSkills, pts: 1, label: 'Skills section present' })

  const exps = resumeData.experience || []
  const hasExperience = exps.length > 0
  checks.push({ id: 'experience', ok: hasExperience, pts: 1, label: 'Experience section present' })

  const hasEducation = (resumeData.education || []).length > 0
    || Boolean(resumeData.degree || resumeData.university)
  checks.push({ id: 'education', ok: hasEducation, pts: 1, label: 'Education section present' })

  const hasCompanies = exps.some((e) => (e.company || '').trim())
  checks.push({ id: 'companies', ok: hasCompanies, pts: 0.8, label: 'Company names present' })

  const hasRoles = exps.some((e) => (e.title || e.role || '').trim())
  checks.push({ id: 'roles', ok: hasRoles, pts: 0.8, label: 'Roles present' })

  const hasDates = exps.some((e) => (e.startDate || e.endDate || e.dates || '').toString().trim())
  checks.push({ id: 'dates', ok: hasDates, pts: 0.8, label: 'Dates present' })

  const bullets = collectExperienceBullets(resumeData)
  const hasBullets = bullets.length >= 2
  checks.push({ id: 'bullets', ok: hasBullets, pts: 0.8, label: 'Bullet formatting present' })

  const longParas = bullets.filter((b) => b.text.length > 350).length
  const readable = longParas <= Math.max(1, Math.floor(bullets.length * 0.25))
  checks.push({ id: 'readable', ok: readable, pts: 0.8, label: 'No excessively long paragraphs' })

  // Duplicate content check
  const norms = bullets.map((b) => normalize(b.text))
  const dupes = norms.filter((n, i) => n && norms.indexOf(n) !== i).length
  const noDupes = dupes === 0
  checks.push({ id: 'duplicates', ok: noDupes, pts: 0.5, label: 'No excessive duplicate content' })

  const parserOk = Boolean(resumeData.name || hasSkills || hasExperience)
  checks.push({ id: 'parser', ok: parserOk, pts: 0.5, label: 'Resume readable by parser' })

  for (const c of checks) {
    if (c.ok) points += c.pts
  }

  // Scale to maxPts (sum of pts ≈ 10)
  const rawMax = checks.reduce((s, c) => s + c.pts, 0)
  const score = round1((points / rawMax) * maxPts)

  return {
    score,
    matched: checks.filter((c) => c.ok).length,
    total: checks.length,
    pct: Math.round((points / rawMax) * 100),
    details: checks.map((c) => ({
      item: c.label,
      matched: c.ok,
      strong: c.ok,
    })),
    checks,
    evidence: checks.filter((c) => c.ok).map((c) => ({
      requirement: c.label,
      resumeEvidence: 'Present in parsed resume',
      section: 'Structure',
      company: '',
      matchType: 'exact',
      weight: c.pts,
      pointsAwarded: round1((c.pts / rawMax) * maxPts),
    })),
  }
}

function scoreSummary(resumeData, jdData) {
  const maxPts = WEIGHTS.summary
  const summary = collectSummaryText(resumeData)
  if (!summary.trim()) {
    return {
      score: 0,
      matched: 0,
      total: 5,
      pct: 0,
      details: [{ item: 'Professional summary missing', matched: false }],
      evidence: [],
    }
  }

  const sn = normalize(summary)
  const role = normalize(jdData.roleTitle || jdData.title || '')
  const required = extractRequiredSkills(jdData).slice(0, 8)
  const domain = (jdData.domainKeywords || []).slice(0, 6).map(normalize)

  let points = 0
  const details = []
  const evidence = []

  // Target role (not full score for title alone)
  const roleHit = role && (sn.includes(role) || tokenOverlap(sn, role) >= 0.5)
  if (roleHit) {
    points += 0.8
    details.push({ item: 'Target role reflected', matched: true, strong: true })
    evidence.push({
      requirement: 'Target role',
      resumeEvidence: summary.slice(0, 180),
      section: 'Summary',
      company: '',
      matchType: 'semantic',
      weight: 0.8,
      pointsAwarded: 0.8,
    })
  } else {
    details.push({ item: 'Target role reflected', matched: false })
  }

  // Years of experience
  const yearsHit = /\b(\d+)\+?\s*(\+|years?|yrs?)\b/i.test(summary)
  if (yearsHit) {
    points += 0.8
    details.push({ item: 'Years of experience stated', matched: true, strong: true })
  } else {
    details.push({ item: 'Years of experience stated', matched: false })
  }

  // Primary domain
  const domainHit = domain.some((d) => d && sn.includes(d))
    || tokenOverlap(sn, domain.join(' ')) >= 0.25
  if (domainHit) {
    points += 1
    details.push({ item: 'Primary domain reflected', matched: true, strong: true })
  } else {
    details.push({ item: 'Primary domain reflected', matched: false })
  }

  // Important required skills in summary
  let skillHits = 0
  for (const sk of required) {
    const c = canonical(sk)
    if (c && (sn.includes(c) || sn.includes(normalize(sk)))) skillHits += 1
  }
  const skillRatio = required.length ? skillHits / Math.min(required.length, 5) : 0
  const skillPts = round1(Math.min(1.6, skillRatio * 1.6))
  points += skillPts
  details.push({
    item: `Required skills in summary (${skillHits})`,
    matched: skillHits > 0,
    strong: skillHits >= 2,
  })

  // Business/technical value language
  const valueHit = /(deliver|improv|optimiz|reduc|increas|driv|enabl|streamlin|automat|stakeholder|outcome|impact)/i.test(summary)
  if (valueHit) {
    points += 0.8
    details.push({ item: 'Business/technical value stated', matched: true, strong: true })
  } else {
    details.push({ item: 'Business/technical value stated', matched: false })
  }

  const score = round1(clamp(points, 0, maxPts))
  return {
    score,
    matched: details.filter((d) => d.matched).length,
    total: details.length,
    pct: Math.round((score / maxPts) * 100),
    details,
    evidence,
  }
}

function scoreCompleteness(resumeData) {
  const maxPts = WEIGHTS.completeness
  const items = [
    {
      id: 'contact',
      ok: Boolean(resumeData.email || resumeData.phone || resumeData.location),
      label: 'Contact information',
    },
    {
      id: 'summary',
      ok: Boolean((resumeData.summary || '').trim() || (resumeData.summaryBullets || []).length),
      label: 'Summary',
    },
    {
      id: 'skills',
      ok: collectResumeSkills(resumeData).length > 0,
      label: 'Skills',
    },
    {
      id: 'experience',
      ok: (resumeData.experience || []).length > 0,
      label: 'Experience',
    },
    {
      id: 'education',
      ok: (resumeData.education || []).length > 0 || Boolean(resumeData.degree),
      label: 'Education',
    },
  ]

  const score = items.filter((i) => i.ok).length // 1 pt each, max 5
  return {
    score,
    matched: score,
    total: 5,
    pct: Math.round((score / maxPts) * 100),
    details: items.map((i) => ({ item: i.label, matched: i.ok, strong: i.ok })),
    evidence: items.filter((i) => i.ok).map((i) => ({
      requirement: i.label,
      resumeEvidence: 'Present',
      section: 'Completeness',
      company: '',
      matchType: 'exact',
      weight: 1,
      pointsAwarded: 1,
    })),
  }
}

function detectPenalties(resumeData, categoryPenalties = []) {
  const penalties = [...categoryPenalties]
  const skills = collectResumeSkills(resumeData).map(canonical)
  const skillCounts = {}
  for (const s of skills) {
    skillCounts[s] = (skillCounts[s] || 0) + 1
  }
  for (const [s, n] of Object.entries(skillCounts)) {
    if (n >= 3) {
      penalties.push({
        type: 'duplicate_skills',
        item: s,
        detail: `Skill "${s}" listed ${n} times`,
        amount: Math.min(2, n - 2),
      })
    }
  }

  const bullets = collectExperienceBullets(resumeData).map((b) => normalize(b.text))
  const seen = new Set()
  let dupBullets = 0
  for (const b of bullets) {
    if (!b) continue
    if (seen.has(b)) dupBullets += 1
    else seen.add(b)
  }
  if (dupBullets > 0) {
    penalties.push({
      type: 'duplicate_bullets',
      item: 'experience',
      detail: `${dupBullets} duplicate experience bullet(s)`,
      amount: Math.min(3, dupBullets),
    })
  }

  const long = collectExperienceBullets(resumeData).filter((b) => b.text.length > 400)
  if (long.length >= 3) {
    penalties.push({
      type: 'long_bullets',
      item: 'readability',
      detail: `${long.length} excessively long bullets`,
      amount: 1,
    })
  }

  return penalties
}

/**
 * Main scoring entry — identical formula for before and after.
 * @param {object} resumeData
 * @param {object} jdData
 * @param {{ applied?: object }} [options]
 */
export function compareResumeToJD(resumeData, jdData, options = {}) {
  const requiredSkills = scoreRequiredSkills(resumeData, jdData)
  const experience = scoreExperience(resumeData, jdData)
  const keywords = scoreKeywords(resumeData, jdData)
  const tools = scoreTools(resumeData, jdData, options)
  const structure = scoreStructure(resumeData)
  const summary = scoreSummary(resumeData, jdData)
  const completeness = scoreCompleteness(resumeData)

  const categoryPenalties = [
    ...(keywords.penalties || []),
    ...(tools.penalties || []),
  ]
  const penalties = detectPenalties(resumeData, categoryPenalties)
  const penaltyTotal = round1(penalties.reduce((s, p) => s + (p.amount || 0), 0))

  const rawTotal = round1(
    requiredSkills.score
    + experience.score
    + keywords.score
    + tools.score
    + structure.score
    + summary.score
    + completeness.score,
  )

  const atsScore = clamp(Math.round(rawTotal - penaltyTotal), 0, 100)

  // Legacy-compatible present/missing for enhancement plan
  const present = uniqueNormalized([
    ...requiredSkills.matchedItems,
    ...requiredSkills.partialItems,
    ...tools.matchedItems,
    ...keywords.matchedItems,
  ])
  const missing = uniqueNormalized([
    ...requiredSkills.missingItems,
    ...tools.missingItems,
    ...keywords.missingItems,
  ])
  const strong = uniqueNormalized([
    ...requiredSkills.matchedItems,
    ...tools.matchedItems.filter((_, i) => tools.details[i]?.strong),
  ])
  const weak = uniqueNormalized(requiredSkills.partialItems)

  const categories = {
    requiredSkills: {
      before: requiredSkills.score,
      score: requiredSkills.score,
      max: WEIGHTS.requiredSkills,
      ...pickPillar(requiredSkills),
    },
    experience: {
      score: experience.score,
      max: WEIGHTS.experience,
      ...pickPillar(experience),
    },
    keywords: {
      score: keywords.score,
      max: WEIGHTS.keywords,
      ...pickPillar(keywords),
    },
    tools: {
      score: tools.score,
      max: WEIGHTS.tools,
      ...pickPillar(tools),
    },
    structure: {
      score: structure.score,
      max: WEIGHTS.structure,
      ...pickPillar(structure),
    },
    summary: {
      score: summary.score,
      max: WEIGHTS.summary,
      ...pickPillar(summary),
    },
    completeness: {
      score: completeness.score,
      max: WEIGHTS.completeness,
      ...pickPillar(completeness),
    },
  }

  // UI cards still show Skills / Keywords / Bullets (mapped from new categories)
  const scoreBreakdown = {
    skills: {
      matched: requiredSkills.matched,
      total: requiredSkills.total,
      pct: requiredSkills.pct,
      score: requiredSkills.score,
      max: WEIGHTS.requiredSkills,
      label: 'Required Skills',
    },
    keywords: {
      matched: keywords.matched,
      total: keywords.total,
      pct: keywords.pct,
      score: keywords.score,
      max: WEIGHTS.keywords,
      label: 'JD Keywords',
    },
    bullets: {
      matched: experience.matched,
      total: experience.total,
      pct: experience.pct,
      coveragePct: experience.coveragePct,
      score: experience.score,
      max: WEIGHTS.experience,
      label: 'Experience',
    },
    tools: {
      matched: tools.matched,
      total: tools.total,
      pct: tools.pct,
      score: tools.score,
      max: WEIGHTS.tools,
      label: 'Tools',
    },
    structure: {
      matched: structure.matched,
      total: structure.total,
      pct: structure.pct,
      score: structure.score,
      max: WEIGHTS.structure,
      label: 'Structure',
    },
    summary: {
      matched: summary.matched,
      total: summary.total,
      pct: summary.pct,
      score: summary.score,
      max: WEIGHTS.summary,
      label: 'Summary',
    },
    completeness: {
      matched: completeness.matched,
      total: completeness.total,
      pct: completeness.pct,
      score: completeness.score,
      max: WEIGHTS.completeness,
      label: 'Completeness',
    },
    weights: { ...WEIGHTS },
    details: {
      skills: requiredSkills.details,
      keywords: keywords.details,
      bullets: experience.details,
      tools: tools.details,
      structure: structure.details,
      summary: summary.details,
      completeness: completeness.details,
    },
  }

  const report = {
    score: atsScore,
    rawTotal,
    penaltyTotal,
    categories: {
      requiredSkills: { score: requiredSkills.score, max: WEIGHTS.requiredSkills },
      experience: { score: experience.score, max: WEIGHTS.experience },
      keywords: { score: keywords.score, max: WEIGHTS.keywords },
      tools: { score: tools.score, max: WEIGHTS.tools },
      structure: { score: structure.score, max: WEIGHTS.structure },
      summary: { score: summary.score, max: WEIGHTS.summary },
      completeness: { score: completeness.score, max: WEIGHTS.completeness },
    },
    matchedRequiredSkills: requiredSkills.matchedItems,
    partiallyMatchedRequiredSkills: requiredSkills.partialItems,
    missingRequiredSkills: requiredSkills.missingItems,
    matchedTools: tools.matchedItems,
    missingTools: tools.missingItems,
    coveredResponsibilities: experience.coveredItems,
    partiallyCoveredResponsibilities: experience.partialItems,
    missingResponsibilities: experience.missingItems,
    matchedKeywords: keywords.matchedItems,
    missingKeywords: keywords.missingItems,
    evidence: [
      ...requiredSkills.evidence,
      ...experience.evidence,
      ...keywords.evidence,
      ...tools.evidence,
      ...structure.evidence,
      ...summary.evidence,
      ...completeness.evidence,
    ],
    penalties,
    scoringReasons: buildScoringReasons({
      requiredSkills,
      experience,
      keywords,
      tools,
      structure,
      summary,
      completeness,
      atsScore,
      penaltyTotal,
    }),
  }

  return {
    present,
    missing,
    strong,
    weak,
    missingMustHave: (jdData.mustHaveKeywords || []).filter(
      (k) => !present.some((p) => canonical(p) === canonical(k) || normalize(p).includes(normalize(k))),
    ),
    missingResponsibilities: experience.missingItems,
    atsScore,
    scoreBreakdown,
    categories,
    report,
    penalties,
  }
}

function pickPillar(p) {
  return {
    matched: p.matched,
    total: p.total,
    pct: p.pct,
  }
}

function buildScoringReasons(parts) {
  const reasons = []
  reasons.push(
    `Required skills: ${parts.requiredSkills.score}/${WEIGHTS.requiredSkills} `
    + `(${parts.requiredSkills.matchedItems.length} full, ${parts.requiredSkills.partialItems.length} partial, `
    + `${parts.requiredSkills.missingItems.length} missing)`,
  )
  reasons.push(
    `Experience coverage: ${parts.experience.score}/${WEIGHTS.experience} `
    + `(${parts.experience.coveredItems.length} full, ${parts.experience.partialItems.length} partial, `
    + `${parts.experience.missingItems.length} missing)`,
  )
  reasons.push(
    `Keywords: ${parts.keywords.score}/${WEIGHTS.keywords} `
    + `(${parts.keywords.matchedItems.length}/${parts.keywords.total} concepts)`,
  )
  reasons.push(
    `Tools: ${parts.tools.score}/${WEIGHTS.tools} `
    + `(${parts.tools.matchedItems.length} matched, ${parts.tools.missingItems.length} missing)`,
  )
  reasons.push(`Structure: ${parts.structure.score}/${WEIGHTS.structure}`)
  reasons.push(`Summary match: ${parts.summary.score}/${WEIGHTS.summary}`)
  reasons.push(`Completeness: ${parts.completeness.score}/${WEIGHTS.completeness}`)
  if (parts.penaltyTotal > 0) {
    reasons.push(`Penalties applied: −${parts.penaltyTotal}`)
  }
  reasons.push(`Final score: ${parts.atsScore}/100`)
  return reasons
}

/**
 * Build before/after explanation object for the score report.
 */
export function buildScoreComparison(beforeComparison, afterComparison) {
  const b = beforeComparison.report?.categories || {}
  const a = afterComparison.report?.categories || {}

  const keys = [
    'requiredSkills',
    'experience',
    'keywords',
    'tools',
    'structure',
    'summary',
    'completeness',
  ]

  const breakdown = {}
  for (const key of keys) {
    const before = b[key]?.score ?? beforeComparison.scoreBreakdown?.[key === 'requiredSkills' ? 'skills' : key === 'experience' ? 'bullets' : key]?.score ?? 0
    const after = a[key]?.score ?? afterComparison.scoreBreakdown?.[key === 'requiredSkills' ? 'skills' : key === 'experience' ? 'bullets' : key]?.score ?? 0
    const max = WEIGHTS[key]
    breakdown[key] = {
      before: round1(before),
      after: round1(after),
      max,
      change: round1(after - before),
    }
  }

  return {
    beforeScore: beforeComparison.atsScore,
    afterScore: afterComparison.atsScore,
    improvement: afterComparison.atsScore - beforeComparison.atsScore,
    breakdown,
    beforeReport: beforeComparison.report,
    afterReport: afterComparison.report,
  }
}

/**
 * Merge applied DOCX changes into resumeData so After score reflects real inserts.
 */
export function buildEnhancedResumeData(resumeData, applied) {
  const expBulletsByCompany = {}
  for (const [company, entry] of Object.entries(applied?.experience || {})) {
    expBulletsByCompany[normalize(company)] = [
      ...(entry.added || []),
      ...(entry.rewritten || []).map((r) => r.text).filter(Boolean),
    ]
  }

  const experience = (resumeData.experience || []).map((exp) => {
    const key = normalize(exp.company)
    const extras = expBulletsByCompany[key] || []
    if (!extras.length) return exp
    return {
      ...exp,
      bullets: [...(exp.bullets || []), ...extras],
    }
  })

  const matchedKeys = new Set(experience.map((e) => normalize(e.company)))
  const orphanBullets = []
  for (const [company, entry] of Object.entries(applied?.experience || {})) {
    if (matchedKeys.has(normalize(company))) continue
    orphanBullets.push(...(entry.added || []))
    orphanBullets.push(...(entry.rewritten || []).map((r) => r.text).filter(Boolean))
  }
  if (orphanBullets.length && experience.length) {
    experience[0] = {
      ...experience[0],
      bullets: [...(experience[0].bullets || []), ...orphanBullets],
    }
  }

  const rewrittenSummary = (applied?.summary?.rewritten || []).map((r) => r.text).filter(Boolean)

  return {
    ...resumeData,
    skills: [
      ...(resumeData.skills || []),
      ...(applied?.skills || []).map((s) => s.skill),
    ],
    technicalSkills: [
      ...(resumeData.technicalSkills || []),
      ...(applied?.skills || []).map((s) => s.skill),
    ],
    summaryBullets: [
      ...(resumeData.summaryBullets || []),
      ...(applied?.summary?.added || []),
      ...rewrittenSummary,
    ],
    experience,
  }
}
