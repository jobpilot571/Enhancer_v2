/**
 * Deterministic Resume-to-JD scoring (0–100) — ATS-style 40 / 40 / 20.
 *
 * Pillars:
 *   1. Keyword & Skills Match ........... 40  (Hard skills/tools 24 + Title/domain 16)
 *   2. Experience & Impact .............. 40
 *   3. Format & Readability ............. 20
 *
 * Skills and Keywords lists are disjoint — one concept never appears twice.
 * Same function for before and after. Score rises only when coverage improves.
 */

import {
  SKILL_ALIASES,
  RESPONSIBILITY_ALIASES,
  KNOWN_TOOLS,
  STOP_WORDS,
  SOFT_SKILLS,
  ACTION_VERBS,
  QUANTIFIER_RE,
  TITLE_FAMILIES,
  DOMAIN_KEYWORD_EVIDENCE,
} from './scoringDictionary.js'

const WEIGHTS = {
  skills: 24,
  keywords: 16,
  experience: 40,
  format: 20,
  keywordPillar: 40,
  experiencePillar: 40,
  formatPillar: 20,
  // Report aliases (PDF / buildScoreComparison)
  requiredSkills: 24,
  structure: 20, // format maps here for legacy key in some callers
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

function isSoftSkill(term) {
  const n = normalize(term)
  const c = canonical(term)
  if (!n) return false
  if (SOFT_SKILLS.has(n) || SOFT_SKILLS.has(c)) return true
  // Phrase patterns: "X skills", soft traits — not tools/hard methods
  if (KNOWN_TOOLS.has(c)) return false
  const softRoots = [
    'communication', 'analytical', 'critical thinking', 'problem.sol',
    'leadership', 'creativity', 'judgment', 'teamwork', 'collaborat',
    'interpersonal', 'organizational', 'self.motivat', 'work ethic',
  ]
  return softRoots.some((r) => new RegExp(r, 'i').test(n))
}

/**
 * True when a keyword is the same concept as a skill already shown/scored
 * (exact, alias, or multi-word overlap like "financial reporting" ⊂ skill).
 */
function keywordCoveredBySkills(term, skillCanons) {
  const c = canonical(term)
  if (!c) return false
  if (skillCanons.has(c)) return true

  const termTokens = c.split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  for (const skill of skillCanons) {
    if (!skill) continue
    if (skill === c) return true
    // Containment for longer phrases
    if (c.length >= 8 && skill.includes(c)) return true
    if (skill.length >= 8 && c.includes(skill)) return true
    const skillTokens = skill.split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    if (termTokens.length >= 2 && skillTokens.length >= 2) {
      const set = new Set(skillTokens)
      const shared = termTokens.filter((t) => set.has(t))
      if (shared.length >= 2) return true
    }
  }
  return false
}

function extractRequiredSkills(jdData) {
  // Hard skills only — soft traits are excluded so they don't clutter Skills
  // and then reappear under Keywords.
  return uniqueNormalized(jdData.requiredSkills || [])
    .filter(isShortSkill)
    .filter((s) => !isSoftSkill(s))
}

function extractPreferredSkills(jdData) {
  return uniqueNormalized(jdData.preferredSkills || [])
    .filter(isShortSkill)
    .filter((s) => !isSoftSkill(s))
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
  // Keywords = domain / industry phrases only.
  // Never repeat required skills, tools, soft traits, or near-duplicate skill phrases.
  // Preferred hard items (e.g. KPI, regulatory reporting) may appear here once.
  const ownedBySkillsOrTools = new Set([
    ...extractRequiredSkills(jdData).map(canonical),
    ...extractTools(jdData).map((t) => t.canonical),
  ].filter(Boolean))

  const must = new Set((jdData.mustHaveKeywords || []).map(canonical))
  const domain = new Set((jdData.domainKeywords || []).map(canonical))
  const nice = new Set((jdData.niceToHaveKeywords || []).map(canonical))

  const candidates = uniqueNormalized([
    ...(jdData.domainKeywords || []),
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.niceToHaveKeywords || []),
  ]).filter((k) => {
    const n = normalize(k)
    if (!n || n.length < 3) return false
    if (STOP_WORDS.has(n)) return false
    if (n.split(' ').every((w) => STOP_WORDS.has(w))) return false
    if (isSoftSkill(k)) return false
    const c = canonical(k)
    if (c && KNOWN_TOOLS.has(c)) return false
    if (keywordCoveredBySkills(k, ownedBySkillsOrTools)) return false
    return true
  })

  // Prefer shorter display labels when aliases collide (KPI over "key performance indicators")
  const byCanon = new Map()
  for (const k of candidates) {
    const c = canonical(k)
    const prev = byCanon.get(c)
    if (!prev || k.length < prev.length) byCanon.set(c, k)
  }

  return [...byCanon.entries()].map(([c, k]) => {
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

/* ---------- Partitioned term sets (never twice) ---------- */



/**

 * Hard skills + tools owned by the Skills tab (max 24 pts).

 * Soft traits excluded. Preferred tools included when listed on JD.

 */

function partitionHardSkills(jdData) {

  const required = extractRequiredSkills(jdData)

  const tools = extractTools(jdData).map((t) => t.term)

  return uniqueNormalized([...required, ...tools])

}



/**

 * Domain / title keywords for Keywords tab (max 16 pts).

 * Never includes anything already in the hard-skills partition.

 */

function partitionDomainKeywords(jdData, hardSkills) {

  const skillCanons = new Set(hardSkills.map(canonical).filter(Boolean))

  const fromExtract = extractKeywords(jdData).map((k) => k.term)

  return uniqueNormalized(fromExtract).filter((k) => !keywordCoveredBySkills(k, skillCanons))

}



/* ---------- Pillar 1: Keyword & Skills Match (40) ---------- */



function scoreHardSkills(resumeData, jdData, options = {}) {

  const maxPts = WEIGHTS.skills

  const hardSkills = partitionHardSkills(jdData)

  const evidence = []

  const matched = []

  const partial = []

  const missing = []

  const details = []

  const penalties = []



  // Unsupported tools added during enhancement

  const appliedSkills = (options.applied?.skills || []).map((s) => canonical(s.skill || s))

  const jdToolSet = new Set(hardSkills.map(canonical))

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



  if (!hardSkills.length) {

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

      penalties,

      hardSkills,

    }

  }



  let earnedWeight = 0

  const totalWeight = hardSkills.length



  for (const skill of hardSkills) {

    const ev = findEvidence(skill, resumeData)

    let credit = 0



    if (ev?.location === 'experience') {

      credit = 1.0

    } else if (ev?.location === 'skills') {

      // Skills-list only = stuffing risk → partial credit

      credit = 0.55

    } else if (ev?.location === 'summary') {

      credit = 0.4

    }



    const points = round1((credit / totalWeight) * maxPts)

    if (credit >= 0.9) {

      matched.push(skill)

      details.push({ item: skill, matched: true, strong: true, credit })

    } else if (credit > 0) {

      partial.push(skill)

      details.push({ item: skill, matched: true, strong: false, credit })

    } else {

      missing.push(skill)

      details.push({ item: skill, matched: false, strong: false, credit: 0 })

    }



    if (ev && credit > 0) {

      evidence.push({

        requirement: skill,

        resumeEvidence: ev.resumeEvidence,

        section: ev.section,

        company: ev.company || '',

        matchType: ev.matchType,

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

    // Count any positive credit (full + partial) so the UI fraction matches the detail list
    matched: matched.length + partial.length,

    total: hardSkills.length,

    pct: Math.round((earnedWeight / totalWeight) * 100),

    details,

    matchedItems: matched,

    partialItems: partial,

    missingItems: missing,

    evidence,

    penalties,

    hardSkills,

  }

}



function titleFamilyMatch(resumeData, jdData) {

  const role = normalize(jdData.roleTitle || jdData.title || '')

  if (!role) return { hit: false, score: 0 }



  const resumeTitles = [

    resumeData.title,

    resumeData.role,

    ...(resumeData.experience || []).map((e) => e.title || e.role || ''),

    collectSummaryText(resumeData),

  ].map(normalize).filter(Boolean)



  // Direct overlap

  if (resumeTitles.some((t) => t.includes(role) || role.includes(t) || tokenOverlap(t, role) >= 0.5)) {

    return { hit: true, score: 1 }

  }



  for (const family of TITLE_FAMILIES) {

    const jdInFamily = family.some((f) => role.includes(f))

    if (!jdInFamily) continue

    const resumeInFamily = resumeTitles.some((t) => family.some((f) => t.includes(f)))

    if (resumeInFamily) return { hit: true, score: 0.85 }

  }



  return { hit: false, score: 0 }

}




/**
 * Credit for a domain keyword against resume text.
 * Exact phrase = 1.0; related evidence / token coverage = 0.75–1.0; weak = 0.5.
 */
function domainKeywordCredit(term, bulletText, summaryText, fullText) {
  const c = canonical(term)
  const n = normalize(term)
  if (!c && !n) return { credit: 0, where: null, matchType: 'none' }

  const hayBullet = bulletText || ''
  const haySummary = summaryText || ''
  const hayAll = fullText || ''

  const hasPhrase = (hay, phrase) => {
    if (!phrase || phrase.length < 2) return false
    return hay.includes(phrase) || countOccurrences(hay, phrase) > 0
  }

  if (hasPhrase(hayBullet, c) || hasPhrase(hayBullet, n)) {
    return { credit: 1, where: 'experience', matchType: 'exact' }
  }
  if (hasPhrase(haySummary, c) || hasPhrase(haySummary, n)) {
    return { credit: 0.85, where: 'summary', matchType: 'exact' }
  }

  const evidence = DOMAIN_KEYWORD_EVIDENCE[c] || DOMAIN_KEYWORD_EVIDENCE[n] || []
  const tokens = (c || n).split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  const stems = [...new Set([...evidence.map((e) => normalize(e)), ...tokens])].filter((st) => st.length >= 3)

  let bulletHits = 0
  let summaryHits = 0
  let allHits = 0
  for (const stem of stems) {
    if (hayBullet.includes(stem)) bulletHits += 1
    if (haySummary.includes(stem)) summaryHits += 1
    if (hayAll.includes(stem)) allHits += 1
  }

  const need = Math.max(1, Math.ceil(tokens.length * 0.5))
  const evidenceInBullets = evidence.filter((e) => hayBullet.includes(normalize(e))).length

  if (bulletHits >= Math.max(2, need) || (tokens.length <= 2 && bulletHits >= 1 && evidenceInBullets >= 1)) {
    return { credit: 1, where: 'experience', matchType: 'semantic' }
  }
  if (bulletHits >= 1 && tokens.length >= 2) {
    return { credit: 0.8, where: 'experience', matchType: 'partial' }
  }
  if (summaryHits >= Math.max(1, need) || evidence.filter((e) => haySummary.includes(normalize(e))).length >= 1) {
    return { credit: 0.75, where: 'summary', matchType: 'semantic' }
  }
  if (allHits >= Math.max(2, need)) {
    return { credit: 0.55, where: 'resume', matchType: 'partial' }
  }
  if (tokens.length === 1 && (hayBullet.includes(tokens[0]) || haySummary.includes(tokens[0]))) {
    return {
      credit: 1,
      where: hayBullet.includes(tokens[0]) ? 'experience' : 'summary',
      matchType: 'exact',
    }
  }
  return { credit: 0, where: null, matchType: 'none' }
}

function scoreTitleAndDomainKeywords(resumeData, jdData, hardSkills) {

  const maxPts = WEIGHTS.keywords

  const titleMax = 6

  const domainMax = 10

  const evidence = []

  const details = []

  const matched = []

  const missing = []

  const penalties = []



  const title = titleFamilyMatch(resumeData, jdData)

  const titlePts = round1(title.score * titleMax)

  details.push({

    item: `Job title alignment (${jdData.roleTitle || 'role'})`,

    matched: title.hit,

    strong: title.score >= 0.85,

  })

  if (title.hit) {

    matched.push(jdData.roleTitle || 'role title')

    evidence.push({

      requirement: 'Job title alignment',

      resumeEvidence: (resumeData.experience || [])[0]?.title || collectSummaryText(resumeData).slice(0, 120),

      section: 'Title',

      company: '',

      matchType: 'semantic',

      weight: titleMax,

      pointsAwarded: titlePts,

      credit: title.score,

    })

  }



  const domainTerms = partitionDomainKeywords(jdData, hardSkills)

  const text = resumeFullText(resumeData)

  const bulletText = normalize(collectExperienceBullets(resumeData).map((b) => b.text).join(' '))

  const summaryText = normalize(collectSummaryText(resumeData))



  let domainEarned = 0

  const domainTotal = domainTerms.length || 1



  if (!domainTerms.length) {

    // Full domain sub-score when JD has no domain keywords

    domainEarned = domainTotal

  } else {

    for (const term of domainTerms) {
      const hit = domainKeywordCredit(term, bulletText, summaryText, text)
      let credit = hit.credit

      if (credit === 0) {
        const ev = findEvidence(term, resumeData)
        if (ev?.location === 'skills') credit = 0.35
      }

      const count = Math.max(
        countOccurrences(text, canonical(term)),
        countOccurrences(text, normalize(term)),
      )
      if (credit >= 1 && count >= 8) {
        credit = 0.75
        penalties.push({
          type: 'keyword_stuffing',
          item: term,
          detail: '"' + term + '" repeated ' + count + ' times',
          amount: 0.5,
        })
      }

      domainEarned += credit
      if (credit > 0) {
        matched.push(term)
        details.push({
          item: term,
          matched: true,
          strong: credit >= 0.9,
          count,
          credit,
        })
        evidence.push({
          requirement: term,
          resumeEvidence: hit.where === 'experience'
            ? 'Found in experience'
            : hit.where === 'summary'
              ? 'Found in summary'
              : 'Matched (' + (hit.matchType || 'partial') + ')',
          section: hit.where === 'experience' ? 'Experience' : hit.where === 'summary' ? 'Summary' : 'Resume',
          company: '',
          matchType: hit.matchType || 'normalized',
          weight: 1,
          pointsAwarded: round1((credit / domainTotal) * domainMax),
          credit,
        })
      } else {
        missing.push(term)
        details.push({ item: term, matched: false, strong: false })
      }
    }

  }



  const domainPts = domainTerms.length

    ? round1((domainEarned / domainTotal) * domainMax)

    : domainMax



  const score = round1(titlePts + domainPts)

  const matchedCount = details.filter((d) => d.matched).length

  const totalCount = details.length



  return {

    score: clamp(score, 0, maxPts),

    matched: matchedCount,

    total: totalCount,

    pct: totalCount ? Math.round((matchedCount / totalCount) * 100) : 100,

    details,

    matchedItems: uniqueNormalized(matched),

    missingItems: uniqueNormalized(missing),

    evidence,

    penalties,

    domainTerms,

  }

}



/* ---------- Pillar 2: Experience & Impact (40) ---------- */



function scoreResponsibilityCoverage(resumeData, jdData) {

  const maxPts = 20

  const responsibilities = extractResponsibilities(jdData)

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



function scoreQuantifiableImpact(resumeData) {

  const maxPts = 10

  const bullets = collectExperienceBullets(resumeData)

  if (!bullets.length) {

    return { score: 0, matched: 0, total: 0, pct: 0, details: [{ item: 'No experience bullets to quantify', matched: false }] }

  }

  const withMetrics = bullets.filter((b) => QUANTIFIER_RE.test(b.text))

  const ratio = withMetrics.length / bullets.length

  const score = round1(ratio * maxPts)

  return {

    score,

    matched: withMetrics.length,

    total: bullets.length,

    pct: Math.round(ratio * 100),

    details: [{

      item: `Bullets with metrics (${withMetrics.length}/${bullets.length})`,

      matched: withMetrics.length > 0,

      strong: ratio >= 0.4,

    }],

  }

}



function scoreActionVerbs(resumeData) {

  const maxPts = 5

  const bullets = collectExperienceBullets(resumeData)

  if (!bullets.length) {

    return { score: 0, matched: 0, total: 0, pct: 0, details: [{ item: 'No bullets for action-verb check', matched: false }] }

  }

  let strong = 0

  for (const b of bullets) {

    const first = normalize(b.text).split(/\s+/)[0] || ''

    if (ACTION_VERBS.has(first)) strong += 1

  }

  const ratio = strong / bullets.length

  return {

    score: round1(ratio * maxPts),

    matched: strong,

    total: bullets.length,

    pct: Math.round(ratio * 100),

    details: [{

      item: `Strong action verbs (${strong}/${bullets.length})`,

      matched: strong > 0,

      strong: ratio >= 0.5,

    }],

  }

}



function parseYearToken(raw) {

  const m = String(raw || '').match(/(19|20)\d{2}/)

  return m ? Number(m[0]) : null

}



function scoreRecencyAndScope(resumeData) {

  const maxPts = 5

  const exps = resumeData.experience || []

  if (!exps.length) {

    return { score: 0, matched: 0, total: 1, pct: 0, details: [{ item: 'No experience entries', matched: false }] }

  }



  const nowYear = new Date().getFullYear()

  const windowStart = nowYear - 7

  let recent = 0

  for (const e of exps) {

    const dates = String(e.dates || '')

    const end = /present|current|now/i.test(dates)

      ? nowYear

      : parseYearToken(e.endDate) || parseYearToken(dates.split(/[-–—]/).pop())

    const start = parseYearToken(e.startDate) || parseYearToken(dates)

    if ((end && end >= windowStart) || (start && start >= windowStart)) recent += 1

  }



  const companies = new Set(exps.map((e) => normalize(e.company)).filter(Boolean))

  const titles = exps.map((e) => normalize(e.title || e.role || '')).filter(Boolean)

  const progressive = titles.length >= 2 && new Set(titles).size >= Math.min(2, titles.length)



  let pts = 0

  if (recent > 0) pts += 2.5 * Math.min(1, recent / Math.max(1, exps.length))

  if (companies.size >= 2) pts += 1.5

  else if (companies.size === 1) pts += 0.75

  if (progressive) pts += 1

  pts = clamp(pts, 0, maxPts)



  return {

    score: round1(pts),

    matched: recent,

    total: exps.length,

    pct: Math.round((pts / maxPts) * 100),

    details: [

      { item: `Recent roles in last 7 years (${recent}/${exps.length})`, matched: recent > 0, strong: recent === exps.length },

      { item: `Career scope (${companies.size} companies)`, matched: companies.size >= 1, strong: companies.size >= 2 },

      { item: 'Progressive titles', matched: progressive, strong: progressive },

    ],

  }

}



function scoreExperienceImpact(resumeData, jdData) {

  const coverage = scoreResponsibilityCoverage(resumeData, jdData)

  const quant = scoreQuantifiableImpact(resumeData)

  const verbs = scoreActionVerbs(resumeData)

  const recency = scoreRecencyAndScope(resumeData)



  const score = round1(coverage.score + quant.score + verbs.score + recency.score)

  return {

    score: clamp(score, 0, WEIGHTS.experience),

    matched: coverage.matched,

    total: coverage.total,

    pct: coverage.pct,

    coveragePct: coverage.coveragePct,

    details: coverage.details,

    coveredItems: coverage.coveredItems,

    partialItems: coverage.partialItems,

    missingItems: coverage.missingItems,

    evidence: coverage.evidence,

    subscores: { coverage, quant, verbs, recency },

  }

}



/* ---------- Pillar 3: Format & Readability (20) ---------- */



function scoreFormat(resumeData, jdData = {}) {

  const maxPts = WEIGHTS.format

  const checks = []

  let points = 0



  const hasSummary = Boolean((resumeData.summary || '').trim() || (resumeData.summaryBullets || []).length)

  const hasSkills = collectResumeSkills(resumeData).length > 0

  const exps = resumeData.experience || []

  const hasExperience = exps.length > 0

  const hasEducation = (resumeData.education || []).length > 0 || Boolean(resumeData.degree || resumeData.university)



  // Standard sections — up to 8

  const sectionPts = [

    { ok: hasSummary, pts: 2, label: 'Summary section present' },

    { ok: hasSkills, pts: 2, label: 'Skills section present' },

    { ok: hasExperience, pts: 2, label: 'Experience section present' },

    { ok: hasEducation, pts: 2, label: 'Education section present' },

  ]

  for (const c of sectionPts) {

    checks.push(c)

    if (c.ok) points += c.pts

  }



  // Contact + parseable structure — up to 6

  const hasContact = Boolean(resumeData.email || resumeData.phone || resumeData.location || resumeData.linkedin)

  const hasName = Boolean((resumeData.name || '').trim())

  const hasCompanies = exps.some((e) => (e.company || '').trim())

  const hasDates = exps.some((e) => (e.startDate || e.endDate || e.dates || '').toString().trim())

  const bullets = collectExperienceBullets(resumeData)

  const hasBullets = bullets.length >= 2

  const structurePts = [

    { ok: hasContact, pts: 1.5, label: 'Contact information present' },

    { ok: hasName, pts: 1, label: 'Name present' },

    { ok: hasCompanies && hasDates, pts: 1.5, label: 'Companies and dates present' },

    { ok: hasBullets, pts: 2, label: 'Experience bullets present' },

  ]

  for (const c of structurePts) {

    checks.push(c)

    if (c.ok) points += c.pts

  }



  // Education / credentials — up to 4

  const wantsCreds = /certif|license|degree|bachelor|master|phd/i.test(

    JSON.stringify(jdData.requiredSkills || []) + JSON.stringify(jdData.responsibilities || []) + (jdData.roleTitle || ''),

  )

  const hasCerts = (resumeData.certifications || []).length > 0

  const eduPts = [

    { ok: hasEducation, pts: wantsCreds ? 2 : 2.5, label: 'Education listed' },

    { ok: hasCerts || !wantsCreds, pts: wantsCreds ? 2 : 1.5, label: wantsCreds ? 'Credentials/certifications listed' : 'Credentials optional for JD' },

  ]

  for (const c of eduPts) {

    checks.push(c)

    if (c.ok) points += c.pts

  }



  // Layout risk deductions — up to −4

  let deduction = 0

  const long = bullets.filter((b) => b.text.length > 400)

  if (long.length >= 3) {

    deduction += 1

    checks.push({ ok: false, pts: 0, label: 'Excessively long bullets (layout risk)', deduction: 1 })

  }

  const norms = bullets.map((b) => normalize(b.text))

  const dupes = norms.filter((n, i) => n && norms.indexOf(n) !== i).length

  if (dupes >= 2) {

    deduction += 1

    checks.push({ ok: false, pts: 0, label: 'Duplicate bullets (layout risk)', deduction: 1 })

  }

  if (exps.length >= 1 && bullets.length === 0) {

    deduction += 2

    checks.push({ ok: false, pts: 0, label: 'Experience headers without bullets', deduction: 2 })

  }

  deduction = Math.min(4, deduction)

  points = Math.max(0, points - deduction)



  // Scale raw points (max ~18 before scale) into 20

  const rawMax = 8 + 6 + 4 // 18

  const score = round1(clamp((points / rawMax) * maxPts, 0, maxPts))



  return {

    score,

    matched: checks.filter((c) => c.ok).length,

    total: checks.length,

    pct: Math.round((score / maxPts) * 100),

    details: checks.map((c) => ({

      item: c.label,

      matched: Boolean(c.ok),

      strong: Boolean(c.ok),

    })),

    checks,

    evidence: checks.filter((c) => c.ok).map((c) => ({

      requirement: c.label,

      resumeEvidence: 'Present in parsed resume',

      section: 'Format',

      company: '',

      matchType: 'exact',

      weight: c.pts || 1,

      pointsAwarded: c.pts || 0,

    })),

    formatIssues: checks.filter((c) => !c.ok).map((c) => c.label),

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



  return penalties

}



/**

 * Main scoring entry — identical formula for before and after.

 * @param {object} resumeData

 * @param {object} jdData

 * @param {{ applied?: object }} [options]

 */

export function compareResumeToJD(resumeData, jdData, options = {}) {

  const hard = scoreHardSkills(resumeData, jdData, options)

  const keywords = scoreTitleAndDomainKeywords(resumeData, jdData, hard.hardSkills || partitionHardSkills(jdData))

  const experience = scoreExperienceImpact(resumeData, jdData)

  const format = scoreFormat(resumeData, jdData)



  // Enforce disjoint detail lists (defensive)

  const skillCanon = new Set((hard.details || []).map((d) => canonical(d.item)))

  keywords.details = (keywords.details || []).filter((d) => {

    if (/job title alignment/i.test(d.item)) return true

    return !keywordCoveredBySkills(d.item, skillCanon)

  })



  const categoryPenalties = [

    ...(hard.penalties || []),

    ...(keywords.penalties || []),

  ]

  const penalties = detectPenalties(resumeData, categoryPenalties)

  const penaltyTotal = round1(penalties.reduce((s, p) => s + (p.amount || 0), 0))



  const rawTotal = round1(hard.score + keywords.score + experience.score + format.score)

  const atsScore = clamp(Math.round(rawTotal - penaltyTotal), 0, 100)



  const toolTerms = new Set(extractTools(jdData).map((t) => t.canonical))

  const matchedTools = hard.matchedItems.filter((s) => toolTerms.has(canonical(s)))

  const missingTools = (hard.hardSkills || [])

    .filter((s) => toolTerms.has(canonical(s)))

    .filter((s) => !matchedTools.some((m) => canonical(m) === canonical(s)))



  // Enhancement plan should prioritize hard skills/tools (not soft fluff or domain dupes)

  const present = uniqueNormalized([

    ...hard.matchedItems,

    ...hard.partialItems,

    ...keywords.matchedItems,

  ])

  // Skills-force path uses missingHardSkills; keep `missing` hard-only so domain phrases
  // are never treated as skill gaps. Domain gaps live in missingKeywords.
  const missing = uniqueNormalized([

    ...hard.missingItems,

  ])

  const strong = uniqueNormalized(hard.matchedItems)

  const weak = uniqueNormalized(hard.partialItems)



  const categories = {

    requiredSkills: {

      before: hard.score,

      score: hard.score,

      max: WEIGHTS.skills,

      ...pickPillar(hard),

    },

    keywords: {

      score: keywords.score,

      max: WEIGHTS.keywords,

      ...pickPillar(keywords),

    },

    experience: {

      score: experience.score,

      max: WEIGHTS.experience,

      ...pickPillar(experience),

    },

    format: {

      score: format.score,

      max: WEIGHTS.format,

      ...pickPillar(format),

    },

  }



  const scoreBreakdown = {

    skills: {

      matched: hard.matched,

      total: hard.total,

      pct: hard.pct,

      score: hard.score,

      max: WEIGHTS.skills,

      label: 'Hard Skills & Tools',

    },

    keywords: {

      matched: keywords.matched,

      total: keywords.total,

      pct: keywords.pct,

      score: keywords.score,

      max: WEIGHTS.keywords,

      label: 'Title & Domain Keywords',

    },

    bullets: {

      matched: experience.matched,

      total: experience.total,

      pct: experience.pct,

      coveragePct: experience.coveragePct,

      score: experience.score,

      max: WEIGHTS.experience,

      label: 'Experience & Impact',

    },

    format: {

      matched: format.matched,

      total: format.total,

      pct: format.pct,

      score: format.score,

      max: WEIGHTS.format,

      label: 'Format & Readability',

    },

    weights: {

      keywordPillar: WEIGHTS.keywordPillar,

      experiencePillar: WEIGHTS.experiencePillar,

      formatPillar: WEIGHTS.formatPillar,

      skills: WEIGHTS.skills,

      keywords: WEIGHTS.keywords,

      experience: WEIGHTS.experience,

      format: WEIGHTS.format,

    },

    details: {

      skills: hard.details,

      keywords: keywords.details,

      bullets: experience.details,

      format: format.details,

    },

  }



  const report = {

    score: atsScore,

    rawTotal,

    penaltyTotal,

    categories: {

      requiredSkills: { score: hard.score, max: WEIGHTS.skills },

      keywords: { score: keywords.score, max: WEIGHTS.keywords },

      experience: { score: experience.score, max: WEIGHTS.experience },

      format: { score: format.score, max: WEIGHTS.format },

    },

    matchedRequiredSkills: hard.matchedItems,

    partiallyMatchedRequiredSkills: hard.partialItems,

    missingRequiredSkills: hard.missingItems,

    missingHardSkills: hard.missingItems,

    matchedTools,

    missingTools,

    coveredResponsibilities: experience.coveredItems,

    partiallyCoveredResponsibilities: experience.partialItems,

    missingResponsibilities: experience.missingItems,

    matchedKeywords: keywords.matchedItems,

    missingKeywords: keywords.missingItems,

    formatIssues: format.formatIssues || [],

    evidence: [

      ...hard.evidence,

      ...keywords.evidence,

      ...experience.evidence,

      ...format.evidence,

    ],

    penalties,

    scoringReasons: buildScoringReasons({

      hard,

      keywords,

      experience,

      format,

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

    missingHardSkills: hard.missingItems,

    missingKeywords: keywords.missingItems,

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

    `Hard skills & tools: ${parts.hard.score}/${WEIGHTS.skills} `

    + `(${parts.hard.matchedItems.length} full, ${parts.hard.partialItems.length} partial, `

    + `${parts.hard.missingItems.length} missing)`,

  )

  reasons.push(

    `Title & domain keywords: ${parts.keywords.score}/${WEIGHTS.keywords} `

    + `(${parts.keywords.matchedItems.length} matched, ${parts.keywords.missingItems.length} missing)`,

  )

  reasons.push(

    `Experience & impact: ${parts.experience.score}/${WEIGHTS.experience} `

    + `(coverage ${parts.experience.coveredItems.length} full / ${parts.experience.partialItems.length} partial / `

    + `${parts.experience.missingItems.length} missing)`,

  )

  const sub = parts.experience.subscores

  if (sub) {

    reasons.push(

      `Impact signals: metrics ${sub.quant.score}/10, verbs ${sub.verbs.score}/5, recency ${sub.recency.score}/5`,

    )

  }

  reasons.push(`Format & readability: ${parts.format.score}/${WEIGHTS.format}`)

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



  const keys = ['requiredSkills', 'keywords', 'experience', 'format']



  const breakdown = {}

  for (const key of keys) {

    const uiKey = key === 'requiredSkills' ? 'skills' : key === 'experience' ? 'bullets' : key

    const before = b[key]?.score

      ?? beforeComparison.scoreBreakdown?.[uiKey]?.score

      ?? 0

    const after = a[key]?.score

      ?? afterComparison.scoreBreakdown?.[uiKey]?.score

      ?? 0

    const max = key === 'requiredSkills' ? WEIGHTS.skills

      : key === 'keywords' ? WEIGHTS.keywords

        : key === 'experience' ? WEIGHTS.experience

          : WEIGHTS.format

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
