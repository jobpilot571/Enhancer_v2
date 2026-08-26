import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { structuredJSON } from './aiProvider.js'

/**
 * Limited test: rewrite at most 1–2 weak / JD-misaligned experience bullets
 * per company using that company's projectContext.
 *
 * Does not touch Summary, Skills, new bullet additions, the main enhancement
 * plan prompt, formatting, scoring, or DOCX logic. Fail-soft: on missing
 * context or LLM failure, the existing plan is returned unchanged.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../.cache')
const LAST_FILE = path.join(CACHE_DIR, 'last-project-context-rewrites.json')

export const MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY = 2

const GENERIC_RE = /\b(responsible for|duties included|various tasks|multiple tasks|day[- ]to[- ]day|as needed|ad hoc|helped (the )?team|assisted (with|in)|participated in|involved in|worked on|gained exposure|supported the team|various|several)\b/i

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          original: { type: 'string' },
          replacement: { type: 'string' },
          jdRequirementUsed: { type: 'string' },
          projectElementUsed: { type: 'string' },
        },
        required: ['company', 'original', 'replacement', 'jdRequirementUsed', 'projectElementUsed'],
        additionalProperties: false,
      },
    },
  },
  required: ['rewrites'],
  additionalProperties: false,
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function sameText(a, b) {
  return Boolean(norm(a)) && norm(a) === norm(b)
}

function isSummaryCompany(company) {
  const c = norm(company)
  return !c || c === 'summary' || c === 'professional summary'
}

function ratingKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function isStrongRating(rating) {
  const key = ratingKey(rating)
  return key === 'perfect' || key === 'good'
}

function isWeakRating(rating) {
  const key = ratingKey(rating)
  return key === 'weak' || key === 'veryweak' || key === 'irrelevant'
}

function clampBullet(text, maxChars = 175) {
  let t = String(text || '').replace(/^[\s•●○\-–—*]+/, '').trim()
  if (!t) return ''
  t = t.replace(/\s+(and|or|with|using|via|for|to|of|in)\s*[.,;:]*$/i, '').trim()
  if (!/[.!?]$/.test(t)) t = `${t}.`
  if (t.length <= maxChars) return t
  const cut = t.slice(0, maxChars)
  const at = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','), cut.lastIndexOf(' '))
  let trimmed = (at > 80 ? cut.slice(0, at) : cut).trim().replace(/[,;:\-–—]+$/, '')
  trimmed = trimmed.replace(/\s+(and|or|with|using|via|for|to|of|in)$/i, '').trim()
  return `${trimmed}.`
}

function uniqueTerms(items) {
  const out = []
  const seen = new Set()
  for (const item of items || []) {
    const raw = String(item || '').trim()
    const key = norm(raw)
    if (!raw || key.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

function jdTerms(jdData, comparison) {
  return uniqueTerms([
    ...(jdData?.requiredSkills || []),
    ...(jdData?.preferredSkills || []),
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.domainKeywords || []),
    ...(comparison?.missingHardSkills || []),
    ...(comparison?.present || []),
    ...(comparison?.report?.missingRequiredSkills || []),
    ...(comparison?.report?.missingTools || []),
  ]).slice(0, 36)
}

function jdResponsibilities(jdData, comparison) {
  return uniqueTerms([
    ...(jdData?.responsibilities || []),
    ...(comparison?.missingResponsibilities || []),
    ...(comparison?.report?.missingResponsibilities || []),
  ]).slice(0, 12)
}

function termHits(bullet, terms) {
  const text = norm(bullet)
  if (!text) return []
  return (terms || []).filter((term) => {
    const t = norm(term)
    if (t.length < 3) return false
    return text.includes(t)
  })
}

function responsibilityOverlap(bullet, phrase) {
  const b = norm(bullet)
  const p = norm(phrase)
  if (!b || !p) return 0
  if (b.includes(p) || (p.length > 12 && p.includes(b))) return 1
  const tokens = p.split(' ').filter((t) => t.length > 3)
  if (!tokens.length) return 0
  return tokens.filter((t) => b.includes(t)).length / tokens.length
}

function bestResponsibility(bullet, responsibilities) {
  let best = { phrase: '', overlap: 0 }
  for (const phrase of responsibilities || []) {
    const overlap = responsibilityOverlap(bullet, phrase)
    if (overlap > best.overlap) best = { phrase, overlap }
  }
  return best
}

/**
 * Local weakness / JD-misalignment score. Lower = weaker / worse JD fit.
 * Strong bullets score high and must not be selected.
 */
export function scoreBulletAgainstJd(bullet, jdData, comparison) {
  const text = String(bullet || '').trim()
  const terms = jdTerms(jdData, comparison)
  const responsibilities = jdResponsibilities(jdData, comparison)
  const hits = termHits(text, terms)
  const resp = bestResponsibility(text, responsibilities)
  const generic = GENERIC_RE.test(text)
  const words = text.split(/\s+/).filter(Boolean).length
  const hasMetric = /\d/.test(text)

  let score = 20
  score += Math.min(54, hits.length * 18)
  score += Math.round(resp.overlap * 40)
  if (hasMetric) score += 8
  if (words >= 14) score += 8
  if (generic) score -= 22
  if (words < 8) score -= 15
  if (!hits.length && resp.overlap < 0.25) score -= 18
  score = Math.max(0, Math.min(100, score))

  return {
    score,
    jdTermHits: hits,
    bestResponsibility: resp.phrase,
    responsibilityOverlap: resp.overlap,
    generic,
    wordCount: words,
  }
}

function evaluationMap(plan) {
  const map = new Map()
  for (const ev of plan?.bulletEvaluations || []) {
    if (isSummaryCompany(ev.company) || !ev.original) continue
    map.set(`${norm(ev.company)}::${norm(ev.original)}`, ev.rating)
  }
  return map
}

function matchProjectContext(projectContexts, company) {
  const name = norm(company)
  if (!name) return null
  return (projectContexts || []).find((row) => norm(row.company) === name)
    || (projectContexts || []).find((row) => {
      const c = norm(row.company)
      return c && (name.includes(c) || c.includes(name.slice(0, 8)))
    })
    || null
}

function pickJdRequirement(bullet, ctx, jdData, comparison, local) {
  const fromCtx = (ctx?.jdRequirementsThatFit || []).map(String).filter(Boolean)
  const pool = uniqueTerms([...fromCtx, ...jdResponsibilities(jdData, comparison)])
  if (local?.bestResponsibility) {
    const hit = pool.find((p) => norm(p) === norm(local.bestResponsibility))
    if (hit) return hit
  }
  let best = { phrase: pool[0] || '', overlap: 0 }
  for (const phrase of pool) {
    const overlap = Math.max(
      responsibilityOverlap(bullet, phrase),
      termHits(bullet, [phrase]).length ? 0.5 : 0,
    )
    if (overlap > best.overlap) best = { phrase, overlap }
  }
  return best.phrase || fromCtx[0] || (jdData?.responsibilities || [])[0] || ''
}

function pickProjectElement(bullet, ctx) {
  const options = uniqueTerms([
    ctx?.product,
    ctx?.projectName,
    ...(ctx?.workflows || []),
    ...(ctx?.integrations || []),
    ctx?.systemPurpose,
  ])
  let best = options[0] || ctx?.product || ctx?.projectName || ''
  let bestHits = -1
  for (const option of options) {
    const hits = termHits(bullet, option.split(/[;,]/)).length
    const overlap = responsibilityOverlap(bullet, option)
    const score = hits + overlap
    if (score > bestHits) {
      bestHits = score
      best = option
    }
  }
  return best
}

function reasonForSelection(rating, local) {
  const parts = []
  if (isWeakRating(rating)) {
    parts.push(`plan rated ${String(rating).replace(/veryweak/i, 'VeryWeak')}`)
  }
  if (local.generic) parts.push('generic / filler phrasing')
  if (!local.jdTermHits.length) parts.push('no JD skills/tools in the original')
  else if (local.jdTermHits.length === 1) parts.push('thin JD skill coverage')
  if (local.responsibilityOverlap < 0.25) parts.push('weak JD responsibility fit')
  if (local.wordCount < 8) parts.push('too thin to show real project work')
  if (!parts.length) parts.push(`low local JD alignment (score ${local.score})`)
  return parts.join('; ')
}

/**
 * Pick at most 2 weak or JD-misaligned original bullets per company.
 * Perfect / Good (and locally strong) bullets are never selected.
 */
export function selectWeakExperienceBullets(resumeData, jdData, comparison, projectContexts, plan) {
  const evals = evaluationMap(plan)
  const selected = []

  for (const job of resumeData?.experience || []) {
    const company = String(job.company || '').trim()
    if (!company) continue
    const ctx = matchProjectContext(projectContexts, company)
    if (!ctx?.projectName && !ctx?.product) continue

    const bullets = (job.bullets || []).map((b) => String(b || '').trim()).filter(Boolean)
    const candidates = []

    for (const bullet of bullets) {
      const rating = evals.get(`${norm(company)}::${norm(bullet)}`) || ''
      if (isStrongRating(rating)) continue

      const local = scoreBulletAgainstJd(bullet, jdData, comparison)
      // Locally strong → do not rewrite, even if the plan tagged Weak
      if (local.score >= 70) continue

      const planWeak = isWeakRating(rating)
      const locallyMisaligned = local.jdTermHits.length === 0 && (local.generic || local.responsibilityOverlap < 0.25)
      const locallyWeak = local.score < 40

      if (!planWeak && !locallyMisaligned && !locallyWeak) continue

      candidates.push({
        company,
        role: String(job.title || job.role || '').trim(),
        original: bullet,
        rating: rating || 'local',
        local,
        reasonSelected: reasonForSelection(rating, local),
        jdRequirementUsed: pickJdRequirement(bullet, ctx, jdData, comparison, local),
        projectElementUsed: pickProjectElement(bullet, ctx),
        siblingBullets: bullets.filter((b) => !sameText(b, bullet)).slice(0, 6),
        projectContext: ctx,
      })
    }

    candidates.sort((a, b) => {
      const rank = (c) => {
        const key = ratingKey(c.rating)
        if (key === 'irrelevant') return 0
        if (key === 'veryweak') return 1
        if (key === 'weak') return 2
        return 3
      }
      const byRating = rank(a) - rank(b)
      if (byRating !== 0) return byRating
      return a.local.score - b.local.score
    })

    selected.push(...candidates.slice(0, MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY))
  }

  return selected
}

function compactContext(ctx) {
  if (!ctx) return null
  return {
    company: ctx.company,
    role: ctx.role,
    industry: ctx.industry,
    businessProblem: ctx.businessProblem,
    projectName: ctx.projectName,
    product: ctx.product,
    systemPurpose: ctx.systemPurpose,
    architecture: ctx.architecture,
    workflows: ctx.workflows,
    technologies: ctx.technologies,
    integrations: ctx.integrations,
    candidateResponsibilities: ctx.candidateResponsibilities,
    productionEnvironment: ctx.productionEnvironment,
    operationalChallenges: ctx.operationalChallenges,
    jdRequirementsThatFit: ctx.jdRequirementsThatFit,
  }
}

function systemPrompt() {
  return `You rewrite a SMALL number of weak resume experience bullets using an internal enterprise project context.

Rules (strict):
- Rewrite ONLY the provided original bullets. Do not add new bullets. Do not rewrite strong bullets you were not given.
- At most 2 rewrites per company. Return one replacement per provided original.
- The replacement MUST come from that company's project context (product, workflows, architecture, responsibilities).
- Match one JD requirement naturally — do not keyword-stuff.
- Show real project/workflow involvement: system + what the candidate did + tools/methods + a realistic outcome.
- Be technical and specific. Avoid generic AI wording (assisted with, leveraged, utilized, various, successfully, spearheaded, results-driven).
- Stay consistent with the company's other (untouched) bullets: same systems, domain, and seniority.
- Use numbers/metrics ONLY if they already appear in the original bullet or the project context. Never invent new %, time saved, user counts, revenue, or awards.
- Do not invent unsupported achievements, customers, tools, or systems.
- Do not print internal-only project labels if the resume already names the product/system — use the resume's naming.
- One complete sentence, about 20–30 words, ending with a period. No bullet glyph.
- Keep the original meaning's ownership level; do not promote the candidate to a new title.`
}

function mergeRewrites(plan, overlays) {
  const rewrites = [...(plan.bulletRewrites || [])]
  const perCompany = new Map()

  for (const overlay of overlays) {
    if (isSummaryCompany(overlay.company)) continue
    const key = norm(overlay.company)
    const used = perCompany.get(key) || 0
    if (used >= MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY) continue
    const original = String(overlay.original || '').trim()
    const replacement = clampBullet(overlay.replacement)
    if (!original || !replacement || sameText(original, replacement)) continue

    const idx = rewrites.findIndex((r) => (
      !isSummaryCompany(r.company)
      && norm(r.company) === key
      && sameText(r.original, original)
    ))
    const entry = {
      company: overlay.company,
      original,
      replacement,
      source: 'project_context',
    }
    if (idx >= 0) rewrites[idx] = { ...rewrites[idx], ...entry }
    else rewrites.push(entry)
    perCompany.set(key, used + 1)
  }

  return { ...plan, bulletRewrites: rewrites }
}

export function logProjectContextRewrites(logFn, overlays, meta = {}) {
  if (meta.skipped) {
    logFn(`project-context experience overlay skipped (${meta.skipReason || 'unknown'}) — existing enhancer unchanged`)
    return
  }
  if (!overlays?.length) {
    logFn('project-context experience overlay: no weak/JD-misaligned bullets selected (max 2/company)')
    return
  }
  logFn(
    `project-context experience overlay: ${overlays.length} rewrite(s), hard max ${MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY}/company`,
  )
  overlays.forEach((row, i) => {
    logFn(`--- project-context rewrite ${i + 1}/${overlays.length} @ ${row.company} ---`)
    logFn(`  selected because: ${row.reasonSelected}`)
    logFn(`  project context: ${row.projectElementUsed || '(none)'}`)
    logFn(`  jd requirement: ${row.jdRequirementUsed || '(none)'}`)
    logFn(`  original: ${row.original}`)
    logFn(`  rewritten: ${row.replacement}`)
  })
}

function saveRewriteSnapshot(payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(LAST_FILE, JSON.stringify(payload, null, 2))
    if (payload.sessionId) {
      fs.writeFileSync(
        path.join(CACHE_DIR, `project-context-rewrites-${payload.sessionId}.json`),
        JSON.stringify(payload, null, 2),
      )
    }
    console.log(`[project-context-rewrite] snapshot → ${LAST_FILE}`)
  } catch (err) {
    console.warn('[project-context-rewrite] snapshot write failed:', err.message)
  }
}

export function getLastProjectContextRewriteSnapshot() {
  try {
    if (!fs.existsSync(LAST_FILE)) return null
    return JSON.parse(fs.readFileSync(LAST_FILE, 'utf8'))
  } catch {
    return null
  }
}

function skippedResult(plan, reason, options = {}) {
  const meta = {
    skipped: true,
    skipReason: reason,
    maxPerCompany: MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY,
    rewriteCount: 0,
    perCompany: {},
    rewrites: [],
  }
  saveRewriteSnapshot({
    savedAt: new Date().toISOString(),
    sessionId: options.sessionId || null,
    jobId: options.jobId || null,
    ...meta,
  })
  return { plan, rewrites: [], meta }
}

/**
 * Overlay 1–2 project-context rewrites onto an already-built enhancement plan.
 * Never mutates Summary / Skills / experienceAdditions.
 *
 * @returns {Promise<{ plan: object, rewrites: object[], meta: object }>}
 */
export async function applyProjectContextExperienceOverlay(
  plan,
  resumeData,
  jdData,
  comparison,
  projectContexts,
  options = {},
) {
  if (!plan || typeof plan !== 'object') {
    return skippedResult(plan, 'no_plan', options)
  }
  if (!Array.isArray(projectContexts) || !projectContexts.length) {
    return skippedResult(plan, 'no_project_context', options)
  }

  const selected = selectWeakExperienceBullets(
    resumeData,
    jdData,
    comparison,
    projectContexts,
    plan,
  )
  if (!selected.length) {
    return skippedResult(plan, 'no_weak_bullets', options)
  }

  const payload = selected.map((row) => ({
    company: row.company,
    role: row.role,
    original: row.original,
    reasonSelected: row.reasonSelected,
    suggestedJdRequirement: row.jdRequirementUsed,
    suggestedProjectElement: row.projectElementUsed,
    siblingBullets: row.siblingBullets,
    projectContext: compactContext(row.projectContext),
  }))

  try {
    const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
      await structuredJSON(
        systemPrompt(),
        JSON.stringify({
          targetRole: jdData?.roleTitle || '',
          jdResponsibilities: (jdData?.responsibilities || []).slice(0, 10),
          jdSkillsAndTools: jdTerms(jdData, comparison).slice(0, 18),
          bulletsToRewrite: payload,
          hardMaxPerCompany: MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY,
        }),
        'project_context_experience_overlay',
        REWRITE_SCHEMA,
        {
          maxTokens: 2200,
          preferProviders: ['groq'],
        },
      )

    console.log(
      `[AI] project_context_experience_overlay via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    const llmRows = Array.isArray(result?.rewrites) ? result.rewrites : []
    const allowed = new Map(
      selected.map((row) => [`${norm(row.company)}::${norm(row.original)}`, row]),
    )
    const usedPerCompany = new Map()
    const overlays = []

    for (const raw of llmRows) {
      const key = `${norm(raw.company)}::${norm(raw.original)}`
      const selectedRow = allowed.get(key)
        || selected.find((row) => (
          norm(row.company) === norm(raw.company) && sameText(row.original, raw.original)
        ))
      if (!selectedRow) continue
      const companyKey = norm(selectedRow.company)
      const used = usedPerCompany.get(companyKey) || 0
      if (used >= MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY) continue
      const replacement = clampBullet(raw.replacement)
      if (!replacement || sameText(selectedRow.original, replacement)) continue
      usedPerCompany.set(companyKey, used + 1)
      overlays.push({
        company: selectedRow.company,
        original: selectedRow.original,
        replacement,
        reasonSelected: selectedRow.reasonSelected,
        jdRequirementUsed: String(raw.jdRequirementUsed || selectedRow.jdRequirementUsed || '').trim(),
        projectElementUsed: String(raw.projectElementUsed || selectedRow.projectElementUsed || '').trim(),
        rating: selectedRow.rating,
        localScore: selectedRow.local.score,
      })
    }

    if (!overlays.length) {
      return skippedResult(plan, 'llm_empty', options)
    }

    const nextPlan = mergeRewrites(plan, overlays)
    const perCompany = {}
    for (const row of overlays) {
      perCompany[row.company] = (perCompany[row.company] || 0) + 1
    }
    const meta = {
      skipped: false,
      skipReason: null,
      maxPerCompany: MAX_PROJECT_CONTEXT_REWRITES_PER_COMPANY,
      rewriteCount: overlays.length,
      perCompany,
      rewrites: overlays,
    }
    saveRewriteSnapshot({
      savedAt: new Date().toISOString(),
      sessionId: options.sessionId || null,
      jobId: options.jobId || null,
      ...meta,
    })
    return { plan: nextPlan, rewrites: overlays, meta }
  } catch (err) {
    console.warn(`[AI] project_context_experience_overlay failed (existing enhancer unchanged): ${err.message}`)
    return skippedResult(plan, 'llm_failed', options)
  }
}
