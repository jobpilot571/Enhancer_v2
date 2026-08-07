import { structuredJSON } from './aiProvider.js'

/**
 * Post-generation Experience quality check for JD builds.
 * Detects cross-company repetition / weak bullets, rewrites ONLY failing bullets.
 * Fail-safe: any error returns the original resumeData unchanged.
 */

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          companyIndex: { type: 'number' },
          bulletIndex: { type: 'number' },
          replacement: { type: 'string' },
        },
        required: ['companyIndex', 'bulletIndex', 'replacement'],
        additionalProperties: false,
      },
    },
  },
  required: ['rewrites'],
  additionalProperties: false,
}

const STOCK_PHRASE_GROUPS = [
  { id: 'ai', re: /\b(artificial intelligence|\bai\b|chatgpt|copilot|generative ai|llm|machine learning|\bml\b)\b/i },
  { id: 'automation', re: /\bautomat(e|ed|ing|ion)\b/i },
  { id: 'dashboard', re: /\bdashboard(s)?\b/i },
  { id: 'testing', re: /\b(regression\s+)?test(ing|s)?\b|\bqa\b|\bunit tests?\b/i },
  { id: 'documentation', re: /\bdocument(ation|ed|ing)?\b|\brunbook(s)?\b/i },
  { id: 'stakeholder', re: /\bstakeholder(s)?\b/i },
]

const GENERIC_RE = /^(responsible for|worked on|helped with|assisted with|involved in|participated in|duties included|various tasks|as needed)\b/i

const SENIOR_MARKERS = /\b(led|owned|architected|directed|established|governed|mentored|sponsored|decided|prioritized|negotiated)\b/i
const JUNIOR_MARKERS = /\b(assisted|helped|supported|shadowed|learned|under guidance|as instructed|documented only)\b/i
const MID_MARKERS = /\b(implemented|configured|developed|analyzed|troubleshot|built|designed|tested)\b/i

const ACTION_DETAIL_RE = /\b(led|owned|built|designed|developed|implemented|configured|analyzed|supported|improved|created|delivered|resolved|optimized|migrated|integrated|automated|tested|validated|partnered|collaborated|troubleshot|maintained|enhanced|wrote|coded|deployed|monitored|reconciled|modeled|queried)\b/i

const OUTCOME_RE = /\b(improv\w*|reduc\w*|increas\w*|enabl\w*|deliver\w*|resolv\w*|cut|saved?|faster|reliab\w*|accur\w*|streamlin\w*|shorten\w*|eliminat\w*|strengthened|stabiliz\w*)\b/i

/** Core career tools that may legitimately appear across many companies. */
const CORE_CAREER_TOOLS = new Set([
  'sql', 'python', 'java', 'aws', 'tableau', 'oracle ebs', 'oracle', 'javascript', 'typescript',
])

const COMMON_TOOLS = [
  'python', 'java', 'javascript', 'typescript', 'sql', 'snowflake', 'tableau', 'power bi', 'looker',
  'excel', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'airflow', 'dbt', 'spark',
  'hadoop', 'kafka', 'react', 'node', 'salesforce', 'sap', 'oracle', 'oracle ebs', 'jira', 'git', 'linux',
  'postgres', 'mysql', 'mongodb', 'redshift', 'bigquery', 'databricks', 'pandas', 'numpy', 'scikit',
]

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function openingKey(bullet) {
  const words = normalizeText(bullet).split(/\s+/).filter(Boolean).slice(0, 4)
  return words.join(' ')
}

function wordSet(bullet) {
  return new Set(normalizeText(bullet).split(/\s+/).filter((w) => w.length > 2))
}

function jaccard(a, b) {
  const A = wordSet(a)
  const B = wordSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter += 1
  return inter / (A.size + B.size - inter)
}

function extractMetrics(bullet) {
  const text = String(bullet || '')
  const found = []
  for (const m of text.matchAll(/\b\d{1,3}\s*%/g)) found.push(normalizeText(m[0]))
  for (const m of text.matchAll(/\b(?:by|over|under|nearly|about)\s+\d{1,3}\s*%/gi)) {
    found.push(normalizeText(m[0]))
  }
  return [...new Set(found)]
}

function extractTools(bullet) {
  const text = normalizeText(bullet)
  const hits = []
  for (const tool of COMMON_TOOLS) {
    const re = new RegExp(`(?:^|[^a-z0-9+#])${tool.replace(/\s+/g, '\\s+')}(?:[^a-z0-9+#]|$)`, 'i')
    if (re.test(text)) hits.push(tool)
  }
  return hits
}

/** Short bullets are fine when they still show action, technical detail, or outcome. */
function lacksSubstance(bullet) {
  const text = String(bullet || '').trim()
  if (!text) return true
  if (ACTION_DETAIL_RE.test(text)) return false
  if (OUTCOME_RE.test(text)) return false
  if (extractTools(text).length) return false
  // Light technical signal beyond the common-tool list
  if (/\b(api|etl|pipeline|schema|query|module|workflow|integration|dataset|warehouse|ebs|erp|crm)\b/i.test(text)) {
    return false
  }
  return true
}

function keywordPresentInResume(resumeData, keyword) {
  const key = normalizeText(keyword)
  if (!key) return false
  const re = new RegExp(`(?:^|[^a-z0-9+#])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9+#]|$)`, 'i')
  const parts = [
    resumeData.summary || '',
    ...((resumeData.summaryBullets || [])),
    ...((resumeData.skills || [])),
    ...((resumeData.technicalSkills || [])),
    ...((resumeData.skillCategories || []).flatMap((c) => c.skills || [])),
    ...((resumeData.experience || []).flatMap((job) => [
      job.title || '',
      ...(job.bullets || []),
    ])),
  ]
  return parts.some((p) => re.test(String(p || '')))
}

function collectResumeJdKeywordCoverage(resumeData, jdKeywords) {
  return new Set(
    (jdKeywords || []).filter((kw) => keywordPresentInResume(resumeData, kw)).map((kw) => normalizeText(kw)),
  )
}

/**
 * Industry-only hints from research — never project names or unverified initiatives.
 */
function industryContextOnly(companyName, companyContexts = []) {
  const row = (companyContexts || []).find(
    (c) => normalizeText(c.company) === normalizeText(companyName),
  )
  if (!row) return null
  const industryHints = [
    ...(row.verified?.industry || []).map((x) => (typeof x === 'string' ? x : x?.value)),
    ...(row.verified?.businessAreas || []).map((x) => (typeof x === 'string' ? x : x?.value)),
    ...(row.industryTypical?.businessAreas || []),
  ].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6)
  if (!industryHints.length) return null
  return { industryHints }
}

function inferSeniority(title = '') {
  const t = String(title || '').toLowerCase()
  if (/\b(intern|trainee|graduate|junior|jr\.?|associate|entry)\b/.test(t)) return 'junior'
  if (/\b(principal|staff|lead|manager|director|architect|senior|sr\.?|head)\b/.test(t)) return 'senior'
  return 'mid'
}

function collectJdKeywords(jdData) {
  return [...new Set([
    ...(jdData?.requiredSkills || []),
    ...(jdData?.preferredSkills || []),
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.mustHaveKeywords || []),
  ].map((s) => String(s || '').trim()).filter(Boolean))]
}

function keywordsInBullet(bullet, jdKeywords) {
  const text = normalizeText(bullet)
  return jdKeywords.filter((kw) => {
    const key = normalizeText(kw)
    if (!key) return false
    const re = new RegExp(`(?:^|[^a-z0-9+#])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9+#]|$)`, 'i')
    return re.test(text)
  })
}

/**
 * Heuristic cross-company quality scan.
 * Thresholds (a bullet fails when any apply):
 * - same 4-word opener used in 2+ companies
 * - same non-core tool appears in 3+ companies AND responsibility/structure is also repetitive
 * - Jaccard similarity >= 0.55 with a bullet from another company
 * - same metric/percentage used in 2+ companies
 * - stock phrase family (AI/automation/dashboard/testing/documentation/stakeholder) in 3+ companies
 * - generic opener, OR short (< 22 words) AND lacking action/tech/outcome
 * - seniority mismatch
 * Company research is NOT used as a fail condition (industry context only during rewrite).
 *
 * @returns {{ flags: object[], summary: object }}
 */
export function detectExperienceQualityIssues(resumeData, { jdData = null, companyContexts = [] } = {}) {
  void companyContexts // reserved for rewrite-time industry hints only
  const experience = Array.isArray(resumeData?.experience) ? resumeData.experience : []
  const flags = []
  const flagKey = (ci, bi) => `${ci}:${bi}`
  const flagged = new Map() // key -> reasons[]

  function addFlag(ci, bi, reason) {
    const key = flagKey(ci, bi)
    const list = flagged.get(key) || []
    if (!list.includes(reason)) list.push(reason)
    flagged.set(key, list)
  }

  // Index bullets
  const items = []
  experience.forEach((job, ci) => {
    (job.bullets || []).forEach((bullet, bi) => {
      items.push({
        ci,
        bi,
        company: job.company || '',
        title: job.title || '',
        seniority: inferSeniority(job.title),
        bullet: String(bullet || '').trim(),
        opening: openingKey(bullet),
        tools: extractTools(bullet),
        metrics: extractMetrics(bullet),
        words: String(bullet || '').trim().split(/\s+/).filter(Boolean).length,
      })
    })
  })

  // 1) Repeated openings across companies
  const openings = new Map()
  for (const item of items) {
    if (!item.opening || item.opening.split(' ').length < 3) continue
    const list = openings.get(item.opening) || []
    list.push(item)
    openings.set(item.opening, list)
  }
  for (const [, list] of openings) {
    const companies = new Set(list.map((x) => x.ci))
    if (companies.size >= 2) {
      list.slice(1).forEach((item) => addFlag(item.ci, item.bi, 'repeated_opening'))
    }
  }

  // 2) Tool repetition alone is NOT enough for core career tools.
  // Only flag when a tool appears in 3+ companies AND the bullet is also structurally
  // repetitive (shared opener family or high similarity to another company's bullet).
  const toolCompanies = new Map()
  for (const item of items) {
    for (const tool of item.tools) {
      if (CORE_CAREER_TOOLS.has(tool)) continue
      const set = toolCompanies.get(tool) || new Map()
      if (!set.has(item.ci)) set.set(item.ci, item)
      toolCompanies.set(tool, set)
    }
  }
  for (const [, companyMap] of toolCompanies) {
    if (companyMap.size < 3) continue
    const ordered = [...companyMap.entries()].sort((a, b) => a[0] - b[0])
    ordered.slice(2).forEach(([, item]) => {
      const structurallyRepetitive = items.some((other) => {
        if (other.ci === item.ci) return false
        if (other.opening && item.opening && other.opening === item.opening) return true
        return jaccard(other.bullet, item.bullet) >= 0.55
      })
      if (structurallyRepetitive) {
        addFlag(item.ci, item.bi, 'repeated_tool_with_structure')
      }
    })
  }

  // 3) Repeated responsibilities (high similarity across companies)
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[i].ci === items[j].ci) continue
      if (jaccard(items[i].bullet, items[j].bullet) >= 0.55) {
        addFlag(items[j].ci, items[j].bi, 'repeated_responsibility')
      }
    }
  }

  // 4) Repeated metrics
  const metricCompanies = new Map()
  for (const item of items) {
    for (const metric of item.metrics) {
      const set = metricCompanies.get(metric) || new Map()
      if (!set.has(item.ci)) set.set(item.ci, item)
      metricCompanies.set(metric, set)
    }
  }
  for (const [, companyMap] of metricCompanies) {
    if (companyMap.size < 2) continue
    const ordered = [...companyMap.entries()].sort((a, b) => a[0] - b[0])
    ordered.slice(1).forEach(([, item]) => addFlag(item.ci, item.bi, 'repeated_metric'))
  }

  // 5) Stock phrases across companies
  for (const group of STOCK_PHRASE_GROUPS) {
    const hits = items.filter((item) => group.re.test(item.bullet))
    const byCompany = new Map()
    for (const item of hits) {
      if (!byCompany.has(item.ci)) byCompany.set(item.ci, item)
    }
    if (byCompany.size >= 3) {
      [...byCompany.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(2)
        .forEach(([, item]) => addFlag(item.ci, item.bi, `repeated_stock_phrase:${group.id}`))
    }
  }

  // 6) Generic opener, OR short AND lacking substance (not short alone)
  for (const item of items) {
    if (GENERIC_RE.test(item.bullet)) {
      addFlag(item.ci, item.bi, 'too_generic_or_short')
      continue
    }
    if (item.words > 0 && item.words < 22 && lacksSubstance(item.bullet)) {
      addFlag(item.ci, item.bi, 'too_generic_or_short')
    }
  }

  // 7) Seniority mismatch
  for (const item of items) {
    const hasSenior = SENIOR_MARKERS.test(item.bullet)
    const hasJunior = JUNIOR_MARKERS.test(item.bullet)
    const hasMid = MID_MARKERS.test(item.bullet)
    if (item.seniority === 'senior' && hasJunior && !hasSenior && !hasMid) {
      addFlag(item.ci, item.bi, 'seniority_mismatch')
    }
    if (item.seniority === 'junior' && hasSenior && !hasJunior && !hasMid) {
      addFlag(item.ci, item.bi, 'seniority_mismatch')
    }
  }

  // NOTE: Do not flag for missing overlap with company research.
  // Research is industry context only and must not force project claims.

  for (const [key, reasons] of flagged) {
    const [ci, bi] = key.split(':').map(Number)
    const item = items.find((x) => x.ci === ci && x.bi === bi)
    if (!item) continue
    flags.push({
      companyIndex: ci,
      bulletIndex: bi,
      company: item.company,
      title: item.title,
      seniority: item.seniority,
      original: item.bullet,
      reasons,
      keepKeywords: keywordsInBullet(item.bullet, collectJdKeywords(jdData)),
    })
  }

  // Cap how many we send to rewrite (keep build fast / cheap)
  flags.sort((a, b) => a.companyIndex - b.companyIndex || a.bulletIndex - b.bulletIndex)
  const limited = flags.slice(0, 12)

  return {
    flags: limited,
    summary: {
      scannedBullets: items.length,
      flaggedBullets: flags.length,
      rewriteCandidates: limited.length,
    },
  }
}

function applyRewrites(resumeData, rewrites, { flags = [], jdKeywords = [] } = {}) {
  const experience = (resumeData.experience || []).map((job) => ({
    ...job,
    bullets: [...(job.bullets || [])],
  }))

  const flagMap = new Map(
    (flags || []).map((f) => [`${f.companyIndex}:${f.bulletIndex}`, f]),
  )

  let applied = 0
  let keptOriginal = 0

  for (const row of rewrites || []) {
    const ci = Number(row.companyIndex)
    const bi = Number(row.bulletIndex)
    let replacement = String(row.replacement || '').trim()
      .replace(/[–—]/g, ' ')
      .replace(/\(\s*/g, '')
      .replace(/\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!Number.isFinite(ci) || !Number.isFinite(bi) || !replacement) continue
    if (!experience[ci] || !experience[ci].bullets[bi]) continue

    const original = experience[ci].bullets[bi]
    if (normalizeText(replacement) === normalizeText(original)) continue

    const flag = flagMap.get(`${ci}:${bi}`)
    const requiredKeywords = flag?.keepKeywords?.length
      ? flag.keepKeywords
      : keywordsInBullet(original, jdKeywords)

    // If rewrite drops keywords that were in the original, keep original unless
    // those keywords remain elsewhere on the tentative resume.
    const tentative = {
      ...resumeData,
      experience: experience.map((job, jci) => (
        jci === ci
          ? { ...job, bullets: job.bullets.map((b, jbi) => (jbi === bi ? replacement : b)) }
          : job
      )),
    }
    const missingFromReplacement = requiredKeywords.filter(
      (kw) => !keywordsInBullet(replacement, [kw]).length,
    )
    const wouldLoseEntirely = missingFromReplacement.filter(
      (kw) => !keywordPresentInResume(tentative, kw),
    )
    if (wouldLoseEntirely.length) {
      keptOriginal += 1
      continue
    }

    experience[ci].bullets[bi] = replacement
    applied += 1
  }

  return {
    resumeData: { ...resumeData, experience },
    applied,
    keptOriginal,
  }
}

/**
 * After selective rewrites, restore any important JD keyword that disappeared
 * from the complete resume by reverting the responsible bullet to its original.
 */
function restoreLostKeywordCoverage(beforeResume, afterResume, flags, jdKeywords) {
  const beforeCov = collectResumeJdKeywordCoverage(beforeResume, jdKeywords)
  const afterCov = collectResumeJdKeywordCoverage(afterResume, jdKeywords)
  const lost = [...beforeCov].filter((k) => !afterCov.has(k))
  if (!lost.length) {
    return { resumeData: afterResume, restored: 0, lostKeywords: [] }
  }

  const experience = (afterResume.experience || []).map((job) => ({
    ...job,
    bullets: [...(job.bullets || [])],
  }))
  let restored = 0

  for (const flag of flags || []) {
    const ci = flag.companyIndex
    const bi = flag.bulletIndex
    if (!experience[ci]?.bullets?.[bi]) continue
    const current = experience[ci].bullets[bi]
    if (normalizeText(current) === normalizeText(flag.original)) continue

    const originalHadLost = lost.some((k) => keywordsInBullet(flag.original, jdKeywords)
      .some((kw) => normalizeText(kw) === k))
    const currentHasLost = lost.some((k) => keywordsInBullet(current, jdKeywords)
      .some((kw) => normalizeText(kw) === k))
    if (originalHadLost && !currentHasLost) {
      experience[ci].bullets[bi] = flag.original
      restored += 1
    }
  }

  const finalResume = { ...afterResume, experience }
  const finalCov = collectResumeJdKeywordCoverage(finalResume, jdKeywords)
  const stillLost = lost.filter((k) => !finalCov.has(k))
  return { resumeData: finalResume, restored, lostKeywords: stillLost }
}

/**
 * Run Experience QA + selective rewrite. Never throws to caller — returns original on failure.
 */
export async function improveJdExperienceBullets(resumeData, {
  jdData = null,
  companyContexts = [],
  projectMemories = [],
  log = () => {},
} = {}) {
  try {
    const experience = resumeData?.experience
    if (!Array.isArray(experience) || !experience.length) return resumeData

    const { flags, summary } = detectExperienceQualityIssues(resumeData, { jdData, companyContexts })
    log(`experience QA: scanned=${summary.scannedBullets} flagged=${summary.flaggedBullets} rewrite=${summary.rewriteCandidates}`)

    if (!flags.length) return resumeData

    const roleTitle = String(jdData?.roleTitle || '').trim()
    const jdKeywords = collectJdKeywords(jdData)
    const coverageBefore = collectResumeJdKeywordCoverage(resumeData, jdKeywords)
    const memoryByCompany = new Map(
      (projectMemories || [])
        .filter((m) => m?.company && m?.projectName)
        .map((m) => [String(m.company).trim().toLowerCase(), m]),
    )

    const { result } = await structuredJSON(
      `You are fixing ONLY weak Experience bullets on a JD-tailored resume.
Rewrite each flagged bullet so it stays believable for that company and seniority.

Rules (strict):
- Return a replacement for EVERY flagged bullet.
- Do NOT rewrite unflagged bullets. Do NOT change Summary or Skills.
- If an INTERNAL project memory is provided for the company, keep the rewrite inside THAT same project story (systems, users, challenges, tech, outcomes). Do not invent a second project. Every rewritten bullet must still feel like it came from the same enterprise engagement.
- Never print projectName, team size labels, deployment process blocks, or memory fields in the bullet text.
- Keep each company's project story distinct from the others.
- Preserve important JD keywords already in the original bullet (see keepKeywords) whenever natural.
- Core tools such as SQL, Python, Java, AWS, Tableau, or Oracle EBS may appear across companies — that is fine.
- industryHints are optional BACKGROUND only. Do NOT invent or name unconfirmed company projects, initiatives, or internal systems from research.
- No hyphen/dash characters or parentheses in bullets.
- Natural professional English; no robotic filler.
- Match seniority: senior=ownership/design/leadership; mid=implementation/analysis; junior=support/testing/reporting.`,
      JSON.stringify({
        targetRole: roleTitle,
        jdKeywords,
        flaggedBullets: flags.map((f) => ({
          companyIndex: f.companyIndex,
          bulletIndex: f.bulletIndex,
          company: f.company,
          title: f.title,
          seniority: f.seniority,
          reasons: f.reasons,
          original: f.original,
          keepKeywords: f.keepKeywords,
          industryHints: industryContextOnly(f.company, companyContexts)?.industryHints || [],
          projectMemory: memoryByCompany.get(String(f.company || '').trim().toLowerCase()) || null,
        })),
        otherCompanyOpeners: (resumeData.experience || []).map((job, ci) => ({
          companyIndex: ci,
          company: job.company,
          sampleOpenings: (job.bullets || []).slice(0, 3).map((b) => openingKey(b)),
        })),
      }),
      'jd_experience_quality_rewrite',
      REWRITE_SCHEMA,
      { maxTokens: 3500, preferProviders: ['claude', 'openai', 'gemini'] },
    )

    const rewrites = Array.isArray(result?.rewrites) ? result.rewrites : []
    if (!rewrites.length) {
      log('experience QA: model returned no rewrites — keeping originals')
      return resumeData
    }

    const { resumeData: rewritten, applied, keptOriginal } = applyRewrites(resumeData, rewrites, {
      flags,
      jdKeywords,
    })
    const { resumeData: finalResume, restored, lostKeywords } = restoreLostKeywordCoverage(
      resumeData,
      rewritten,
      flags,
      jdKeywords,
    )
    const coverageAfter = collectResumeJdKeywordCoverage(finalResume, jdKeywords)
    log(
      `experience QA: applied=${applied} keptOriginalForKeywords=${keptOriginal}`
      + ` restored=${restored} keywordCoverage=${coverageAfter.size}/${coverageBefore.size}`
      + (lostKeywords.length ? ` stillLost=${lostKeywords.join('|')}` : ''),
    )
    return finalResume
  } catch (err) {
    log(`experience QA failed (keeping originals): ${err.message}`)
    return resumeData
  }
}
