/**
 * ATS scoring: JD Skills + Keywords + Bullets vs resume.
 *
 * Equal pillars (100 total when all JD items are present):
 *   Skills   ~33.3  — required/preferred/tools from JD vs resume skill lists + text
 *   Keywords ~33.3  — must-have / domain / nice-to-have vs resume text
 *   Bullets  ~33.3  — JD responsibilities vs resume bullets (token overlap %)
 *
 * Before = original resume. After = resume + applied enhancements.
 */

function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function uniqueNormalized(items) {
  const out = []
  const seen = new Set()
  for (const item of items || []) {
    const raw = (item || '').trim()
    const key = normalize(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectResumeSkills(resumeData) {
  return new Set(
    uniqueNormalized([
      ...(resumeData.skills || []),
      ...(resumeData.technicalSkills || []),
    ]).map((s) => normalize(s)),
  )
}

function collectResumeBullets(resumeData) {
  return [
    ...(resumeData.summaryBullets || []),
    ...(resumeData.experience || []).flatMap((e) => e.bullets || []),
    ...(resumeData.projects || []),
  ].map((b) => normalize(b)).filter(Boolean)
}

function resumeFullText(resumeData) {
  return normalize(JSON.stringify(resumeData || {}))
}

function skillMatches(jdSkill, resumeSkills, resumeText) {
  const lower = normalize(jdSkill)
  if (!lower) return { matched: false, strong: false }

  const inList = resumeSkills.has(lower)
    || [...resumeSkills].some((s) => s.includes(lower) || lower.includes(s))

  let count = 0
  try {
    count = (resumeText.match(new RegExp(escapeRegex(lower), 'g')) || []).length
  } catch {
    count = resumeText.includes(lower) ? 1 : 0
  }

  const matched = inList || count > 0
  return { matched, strong: matched && (inList || count >= 2), count }
}

function keywordMatches(jdKeyword, resumeText) {
  const lower = normalize(jdKeyword)
  if (!lower) return { matched: false, strong: false, count: 0 }
  let count = 0
  try {
    count = (resumeText.match(new RegExp(escapeRegex(lower), 'g')) || []).length
  } catch {
    count = resumeText.includes(lower) ? 1 : 0
  }
  return { matched: count > 0, strong: count >= 2, count }
}

function bulletTokens(text) {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2),
  )
}

/**
 * How well a JD responsibility is covered by any resume bullet (0–1).
 * Uses best token-overlap match across resume bullets.
 */
function bulletCoverage(jdBullet, resumeBullets) {
  const jdTokens = bulletTokens(jdBullet)
  if (!jdTokens.size) return 0

  let best = 0
  for (const rb of resumeBullets) {
    const rt = bulletTokens(rb)
    if (!rt.size) continue
    let overlap = 0
    for (const t of jdTokens) if (rt.has(t)) overlap += 1
    const ratio = overlap / jdTokens.size
    if (ratio > best) best = ratio
  }
  return best
}

function collectJdSkills(jdData) {
  // Skills pillar: short tool/skill names only (not JD sentences)
  return uniqueNormalized([
    ...(jdData.requiredSkills || []),
    ...(jdData.preferredSkills || []),
    ...(jdData.toolsTechnologies || []),
  ]).filter((s) => {
    const t = (s || '').trim()
    if (!t || t.length > 42) return false
    if (t.split(/\s+/).length > 5) return false
    if (/[.!?]/.test(t)) return false
    return true
  })
}

function collectJdKeywords(jdData) {
  return uniqueNormalized([
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.domainKeywords || []),
    ...(jdData.niceToHaveKeywords || []),
  ])
}

function collectJdBullets(jdData) {
  return uniqueNormalized(jdData.responsibilities || [])
}

/**
 * Score one pillar: matchedCount / total * weight.
 * Empty JD pillar → full weight (nothing to miss).
 */
function pillarScore(matched, total, weight) {
  if (total <= 0) return { score: weight, matched: 0, total: 0, pct: 100 }
  const pct = matched / total
  return {
    score: Math.round(pct * weight * 10) / 10,
    matched,
    total,
    pct: Math.round(pct * 100),
  }
}

export function compareResumeToJD(resumeData, jdData) {
  const resumeSkills = collectResumeSkills(resumeData)
  const resumeBullets = collectResumeBullets(resumeData)
  const resumeText = resumeFullText(resumeData)

  const jdSkills = collectJdSkills(jdData)
  const jdKeywords = collectJdKeywords(jdData)
  const jdBullets = collectJdBullets(jdData)

  // Equal thirds of 100
  const WEIGHT = {
    skills: 100 / 3,
    keywords: 100 / 3,
    bullets: 100 / 3,
  }

  const present = []
  const missing = []
  const strong = []
  const weak = []

  let skillsMatched = 0
  const skillDetails = []
  for (const skill of jdSkills) {
    const { matched, strong: isStrong } = skillMatches(skill, resumeSkills, resumeText)
    skillDetails.push({ item: skill, matched, strong: isStrong })
    if (matched) {
      skillsMatched += 1
      present.push(skill)
      if (isStrong) strong.push(skill)
      else weak.push(skill)
    } else {
      missing.push(skill)
    }
  }

  let keywordsMatched = 0
  const keywordDetails = []
  for (const kw of jdKeywords) {
    const { matched, strong: isStrong } = keywordMatches(kw, resumeText)
    keywordDetails.push({ item: kw, matched, strong: isStrong })
    if (matched) {
      keywordsMatched += 1
      if (!present.some((p) => normalize(p) === normalize(kw))) present.push(kw)
      if (isStrong) {
        if (!strong.some((p) => normalize(p) === normalize(kw))) strong.push(kw)
      } else if (!weak.some((p) => normalize(p) === normalize(kw))) {
        weak.push(kw)
      }
    } else if (!missing.some((p) => normalize(p) === normalize(kw))) {
      missing.push(kw)
    }
  }

  // Bullets: average coverage % across JD responsibilities
  let bulletCoverageSum = 0
  const bulletDetails = []
  for (const jb of jdBullets) {
    const coverage = bulletCoverage(jb, resumeBullets)
    bulletCoverageSum += coverage
    const matched = coverage >= 0.35
    bulletDetails.push({
      item: jb,
      coverage: Math.round(coverage * 100),
      matched,
    })
  }
  const bulletAvg = jdBullets.length ? bulletCoverageSum / jdBullets.length : 1
  const bulletsMatched = bulletDetails.filter((b) => b.matched).length

  const skillsPillar = pillarScore(skillsMatched, jdSkills.length, WEIGHT.skills)
  const keywordsPillar = pillarScore(keywordsMatched, jdKeywords.length, WEIGHT.keywords)
  // Bullets use continuous coverage for score; matched count uses >=35% threshold
  const bulletsPillar = jdBullets.length
    ? {
        score: Math.round(bulletAvg * WEIGHT.bullets * 10) / 10,
        matched: bulletsMatched,
        total: jdBullets.length,
        // Show same basis as score (avg coverage), not matched/total
        pct: Math.round(bulletAvg * 100),
        coveragePct: Math.round(bulletAvg * 100),
      }
    : { score: WEIGHT.bullets, matched: 0, total: 0, pct: 100, coveragePct: 100 }

  const atsScore = Math.min(
    100,
    Math.round(skillsPillar.score + keywordsPillar.score + bulletsPillar.score),
  )

  const mustHave = jdData.mustHaveKeywords || []
  const missingMustHave = mustHave.filter(
    (k) => !present.some((p) => normalize(p).includes(normalize(k)) || normalize(k).includes(normalize(p))),
  )

  return {
    present,
    missing,
    strong,
    weak,
    missingMustHave,
    missingResponsibilities: bulletDetails.filter((b) => !b.matched).map((b) => b.item),
    atsScore,
    scoreBreakdown: {
      skills: skillsPillar,
      keywords: keywordsPillar,
      bullets: bulletsPillar,
      weights: {
        skills: Math.round(WEIGHT.skills * 10) / 10,
        keywords: Math.round(WEIGHT.keywords * 10) / 10,
        bullets: Math.round(WEIGHT.bullets * 10) / 10,
      },
      details: {
        skills: skillDetails,
        keywords: keywordDetails,
        bullets: bulletDetails,
      },
    },
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

  // Companies in applied that weren't matched by name — append as orphan bullets into first company
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
