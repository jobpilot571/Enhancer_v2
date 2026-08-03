import { structuredJSON } from './aiProvider.js'
import { cleanJobDescription, getCachedJdAnalysis, setCachedJdAnalysis } from './jdCleaner.js'
import { extractKnownToolsFromText } from './scoringDictionary.js'

/**
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {string[]} [options.preferProviders]
 * @param {string[]} [options.providersOnly]
 * @returns {Promise<object>} parsed JSON result (diagnostics stay on AI usage log)
 */
async function jsonCompletion(systemPrompt, userPrompt, schemaName, schema, options = {}) {
  const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
    await structuredJSON(systemPrompt, userPrompt, schemaName, schema, options)
  console.log(
    `[AI] ${schemaName} via ${provider}/${model} `
    + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
  )
  return result
}

const RESUME_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    location: { type: 'string' },
    summary: { type: 'string' },
    summaryBullets: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    technicalSkills: { type: 'array', items: { type: 'string' } },
    headings: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          dates: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['company', 'title', 'dates', 'bullets'],
        additionalProperties: false,
      },
    },
    projects: { type: 'array', items: { type: 'string' } },
    education: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
    allSections: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'email', 'phone', 'location', 'summary', 'summaryBullets', 'skills', 'technicalSkills', 'headings', 'experience', 'projects', 'education', 'certifications', 'allSections'],
  additionalProperties: false,
}

const JD_SCHEMA = {
  type: 'object',
  properties: {
    roleTitle: { type: 'string' },
    hiringCompany: { type: 'string' },
    yearsRequired: { type: 'number' },
    requiredSkills: { type: 'array', items: { type: 'string' } },
    preferredSkills: { type: 'array', items: { type: 'string' } },
    responsibilities: { type: 'array', items: { type: 'string' } },
    toolsTechnologies: { type: 'array', items: { type: 'string' } },
    domainKeywords: { type: 'array', items: { type: 'string' } },
    mustHaveKeywords: { type: 'array', items: { type: 'string' } },
    niceToHaveKeywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['roleTitle', 'hiringCompany', 'yearsRequired', 'requiredSkills', 'preferredSkills', 'responsibilities', 'toolsTechnologies', 'domainKeywords', 'mustHaveKeywords', 'niceToHaveKeywords'],
  additionalProperties: false,
}

/** Compact enhancement output — maps to internal plan via normalizeEnhancementPlan */
const COMPACT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summaryRewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
        },
        required: ['original', 'replacement'],
        additionalProperties: false,
      },
    },
    experienceRewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          original: { type: 'string' },
          replacement: { type: 'string' },
          rating: {
            type: 'string',
            enum: ['Perfect', 'Good', 'Weak', 'VeryWeak', 'Irrelevant'],
          },
        },
        required: ['company', 'original', 'replacement', 'rating'],
        additionalProperties: false,
      },
    },
    skillAdditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'skills'],
        additionalProperties: false,
      },
    },
  },
  required: ['summaryRewrites', 'experienceRewrites', 'skillAdditions'],
  additionalProperties: false,
}

/**
 * BEFORE rewriting: compare every experience bullet to the JD and classify it.
 * Only Weak / Very Weak / Irrelevant bullets should become experienceRewrites.
 */
const BULLET_EVALUATION_RULES = `Experience bullet evaluation (do this FIRST for EVERY existing experience bullet):

Score each original bullet against the job description on:
1) Technical depth (tools, methods, systems — not vague soft language)
2) Match to JD responsibilities (does it support what this job needs done?)
3) Business value (why it mattered to the company/users/stakeholders)
4) Measurable impact (%, time, volume, users, revenue, quality — when realistic)
5) Useful JD skills/keywords woven naturally (not stuffed)
6) Natural, professional, human tone
7) Realistic for that role, seniority, company, and project story
8) Ownership, collaboration, or leadership signal when appropriate
9) Company / industry specificity (sounds like work at THAT employer, not a generic template)

Classify EVERY existing experience bullet as exactly one of:
- Perfect — strong JD fit, technical, impactful, company-specific. KEEP UNCHANGED. Do NOT emit a rewrite.
- Good — solid fit with only minor gaps. KEEP UNCHANGED unless a tiny polish is truly necessary.
- Weak — thin JD relevance, weak technical depth, generic phrasing, or weak impact. REWRITE to improve JD fit, project story, and impact while keeping the same project/system story.
- VeryWeak — generic, vague, or poorly aligned. STRONGLY rewrite or replace with a stronger bullet that still fits that company/role/story.
- Irrelevant — does not support the target job. REMOVE (omit from output) or REPLACE only when it cannot support the JD; otherwise rewrite into a relevant achievement for that role.

Rewrite policy (strict):
- Perfect → do not rewrite; do not list in experienceRewrites.
- Good → usually do not rewrite; only list if a very small improvement is necessary (keep meaning identical).
- Weak → must rewrite (original = EXACT existing text, replacement = improved bullet, rating="Weak").
- VeryWeak → must strongly rewrite or replace (original = EXACT existing text, rating="VeryWeak").
- Irrelevant → replace with a JD-aligned bullet for that company OR omit (rating="Irrelevant").
- Prefer rewriting Weak/VeryWeak bullets that leave gaps.responsibilities uncovered — strong JD match (target enhanced ATS 85–99) is the goal.
- Mission: get the resume SELECTED for this JD. Prefer covering every major JD responsibility and skill across experience bullets.
- You MAY introduce JD skills/tools/keywords into bullets even if not previously listed — frame them as work done in that company/role context.
- Do NOT copy sentences from the job description verbatim.
- Keep company context, role level, and a coherent project story (reuse named systems when present).
- Prefer covering one important JD responsibility + 1–2 relevant JD skills per rewritten/new bullet.
- Avoid repeating the same skills, technologies, responsibilities, and action verbs across bullets.
- Stronger responsibility coverage in experience matters more than stuffing the skills section alone.
- OUTPUT SIZE LIMIT: emit at most 14 experienceRewrites total (prefer the weakest bullets first). At least 1 NEW bullet (original="") for EACH company when gaps remain. At most 3 NEW bullets per company. Never list Perfect bullets. Keep JSON compact.`

const BULLET_RULES = `Bullet writing rules (strict — apply when writing NEW or REWRITTEN bullets):
- Write like a human professional telling a real project story — not AI filler or generic BA templates.
- Story structure: Situation/system at that company → your action → tools/methods → business outcome.
- Real-time project involvement: what YOU did, at WHICH company domain, on WHICH system/initiative, with WHAT stakeholders, using WHICH tools, with WHAT result.
- Company + industry alignment: use companyContexts (industry, products, initiatives, systems) to frame the story in that employer's world.
- When adding NEW bullets (original=""): cover an uncovered gaps.responsibilities item for that company. Reuse named systems/projects from existing bullets when present; otherwise use a plausible initiative from companyContexts.
- Be technical and specific: name tools from the JD (SQL, Power BI, Azure DevOps, ERP, Jira, etc.), methods, and deliverables.
- EACH rewritten/new bullet MUST map to at least one gaps.responsibilities item and weave 1–2 gaps.missingSkills or JD tools naturally.
- Selection mission: include JD skills/tools even if the original resume omitted them — phrase as experience in that role/company.
- Include measurable impact where believable (%, time, volume, users) — prefer metrics for stronger ATS impact score.
- Use strong action verbs (Led, Built, Designed, Automated, Optimized, Delivered) — vary verbs across bullets.
- Each bullet MUST be a complete sentence ending with a period — never truncate mid-phrase (no endings like "and using." or "improving transparency and.").
- Each bullet: one clear achievement, about 20–30 words / 1–2 lines.
- Do NOT start bullets with a bullet character (•). Plain sentence text only.
- skillAdditions: ONLY concrete tools/platforms (SQL, Jira, Azure DevOps, Power BI, Tableau, Salesforce). NEVER soft fluff (Iterative, facilitation skills, reporting, customer service).
- Reject generic lines like "Delivered analysis and reporting to support decisions" unless tied to a named system, company domain, and JD skill.`

/** Stricter rules for JD-tailored resume builds. */
const JD_BULLET_RULES = `Experience and summary bullet rules (strict — follow ALL):
- Think like an intelligent senior resume strategist: every bullet must earn its place with real project ownership, technical depth, and business impact.
- Write like a strong working professional: humanized, natural, advanced, modern, aggressive, impressive, and professional. NEVER robotic, generic, or AI filler.
- MOST bullets MUST be EXACTLY two FULL lines when rendered (target 32–40 words). Never one-liners.
- For Company #1 (most recent) and Company #2: the FIRST 2–3 bullets MUST be THREE full lines (target 48–58 words) with deeper project ownership, tools, and outcomes. Remaining bullets for those companies stay two lines (32–40 words).
- Companies #3+ : all bullets two lines (32–40 words).
- Every bullet must be meaningful: name the project or system, your concrete actions, tools/methods used, and a clear outcome or metric when believable.
- Technical and current-market: use modern platforms, pipelines, analytics, cloud, automation, and delivery practices that hiring managers expect now.
- EACH experience bullet MUST weave in at least ONE JD skill/tool/keyword naturally, and often a stronger adjacent advanced skill beyond the JD minimum.
- Do NOT use hyphen/dash characters (-) or parentheses () inside bullets. Use combining words instead, e.g. "JSON, XML, and CSV" not "(JSON, XML, CSV)"; "SQL based reporting" not "SQL-based reporting".
- Do NOT start with a bullet character. Plain sentence text only — the document formatter adds real Word bullets.
- Sound like real-time experience from someone who lived the project, not a template.
- No color instructions — content only. Do not bold or highlight keywords in the text.`

function normalizeRating(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (raw === 'perfect') return 'Perfect'
  if (raw === 'good') return 'Good'
  if (raw === 'weak') return 'Weak'
  if (raw === 'veryweak') return 'Very Weak'
  if (raw === 'irrelevant') return 'Irrelevant'
  return ''
}

function sameBulletText(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  return Boolean(norm(a)) && norm(a) === norm(b)
}

/**
 * Normalize compact LLM plan into the shape expected by filterEnhancementPlan / patchDocx.
 * Empty original + non-empty replacement => new addition (summary or experience).
 */
export function normalizeEnhancementPlan(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      strategy: '',
      summaryBullets: [],
      experienceAdditions: [],
      skillsByCategory: [],
      skillsToAdd: [],
      bulletRewrites: [],
      bulletEvaluations: [],
      keywordsAdded: [],
      rationale: '',
    }
  }

  // Already in legacy / internal shape
  if (
    Array.isArray(raw.summaryBullets)
    || Array.isArray(raw.experienceAdditions)
    || Array.isArray(raw.skillsByCategory)
  ) {
    return {
      strategy: raw.strategy || '',
      summaryBullets: raw.summaryBullets || [],
      experienceAdditions: raw.experienceAdditions || [],
      skillsByCategory: raw.skillsByCategory || [],
      skillsToAdd: raw.skillsToAdd || [],
      bulletRewrites: raw.bulletRewrites || [],
      bulletEvaluations: raw.bulletEvaluations || [],
      keywordsAdded: raw.keywordsAdded || [],
      rationale: raw.rationale || '',
    }
  }

  const summaryBullets = []
  const bulletRewrites = []
  for (const r of raw.summaryRewrites || []) {
    const original = String(r.original || '').trim()
    const replacement = String(r.replacement || '').trim()
    if (!replacement) continue
    if (original) {
      bulletRewrites.push({ company: 'Summary', original, replacement })
    } else {
      summaryBullets.push(replacement)
    }
  }

  const byCompany = new Map()
  const bulletEvaluations = []
  let rewriteCount = 0
  for (const r of raw.experienceRewrites || []) {
    const company = String(r.company || '').trim()
    if (!company) continue
    const original = String(r.original || '').trim()
    const replacement = String(r.replacement || '').trim()
    if (!replacement) continue
    const rating = normalizeRating(r.rating)

    if (original) {
      // Perfect: never rewrite. Good: keep unless a real (non-identical) tiny polish.
      if (rating === 'Perfect') continue
      if (rating === 'Good' && sameBulletText(original, replacement)) continue
      if (sameBulletText(original, replacement)) continue
      if (rewriteCount >= 14) continue
      bulletRewrites.push({ company, original, replacement })
      rewriteCount += 1
      if (rating) {
        bulletEvaluations.push({ company, original, rating, action: 'rewrite' })
      }
    } else {
      const list = byCompany.get(company) || []
      if (list.length >= 3) continue
      list.push(replacement)
      byCompany.set(company, list)
      if (rating) {
        bulletEvaluations.push({ company, original: '', rating, action: 'add' })
      }
    }
  }

  const experienceAdditions = [...byCompany.entries()].map(([company, bullets]) => ({
    company,
    bullets,
  }))

  return {
    strategy: '',
    summaryBullets: summaryBullets.slice(0, 3),
    experienceAdditions,
    skillsByCategory: raw.skillAdditions || [],
    skillsToAdd: [],
    bulletRewrites,
    bulletEvaluations,
    keywordsAdded: [],
    rationale: '',
  }
}

/** True when the plan object is structurally usable (empty arrays are OK). */
export function isPlanTechnicallyValid(plan) {
  if (!plan || typeof plan !== 'object') return false
  const hasArrays =
    Array.isArray(plan.summaryBullets)
    && Array.isArray(plan.experienceAdditions)
    && Array.isArray(plan.skillsByCategory)
    && Array.isArray(plan.bulletRewrites)
  return hasArrays
}

export async function parseResume(resumeText) {
  return jsonCompletion(
    `You are a resume parsing expert. Extract ALL structured data from the resume text. Include every section, heading, bullet, skill, company, title, and date. Return complete JSON.
For SUMMARY/PROFILE/OBJECTIVE:
- If the summary is a prose paragraph (not a bullet list), put the full text in "summary" and leave summaryBullets as [].
- If the summary is a bullet list, put each bullet in summaryBullets and put a short joined overview in "summary".
Never invent bullets from a paragraph summary.`,
    `Parse this resume:\n\n${String(resumeText || '').slice(0, 12000)}`,
    'resume_parse',
    RESUME_SCHEMA,
    { maxTokens: 2500 },
  )
}

function enrichJdWithExtractedTools(jdData, jdText) {
  if (!jdData || typeof jdData !== 'object') return jdData
  const extracted = extractKnownToolsFromText(jdText)
  if (!extracted.length) return jdData
  const merge = (arr) => [...new Set([...(arr || []), ...extracted].map((s) => String(s).trim()).filter(Boolean))]
  return {
    ...jdData,
    toolsTechnologies: merge(jdData.toolsTechnologies).slice(0, 28),
    requiredSkills: merge(jdData.requiredSkills).slice(0, 28),
    preferredSkills: [...new Set([...(jdData.preferredSkills || []), ...extracted])].slice(0, 20),
  }
}

/**
 * Analyze a cleaned JD (or raw — will clean). Uses disk/memory cache by content hash.
 * @returns {{ data: object, cached: boolean, cacheKey: string, source: string|null }}
 */
export async function analyzeJd(jdText) {
  const cleaned = cleanJobDescription(jdText)
  const cached = getCachedJdAnalysis(jdText)
  if (cached.data) {
    console.log(`[AI] jd_analysis cache hit (${cached.source}) key=${cached.key.slice(0, 12)}`)
    return {
      data: enrichJdWithExtractedTools(cached.data, cleaned),
      cached: true,
      cacheKey: cached.key,
      source: cached.source,
    }
  }

  const data = await jsonCompletion(
    `Extract structured hiring signal from this cleaned job description.
Return ONLY JSON. Keep lists short and concrete (skills/tools as short names, not sentences).
roleTitle: the primary job title being hired for.
hiringCompany: the employer / company posting this job (short legal or brand name). Use "" if unclear.
yearsRequired: minimum years of experience required as a number (use 0 if not stated). Prefer the minimum when a range is given (e.g. "5-7 years" → 5, "5+ years" → 5).
Always include concrete tools/platforms named in the JD (e.g. Agentforce, Cursor, Claude, Apex, LangChain, Snowflake, Databricks, BigQuery, Salesforce Data 360, Python, TypeScript, Java).
Ignore any residual salary, benefits, location, EEO, or apply instructions.`,
    `Cleaned JD:\n${cleaned.slice(0, 6000)}`,
    'jd_analysis',
    JD_SCHEMA,
    { maxTokens: 1200, preferProviders: ['claude'] },
  )

  const enriched = enrichJdWithExtractedTools(data, cleaned)
  const cacheKey = setCachedJdAnalysis(jdText, enriched)
  return { data: enriched, cached: false, cacheKey, source: null }
}

/** @deprecated Prefer analyzeJd — kept for callers that expect bare JD object */
export async function parseJD(jdText) {
  const { data } = await analyzeJd(jdText)
  return data
}

/**
 * One-shot complete enhancement plan. Empty arrays are valid — do not repair for emptiness.
 * @param {object[]} [companyContexts] — optional Groq/AI company-industry grounding
 */
export async function createEnhancementPlan(resumeData, jdData, comparison, companyContexts = []) {
  const companies = (resumeData.experience || []).map((e) => e.company).filter(Boolean)
  const missingKeywords = [
    ...(comparison.missingKeywords || []),
    ...(comparison.report?.missingKeywords || []),
  ].filter(Boolean)
  // Hard skills/tools only — never merge domain keywords into the skills gap list
  const missingHard = [
    ...(comparison.missingHardSkills || []),
    ...(comparison.report?.missingRequiredSkills || []),
    ...(comparison.report?.missingTools || []),
  ].filter(Boolean)

  const allowedVocab = [
    ...new Set([
      ...missingKeywords,
      ...(jdData.domainKeywords || []),
      ...(jdData.mustHaveKeywords || []),
      ...(jdData.requiredSkills || []),
      ...(jdData.toolsTechnologies || []),
      ...missingHard,
    ]),
  ].slice(0, 28)

  const summaryFormat = (resumeData.summaryFormat || (
    (!(resumeData.summaryBullets || []).length && (resumeData.summary || '').trim()
      ? 'paragraph'
      : 'bullets')
  ))

  const compactResume = {
    summaryFormat,
    summary: (resumeData.summary || '').slice(0, 400),
    summaryBullets: (resumeData.summaryBullets || []).slice(0, 6),
    skills: [...new Set([
      ...(resumeData.skills || []),
      ...(resumeData.technicalSkills || []),
    ])].slice(0, 30),
    skillCategories: (resumeData.skillCategories || []).slice(0, 8).map((c) => ({
      category: c.category,
      skills: (c.skills || []).slice(0, 12),
    })),
    experience: (resumeData.experience || []).map((e) => ({
      company: e.company,
      title: e.title,
      // Send enough bullets so EVERY experience bullet can be evaluated vs the JD
      bullets: (e.bullets || []).slice(0, 14),
    })),
  }

  const gaps = {
    missingSkills: [...new Set(missingHard)].slice(0, 14),
    missingDomainKeywords: [...new Set(missingKeywords)].slice(0, 12),
    presentSkills: (comparison.present || []).slice(0, 12),
    roleTitle: jdData.roleTitle || '',
    requiredSkills: (jdData.requiredSkills || []).slice(0, 15),
    preferredSkills: (jdData.preferredSkills || []).slice(0, 8),
    tools: (jdData.toolsTechnologies || []).slice(0, 15),
    domainKeywords: (jdData.domainKeywords || []).slice(0, 12),
    responsibilities: (jdData.responsibilities || []).slice(0, 10),
  }

  const limits = {
    maxSummaryItems: 3,
    maxNewBulletsPerCompany: 3,
    maxExperienceRewrites: 14,
    companiesMustCover: companies,
    requireBulletForEveryCompany: true,
    maxSkillNames: 18,
    // Aim for strong JD keyword coverage after enhancement
    minDomainKeywordsToWeave: Math.min(10, gaps.missingDomainKeywords.length || 0),
    targetAtsScoreRange: [85, 99],
    target: 'strong_jd_selection',
  }

  const contexts = Array.isArray(companyContexts) ? companyContexts.slice(0, 8) : []

  const raw = await jsonCompletion(
    `You are an expert resume writer. Mission: get this resume SELECTED for the JD (enhanced ATS target 85–99). Return ONE complete enhancement plan as JSON only. Keep the JSON compact and complete (never truncate).

STEP 1 — ${BULLET_EVALUATION_RULES}

STEP 2 — When writing replacements or new bullets, follow:
${BULLET_RULES}

STEP 3 — Use companyContexts for industry/products/initiatives/systems when framing bullets for that employer.

Output fields:
- summaryRewrites: 0–3 items. For NEW summary text set original="" and replacement=new sentence/bullet. For rewrite set original to EXACT existing text. summaryFormat="${summaryFormat}".
- experienceRewrites: Weak / VeryWeak / Irrelevant rewrites plus NEW bullets. Max ${limits.maxExperienceRewrites} items total. rating must be one of: Perfect, Good, Weak, VeryWeak, Irrelevant. For NEW bullets use original="" and rating="Good". Do NOT include Perfect bullets. company must match the resume exactly. MUST include at least one NEW bullet (original="") for EVERY company in companiesMustCover when any JD gaps remain.
- skillAdditions: ONLY concrete tools/platforms from gaps.missingSkills and JD tools (SQL, Jira, Azure DevOps, Power BI, Tableau, Salesforce, Confluence). NEVER add soft fluff: Iterative, facilitation skills, reporting, customer service, manufacturing processes. Use EXISTING category labels only.

Rules:
- Cover gaps.responsibilities across ALL companies (not only the first one).
- Each company MUST get DISTINCT bullets — never copy the same bullet (or near-paraphrase) to two companies. Vary projects, systems, and tools per employer.
- Put missingSkills into skillAdditions AND evidence them inside rewritten/new experience bullets (full ATS credit).
- Prefer metrics in bullets for impact score.
- Stay within change limits. Return valid complete JSON only.`,
    JSON.stringify({
      resume: compactResume,
      gaps,
      companyContexts: contexts,
      allowedVocabulary: allowedVocab,
      limits,
    }),
    'enhancement_plan',
    COMPACT_PLAN_SCHEMA,
    { maxTokens: 5000 },
  )

  return normalizeEnhancementPlan(raw)
}

/**
 * Technical-failure repair only — not used when plan arrays are merely empty.
 */
export async function repairEnhancementPlan(resumeData, jdData, comparison, reason, companyContexts = []) {
  console.warn(`[AI] enhancement_plan repair: ${reason}`)
  return createEnhancementPlan(resumeData, jdData, comparison, companyContexts)
}

const BUILD_RESUME_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    location: { type: 'string' },
    summary: { type: 'string' },
    summaryBullets: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    technicalSkills: { type: 'array', items: { type: 'string' } },
    skillCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'skills'],
        additionalProperties: false,
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          dates: { type: 'string' },
          location: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['company', 'title', 'dates', 'location', 'bullets'],
        additionalProperties: false,
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          school: { type: 'string' },
          degree: { type: 'string' },
          course: { type: 'string' },
          dates: { type: 'string' },
        },
        required: ['school', 'degree', 'course', 'dates'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'name',
    'email',
    'phone',
    'location',
    'summary',
    'summaryBullets',
    'skills',
    'technicalSkills',
    'skillCategories',
    'experience',
    'education',
  ],
  additionalProperties: false,
}

/**
 * Generate a full resume from Resume Builder form input.
 * Uses user-provided company/role/dates/education/skills; invents realistic bullets.
 */
export async function generateResumeFromForm(formData) {
  const companies = Array.isArray(formData.companies) ? formData.companies : []
  const bulletsPerCompany = Math.min(15, Math.max(5, Number(formData.bulletsPerCompany) || 8))
  const years = Number(formData.yearsOfExperience) || 0
  const education = formData.education || {}

  const companyLines = companies.map((c, i) => {
    const loc = [c.city, c.state].filter(Boolean).join(', ')
    const skills = Array.isArray(c.skills) && c.skills.length
      ? c.skills.join(', ')
      : '(none selected)'
    return `${i + 1}. Company="${c.name}" | Role="${c.role}" | Start=${c.startDate || '?'} | End=${c.endDate || 'Present'} | City/State="${loc || 'N/A'}" | Skills=[${skills}]`
  }).join('\n')

  const allUserSkills = [...new Set(
    companies.flatMap((c) => (c.skills || []).map((s) => String(s).trim()).filter(Boolean)),
  )]

  const ref = formData.referenceMaterial || null
  const refExperience = Array.isArray(ref?.experience) ? ref.experience : []
  const refSummary = Array.isArray(ref?.summaryBullets) ? ref.summaryBullets : []
  const refSkills = Array.isArray(ref?.skills) ? ref.skills : []
  const refBlock = ref
    ? [
      'Reference document material (PREFERRED real experience — project involvement, tools, outcomes):',
      ref.fileName ? `- Sources: ${ref.fileName}` : '',
      refSkills.length
        ? `- Skills from references (include in skillCategories): ${refSkills.slice(0, 40).join(', ')}`
        : '',
      refSummary.length
        ? `- Summary lines to reuse/adapt:\n${refSummary.slice(0, 14).map((b) => `  • ${b}`).join('\n')}`
        : '',
      ...refExperience.map((exp, i) => {
        const bullets = (exp.bullets || []).slice(0, 16)
        if (!bullets.length) return ''
        return `- Ref job ${i + 1}: "${exp.company || '?'}" / "${exp.title || '?'}"\n${bullets.map((b) => `  • ${b}`).join('\n')}`
      }),
    ].filter(Boolean).join('\n')
    : ''

  const skillPool = [...new Set([...allUserSkills, ...refSkills])]

  return jsonCompletion(
    `You are an expert resume writer creating a professional, ATS-friendly resume from scratch.

${BULLET_RULES}

Quality bar (mandatory):
- Write like a strong senior professional with REAL project involvement — what you built/led, for whom, with which tools, and the business outcome.
- ATS-friendly: clear section language, keyword-rich but natural, no tables/columns/graphics in content.
- Attractive & clean: concise bullets, strong action verbs, measurable impact when believable.
- Prefer concrete project work over vague responsibilities.

Hard rules:
- Use the EXACT company names, job titles, and dates the user provided. Do not rename companies or invent extra jobs.
- Write EXACTLY ${bulletsPerCompany} bullets for EACH company (no more, no less).
- Weave user-selected skills AND reference skills naturally into company bullets and skillCategories.
- Bullets must be role-appropriate for "${formData.role}" with about ${years} years of experience.
- When reference document material is provided: reuse and polish those bullets/summary lines for matching companies. Keep real achievements, metrics, tools, and project context. Rewrite for clarity and ATS impact — do NOT invent fake employers or unrelated claims.
- Prefer reference summary lines when writing summaryBullets (polish them; fill remaining slots if needed).
- summaryBullets: return 4–8 strong summary bullets (leave summary as a short 1–2 sentence overview).
- skillCategories: group skills into 4–8 categories (e.g. Tools, Data & Reporting, Methodologies, Cloud). Prefer user + reference skills as the core list.
- skills + technicalSkills: flat list of the same skills (short names only).
- email/phone/location: copy from user input when provided.
- education: use the user's school, course, degree, and dates exactly (format dates as "Start – End").
- Return experience entries in the SAME order as the companies listed.`,
    `Candidate:
- Name: ${formData.name}
- Email: ${formData.email || ''}
- Phone: ${formData.phone || ''}
- LinkedIn: ${formData.linkedin || ''}
- Target role: ${formData.role}
- Years of experience: ${years}
- Skills pool (must appear in skillCategories): ${skillPool.join(', ') || '(none — invent realistic skills for the role)'}
- Summary notes from user (optional guidance): ${formData.summaryNotes || '(none — invent a strong summary)'}

Companies (write ${bulletsPerCompany} bullets each; use that company's skills in bullets):
${companyLines || '(none)'}

Education:
- School: ${education.school || ''}
- Course: ${education.course || ''}
- Degree: ${education.degree || ''}
- Start: ${education.startDate || ''}
- End: ${education.endDate || ''}

${refBlock || '(No reference document — invent strong, role-appropriate project bullets.)'}

Generate the complete resume JSON.`,
    'build_resume',
    BUILD_RESUME_SCHEMA,
    { maxTokens: 4096 },
  )
}

/** Summary bullet count by years of experience (legacy Build New Resume). */
export function summaryBulletCountForYears(years) {
  const y = Number(years) || 0
  if (y <= 4) return 5
  if (y <= 6) return 7
  if (y <= 10) return 10
  return 12
}

/** JD-Tailored builder always uses 6 professional summary bullets. */
export function jdSummaryBulletCount() {
  return 6
}

/**
 * Generate a JD-tailored resume from scratch (no existing resume).
 * Resume title/role must match the JD role. Skills must cover JD + related skills.
 * Experience/summary bullets are ALWAYS generated by Claude (no OpenAI/Groq fallback).
 */
export async function generateResumeFromJd(formData, jdData) {
  const companies = Array.isArray(formData.companies) ? formData.companies : []
  const years = Number(formData.yearsOfExperience) || 0
  const summaryCount = jdSummaryBulletCount()
  const roleTitle = String(jdData?.roleTitle || formData.role || '').trim()

  const jdSkills = [
    ...new Set([
      ...(jdData?.requiredSkills || []),
      ...(jdData?.preferredSkills || []),
      ...(jdData?.toolsTechnologies || []),
      ...(jdData?.mustHaveKeywords || []),
      ...(jdData?.domainKeywords || []),
    ].map((s) => String(s || '').trim()).filter(Boolean)),
  ]

  const companyLines = companies.map((c, i) => {
    const loc = [c.city, c.state, c.country].filter(Boolean).join(', ')
    const ranges = [
      { min: 12, max: 14, def: 13 },
      { min: 11, max: 13, def: 12 },
      { min: 10, max: 12, def: 11 },
      { min: 9, max: 11, def: 10 },
      { min: 7, max: 9, def: 8 },
    ]
    const range = ranges[i] || { min: 7, max: 12, def: 8 }
    const n = Math.min(range.max, Math.max(range.min, Number(c.bulletCount) || range.def))
    const guidance = String(c.summary || '').trim()
    const lengthRule = i <= 1
      ? 'First 2-3 bullets = THREE full lines (48-58 words); remaining bullets = TWO lines (32-40 words)'
      : 'ALL bullets = TWO full lines (32-40 words)'
    return `${i + 1}. Company="${c.name}" | Role="${c.role}" | Start=${c.startDate || '?'} | End=${c.endDate || 'Present'} | Location="${loc || '(omit if unknown)'}" | BulletCount=${n} | Length=${lengthRule} | JD-aligned guidance="${guidance || '(none — invent strong advanced JD-matched project bullets)'}"`
  }).join('\n')

  const ref = formData.referenceMaterial || null
  const refExperience = Array.isArray(ref?.experience) ? ref.experience : []
  const refSummary = Array.isArray(ref?.summaryBullets) ? ref.summaryBullets : []
  const refSkills = Array.isArray(ref?.skills) ? ref.skills : []
  const refBullets = refExperience.flatMap((exp) => exp.bullets || []).filter(Boolean)
  const refBlock = (refSummary.length || refBullets.length || refSkills.length)
    ? [
      'Approved reference material from uploaded PDFs/DOCX (CRITICAL):',
      refSkills.length
        ? `- Skills from references: ${refSkills.slice(0, 40).join(', ')}`
        : '',
      refSummary.length
        ? `- Summary lines to preserve meaning from references (keep original wording when already strong; expand short lines to FULL two-line bullets without changing the core claim):\n${refSummary.slice(0, 12).map((b) => `  • ${b}`).join('\n')}`
        : '',
      refBullets.length
        ? `- Experience/project bullets to preserve from references (keep original wording when already strong; if short, expand to a FULL two-line meaningful bullet while keeping the same project/tools/outcome):\n${refBullets.slice(0, 40).map((b) => `  • ${b}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n')
    : ''

  const aiModeNote = formData.aiMode
    ? `\nAI MODE is ON (industry hint: ${formData.aiIndustry || 'from JD'}). First match the JD tightly, then elevate with advanced modern skills. Every experience bullet MUST be a FULL two-line, meaningful project bullet. Use each company's JD-aligned guidance. Prefer 10–12 dense bullets per company.`
    : ''

  return jsonCompletion(
    `You are an elite resume strategist and intelligent AI writer. Build a brand-new resume that first MATCHES THE JD STRONGLY, then makes the candidate look advanced, modern, and market ready for "${roleTitle}".
${aiModeNote}

${JD_BULLET_RULES}

Strategy order (mandatory):
1) JD fit first: cover required skills, tools, responsibilities, keywords, and seniority for ~${years} years of experience.
2) Then elevate: add advanced skills beyond the JD minimum that still fit the role/industry and make the resume stronger than average applicants.
3) Modernize: reflect current market practices and tools hiring managers expect now.
4) Add AI intelligently: weave practical AI tool usage into bullets that already fit each company and project story. AI must feel native to the work, not pasted on.

Hard rules:
- Resume target role / title MUST be exactly: "${roleTitle}" (the JD role). Do not use a different title.
- Use the EXACT company names, per-company roles, and dates the user provided. Do not rename companies or invent extra jobs.
- For EACH company, write EXACTLY the BulletCount listed for that company (no more, no less).
- EVERY summary bullet MUST be a FULL two lines (about 32–40 words). For experience: follow per-company Length rules (Company #1 and #2 lead with 2–3 three-line bullets).
- NEVER use the JD hiring company as an experience employer. Company names must be distinct from the employer posting the JD.
- Align every bullet to JD responsibilities, tools, and keywords with real project ownership and advanced delivery.
- When JD-aligned guidance is provided for a company, follow it closely for that company's bullets.
- PRESENT / MOST RECENT company (first in the list): weave in MOST of the JD required skills, tools, and keywords naturally across its bullets, plus stronger adjacent advanced skills.
- Older companies: still JD-aligned with real project stories; each bullet still needs ≥1 JD skill and advanced depth appropriate to that role level.
- AI tools: include ONE summary bullet showing AI tools used at work, and include at least ONE experience AI bullet in EACH company when believable, especially the most recent role. Tie AI usage to that company's domain and existing project themes.
- skillCategories: return 5–7 category headings. Include EVERY JD skill below, PLUS advanced modern related skills that strengthen the profile. Prefer current-market vocabulary.
- skills + technicalSkills: flat list covering the SAME complete elevated skill set (short names only).
- When reference material is provided: preserve strong original wording; expand short reference lines into FULL two-line meaningful bullets without inventing unrelated claims.
- summaryBullets: return EXACTLY ${summaryCount} strong, FULL two-line, JD-aligned summary bullets. Leave "summary" as a short 1–2 sentence overview.
- Never put hyphens (-) or parentheses () inside summary or experience bullets; use combining words instead.
- Never invent placeholder location text like Remote or N/A.
- email/phone/location: copy from user input; omit blank fields.
- education: return [] (empty array) unless the user provided education below — then copy those entries.
- Return experience entries in the SAME order as the companies listed.`,
    `Candidate:
- Name: ${formData.name}
- Email: ${formData.email || ''}
- Phone: ${formData.phone || ''}
- City/State: ${[formData.city, formData.state].filter(Boolean).join(', ') || '(not provided — omit)'}
- User role hint: ${formData.role || '(use JD role)'}
- Years of experience: ${years}
- Required summary bullet count: ${summaryCount} (each FULL two lines)
- Education (use as-is if present): ${JSON.stringify(formData.education || [])}

JD analysis (match FIRST, then elevate above this baseline):
- Role title: ${roleTitle}
- Hiring company (DO NOT use as an experience employer): ${String(jdData?.hiringCompany || '').trim() || '(infer from JD — still never reuse it)'}
- Required skills: ${(jdData?.requiredSkills || []).join(', ') || '(see JD text)'}
- Preferred skills: ${(jdData?.preferredSkills || []).join(', ') || ''}
- Tools/technologies: ${(jdData?.toolsTechnologies || []).join(', ') || ''}
- Must-have keywords: ${(jdData?.mustHaveKeywords || []).join(', ') || ''}
- Domain keywords: ${(jdData?.domainKeywords || []).join(', ') || ''}
- Key responsibilities: ${(jdData?.responsibilities || []).slice(0, 12).join(' | ') || ''}
- JD skills that MUST appear, plus advanced related skills that make the resume stronger: ${jdSkills.join(', ') || '(extract from JD text)'}

Companies (present→past order already applied by caller — #1 is present/most recent):
${companyLines || '(none)'}

${refBlock || '(No reference document — invent strong, advanced, human, JD-matched project bullets with FULL two-line depth.)'}

Raw JD excerpt (for extra context):
${String(formData.jdText || '').slice(0, 4500)}

Generate the complete resume JSON. Every bullet must be a full two-line meaningful statement.`,
    'build_jd_resume',
    BUILD_RESUME_SCHEMA,
    // Prefer Claude, then ChatGPT, then Gemini (continue through remaining configured providers)
    { maxTokens: 8192, preferProviders: ['claude', 'openai', 'gemini'] },
  )
}

const SUGGEST_COMPANIES_SCHEMA = {
  type: 'object',
  properties: {
    industry: { type: 'string' },
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          companyName: { type: 'string' },
          jobTitle: { type: 'string' },
          country: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          bulletCount: { type: 'number' },
          bulletGuidance: { type: 'string' },
        },
        required: [
          'companyName',
          'jobTitle',
          'country',
          'city',
          'state',
          'startDate',
          'endDate',
          'bulletCount',
          'bulletGuidance',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['industry', 'companies'],
  additionalProperties: false,
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatMonYear(date) {
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** Build present→past date ranges spanning totalYears across N companies. */
export function buildPresentToPastRanges(companyCount, totalYears) {
  const n = Math.min(6, Math.max(1, Number(companyCount) || 1))
  const years = Math.min(40, Math.max(1, Number(totalYears) || 5))
  const now = new Date()
  const endExclusive = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const startEarliest = Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), 1)
  const totalMonths = Math.max(n, Math.round((endExclusive - startEarliest) / (30.44 * 24 * 3600 * 1000)))
  const base = Math.floor(totalMonths / n)
  let rem = totalMonths - base * n
  const ranges = []
  let cursorEnd = endExclusive
  for (let i = 0; i < n; i++) {
    const span = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem -= 1
    const endDate = new Date(cursorEnd)
    const startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - span, 1))
    ranges.push({
      startDate: formatMonYear(startDate),
      endDate: i === 0 ? 'Present' : formatMonYear(endDate),
    })
    cursorEnd = startDate.getTime()
  }
  return ranges
}

function normalizeEmployerKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|plc|limited)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function namesLikelySame(a, b) {
  const na = normalizeEmployerKey(a)
  const nb = normalizeEmployerKey(b)
  if (!na || !nb || na.length < 3 || nb.length < 3) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Lightweight hints for the JD employer so AI-mode companies never match it. */
function extractLikelyHiringCompanies(jdText) {
  const text = String(jdText || '')
  const found = new Set()
  const patterns = [
    /(?:at|join|joining)\s+([A-Z][A-Za-z0-9&.'\-\s]{2,40}?)(?:\s+is\b|\s+as\b|,|\.|!)/g,
    /(?:about|company|employer)\s*[:\-]\s*([A-Z][A-Za-z0-9&.'\-\s]{2,40})/gi,
    /^([A-Z][A-Za-z0-9&.'\-]{2,}(?:\s+[A-Z][A-Za-z0-9&.'\-]{2,}){0,3})\s*$/gm,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const name = String(m[1] || '').trim()
      if (name.length >= 3 && name.length <= 48) found.add(name)
    }
  }
  return [...found]
}

function forcedPlaceholderEmployer(country, index) {
  return forcedPlaceholderName(country, index)
}

/**
 * Suggest industry-fit companies (USA/India split) with present→past dates for AI mode.
 */
export async function suggestCompaniesFromJd({
  jdText,
  roleTitle = '',
  yearsOfExperience = 5,
  companyCount = 3,
  usaCount = 2,
  indiaCount = 1,
} = {}) {
  const n = Math.min(6, Math.max(1, Number(companyCount) || 1))
  let usa = Math.max(0, Number(usaCount) || 0)
  let india = Math.max(0, Number(indiaCount) || 0)
  if (usa + india !== n) {
    // Normalize: fill remaining to USA
    if (usa + india < n) usa += n - (usa + india)
    else {
      // trim India first
      const overflow = usa + india - n
      india = Math.max(0, india - overflow)
      usa = n - india
    }
  }
  const years = Math.min(40, Math.max(1, Number(yearsOfExperience) || 5))
  const dateRanges = buildPresentToPastRanges(n, years)
  const countryPlan = [
    ...Array.from({ length: usa }, () => 'USA'),
    ...Array.from({ length: india }, () => 'India'),
  ]

  const data = await jsonCompletion(
    `You are a career strategist filling a resume company history for someone targeting a job.

Hard rules:
- Infer the JD industry (e.g. FinTech, Healthcare IT, SaaS, Consulting, E-commerce, Banking).
- Extract the hiring employer from the JD (the company posting the job). NEVER return that employer (or close variants) as companyName.
- Return EXACTLY ${n} companies in present → past order (index 0 = current/most recent).
- Country assignment for each company in order MUST be: ${countryPlan.join(', ')}.
- Pick believable, well-known employers that fit the industry and country (real company names), different from the JD employer.
- For USA: city + 2-letter US state code (e.g. Austin, TX).
- For India: city + Indian state/region name (e.g. Bangalore, Karnataka). Do NOT invent US state codes for India.
- jobTitle should progress sensibly toward "${roleTitle || 'the JD role'}" (more senior in recent roles).
- bulletCount by company index (present→past): #1 → 12–14, #2 → 11–13, #3 → 10–12, #4 → 9–11, #5 → 7–9 (use midpoint if unsure).
- bulletGuidance: 1–2 sentences of JD-aligned themes/tools this company should emphasize (not full bullets).
- Do NOT invent dates — the caller will overwrite dates. Still return placeholder startDate/endDate fields as empty strings if unsure.
- companyName must be distinct and realistic.`,
    `Target role: ${roleTitle || '(from JD)'}
Years of experience to cover: ${years}
Companies total: ${n} (USA=${usa}, India=${india})
Country order (present→past): ${countryPlan.join(' → ')}

Job description:
${String(jdText || '').slice(0, 5500)}

Return industry + companies JSON.`,
    'suggest_jd_companies',
    SUGGEST_COMPANIES_SCHEMA,
    { maxTokens: 2200, preferProviders: ['claude'] },
  )

  const hiringHints = extractLikelyHiringCompanies(jdText)
  const bulletDefaults = [13, 12, 11, 10, 8, 8]
  const bulletRanges = [
    [12, 14], [11, 13], [10, 12], [9, 11], [7, 9], [7, 12],
  ]

  const companies = (data.companies || []).slice(0, n).map((c, i) => {
    const forcedCountry = countryPlan[i] || (/india/i.test(c.country || '') ? 'India' : 'USA')
    const dates = dateRanges[i] || { startDate: 'Jan 2020', endDate: i === 0 ? 'Present' : 'Jan 2022' }
    let companyName = String(c.companyName || '').trim()
    if (hiringHints.some((h) => namesLikelySame(companyName, h))) {
      companyName = forcedPlaceholderEmployer(forcedCountry, i)
    }
    const [minB, maxB] = bulletRanges[i] || [7, 12]
    const rawB = Number(c.bulletCount) || bulletDefaults[i] || 8
    return {
      companyName,
      jobTitle: String(c.jobTitle || roleTitle || '').trim(),
      country: forcedCountry,
      city: String(c.city || '').trim(),
      state: String(c.state || '').trim(),
      startDate: dates.startDate,
      endDate: dates.endDate,
      bulletCount: Math.min(maxB, Math.max(minB, rawB)),
      bulletGuidance: String(c.bulletGuidance || '').trim(),
    }
  })

  // Pad if AI returned fewer
  while (companies.length < n) {
    const i = companies.length
    const dates = dateRanges[i]
    companies.push({
      companyName: forcedPlaceholderName(countryPlan[i], i),
      jobTitle: roleTitle || 'Professional',
      country: countryPlan[i],
      city: countryPlan[i] === 'India' ? 'Bangalore' : 'Austin',
      state: countryPlan[i] === 'India' ? 'Karnataka' : 'TX',
      startDate: dates.startDate,
      endDate: dates.endDate,
      bulletCount: bulletDefaults[i] || 8,
      bulletGuidance: 'Emphasize JD-required tools, delivery, and measurable outcomes.',
    })
  }

  return {
    industry: String(data.industry || '').trim(),
    companies,
  }
}

function forcedPlaceholderName(country, index) {
  const usa = ['Northstar Analytics', 'Summit Data Group', 'BrightPath Systems', 'Lakeview Digital', 'Cascade Insights']
  const india = ['Nimbus SoftTech', 'Aether Labs India', 'Orbit Analytics', 'PixelForge Solutions', 'Vantage Infotech']
  const list = country === 'India' || /india/i.test(country) ? india : usa
  return list[index % list.length]
}

const EXTRA_BULLET_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
  },
  required: ['company', 'bullets'],
  additionalProperties: false,
}

/**
 * Generate 1–2 JD-aligned experience bullets for a chat "add another bullet" request.
 */
export async function generateExtraExperienceBullets({
  resumeData,
  jdData,
  company,
  count = 1,
  userMessage = '',
} = {}) {
  const exp = (resumeData?.experience || []).find(
    (e) => String(e.company || '').toLowerCase() === String(company || '').toLowerCase(),
  ) || resumeData?.experience?.[0]
  if (!exp?.company) {
    return { company: company || '', bullets: [] }
  }

  const n = Math.min(2, Math.max(1, Number(count) || 1))
  try {
    return await jsonCompletion(
      `You write strong ATS resume bullets. Return JSON only.
Rules:
- Write EXACTLY ${n} NEW bullets for the given company/role.
- Each bullet ~28–40 words, past tense, measurable when possible.
- Align to the job description tools/responsibilities.
- Do NOT repeat existing bullets (or near-paraphrases).
- Do NOT mention other employers in these bullets.
- Do NOT invent fake companies.`,
      `User request: ${String(userMessage || '').slice(0, 400)}

Target company: ${exp.company}
Role: ${exp.title || 'Software Engineer'}
Existing bullets:
${(exp.bullets || []).slice(0, 8).map((b, i) => `${i + 1}. ${b}`).join('\n') || '(none)'}

JD role: ${jdData?.roleTitle || ''}
JD tools: ${(jdData?.toolsTechnologies || []).slice(0, 12).join(', ')}
JD responsibilities: ${(jdData?.responsibilities || []).slice(0, 8).join(' | ')}
Required skills: ${(jdData?.requiredSkills || []).slice(0, 12).join(', ')}

Return {"company":"${exp.company}","bullets":[...]}`,
      'extra_experience_bullets',
      EXTRA_BULLET_SCHEMA,
      { maxTokens: 700 },
    )
  } catch (err) {
    console.warn('[AI] generateExtraExperienceBullets failed:', err.message)
    return { company: exp.company, bullets: [] }
  }
}

const SCREENSHOT_LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    issueCodes: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'blank_page_gap',
          'resume_gap_spacing',
          'section_content_gap',
          'indent_inconsistency',
          'skills_mashed',
          'extreme_indent',
          'duplicate_bullet',
          'wrong_company',
          'garbled_bullet',
          'general_enhancer',
        ],
      },
    },
    summary: { type: 'string' },
    section: { type: 'string' },
  },
  required: ['issueCodes', 'summary'],
  additionalProperties: false,
}

/**
 * Analyze a user screenshot of a layout problem (gaps, indentation, duplicates).
 */
export async function analyzeLayoutScreenshot(imageBuffer, mimeType = 'image/png', userMessage = '') {
  const { visionStructuredJSON } = await import('./aiProvider.js')
  const { result } = await visionStructuredJSON(
    `You analyze resume layout screenshots for the JoBPilot Resume Enhancer.
Identify ONLY visible layout/content problems. Return JSON with issueCodes and a short summary.
Codes:
- blank_page_gap / resume_gap_spacing / section_content_gap: huge white space, blank pages, content pushed to bottom
- indent_inconsistency / extreme_indent: bullets misaligned or shoved left/right
- skills_mashed: skills categories run together
- duplicate_bullet / wrong_company: same bullet under two employers
- garbled_bullet: broken/truncated text
- general_enhancer: other visible resume problem`,
    `User note: ${String(userMessage || '(screenshot only)').slice(0, 500)}
Describe what is wrong in this resume preview screenshot.`,
    imageBuffer,
    mimeType,
    'layout_screenshot_analysis',
    SCREENSHOT_LAYOUT_SCHEMA,
  )
  return {
    issueCodes: Array.isArray(result?.issueCodes) ? result.issueCodes : ['general_enhancer'],
    summary: String(result?.summary || 'Layout issue visible in screenshot').slice(0, 300),
    section: String(result?.section || '').slice(0, 80),
  }
}
