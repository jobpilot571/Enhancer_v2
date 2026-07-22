import { structuredJSON } from './aiProvider.js'
import { cleanJobDescription, getCachedJdAnalysis, setCachedJdAnalysis } from './jdCleaner.js'

/**
 * @param {object} [options]
 * @param {number} [options.maxTokens]
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
    requiredSkills: { type: 'array', items: { type: 'string' } },
    preferredSkills: { type: 'array', items: { type: 'string' } },
    responsibilities: { type: 'array', items: { type: 'string' } },
    toolsTechnologies: { type: 'array', items: { type: 'string' } },
    domainKeywords: { type: 'array', items: { type: 'string' } },
    mustHaveKeywords: { type: 'array', items: { type: 'string' } },
    niceToHaveKeywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['roleTitle', 'requiredSkills', 'preferredSkills', 'responsibilities', 'toolsTechnologies', 'domainKeywords', 'mustHaveKeywords', 'niceToHaveKeywords'],
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
- Prefer rewriting Weak/VeryWeak bullets that leave gaps.responsibilities uncovered — strong JD match is the goal.
- Do NOT invent unsupported or unrealistic claims. Do NOT copy sentences from the job description.
- Keep original meaning, company context, role level, and project story (same system/initiative when named).
- Prefer covering one important JD responsibility + 1–2 relevant JD skills per rewritten bullet.
- Avoid repeating the same skills, technologies, responsibilities, and action verbs across bullets.
- Stronger responsibility coverage in experience matters more than stuffing the skills section.
- OUTPUT SIZE LIMIT: emit at most 10 experienceRewrites total (prefer the weakest bullets first). At most 2 NEW bullets per company (original=""). Never list Perfect bullets. Keep JSON compact.`

const BULLET_RULES = `Bullet writing rules (strict — apply when writing NEW or REWRITTEN bullets):
- Write like a human professional telling a real project story — not AI filler or generic BA templates.
- Story structure: Situation/system at that company → your action → tools/methods → business outcome.
- Real-time project involvement: what YOU did, at WHICH company domain, on WHICH system/initiative, with WHAT stakeholders, using WHICH tools, with WHAT result.
- Company + industry alignment: use companyContexts (industry, products, initiatives, systems) to frame the story in that employer's world — dining/hospitality, logistics, manufacturing, public sector, etc.
- When adding NEW bullets (original=""): extend an EXISTING project/system already named in that company's bullets OR a plausible initiative from companyContexts that fits the candidate's title and prior bullets. Never invent unrelated fake projects.
- Be technical and specific: name tools from the JD and resume (SQL, Power BI, Tableau, Jira, ERP, etc.), methods, and deliverables.
- EACH rewritten/new bullet MUST map to at least one gaps.responsibilities item and weave 1–2 gaps.missingSkills or JD tools naturally.
- Be impressive but believable for the candidate's role, seniority, and that company's industry.
- Use strong action verbs (Led, Built, Designed, Automated, Optimized, Delivered) — vary verbs across bullets.
- Include measurable impact where the resume already implies scale (%, time, volume, users) — do not invent precise fake metrics.
- Each bullet: one clear achievement, complete thought, about 18–28 words / 1–2 lines. Never exceed ~2 lines.
- Do NOT start bullets with a bullet character (•). Plain sentence text only.
- Sound like a confident professional who worked there — not a job description copy.
- Reject generic lines like "Delivered analysis and reporting to support decisions" unless tied to a named system, company domain, and JD skill.`

/** Stricter rules for JD-tailored resume builds. */
const JD_BULLET_RULES = `Experience bullet rules (strict — EVERY experience bullet MUST follow ALL of these):
- Real-time project involvement: name the project/system, your role, technical approach, and business outcome.
- Professional, clean, humanized, understandable — sounds like a real engineer/analyst wrote it.
- Technical and specific (tools, frameworks, data, APIs, cloud, methods) — never vague filler.
- EACH bullet MUST include at least ONE skill/tool/keyword from the job description (naturally woven in).
- EACH bullet MUST be AT LEAST 2 lines when rendered (about 28–40 words). Prefer ~32–38 words. Never write a short one-liner.
- Do NOT exceed ~42 words / about 2.5 lines.
- Use strong action verbs and measurable impact where believable.
- Do NOT start with a bullet character. Plain sentence text only.
- No color instructions — content only.`

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
      if (rewriteCount >= 10) continue
      bulletRewrites.push({ company, original, replacement })
      rewriteCount += 1
      if (rating) {
        bulletEvaluations.push({ company, original, rating, action: 'rewrite' })
      }
    } else {
      const list = byCompany.get(company) || []
      if (list.length >= 2) continue
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
    summaryBullets: summaryBullets.slice(0, 2),
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

/**
 * Analyze a cleaned JD (or raw — will clean). Uses disk/memory cache by content hash.
 * @returns {{ data: object, cached: boolean, cacheKey: string, source: string|null }}
 */
export async function analyzeJd(jdText) {
  const cleaned = cleanJobDescription(jdText)
  const cached = getCachedJdAnalysis(jdText)
  if (cached.data) {
    console.log(`[AI] jd_analysis cache hit (${cached.source}) key=${cached.key.slice(0, 12)}`)
    return { data: cached.data, cached: true, cacheKey: cached.key, source: cached.source }
  }

  const data = await jsonCompletion(
    `Extract structured hiring signal from this cleaned job description.
Return ONLY JSON. Keep lists short and concrete (skills/tools as short names, not sentences).
Ignore any residual salary, benefits, location, EEO, or apply instructions.`,
    `Cleaned JD:\n${cleaned.slice(0, 6000)}`,
    'jd_analysis',
    JD_SCHEMA,
    { maxTokens: 800 },
  )

  const cacheKey = setCachedJdAnalysis(jdText, data)
  return { data, cached: false, cacheKey, source: null }
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
    maxSummaryItems: 2,
    maxNewBulletsPerCompany: 2,
    maxExperienceRewrites: 10,
    companiesMustCover: companies,
    maxSkillNames: 12,
    // Aim for strong JD keyword coverage after enhancement
    minDomainKeywordsToWeave: Math.min(6, gaps.missingDomainKeywords.length || 0),
    target: 'strong_jd_match',
  }

  const contexts = Array.isArray(companyContexts) ? companyContexts.slice(0, 6) : []

  const raw = await jsonCompletion(
    `You are an expert resume writer. Goal: STRONG JD–experience match with company-specific, story-driven bullets. Return ONE complete enhancement plan as JSON only. Keep the JSON compact and complete (never truncate).

STEP 1 — ${BULLET_EVALUATION_RULES}

STEP 2 — When writing replacements or new bullets, follow:
${BULLET_RULES}

STEP 3 — Use companyContexts for industry/products/initiatives/systems when framing bullets for that employer. Ground every bullet in the resume's existing project stories; companyContexts only supply domain flavor and plausible initiative types — never fabricated personal work.

Output fields:
- summaryRewrites: 0–2 items. For NEW summary text set original="" and replacement=new sentence/bullet. For rewrite set original to EXACT existing text. summaryFormat="${summaryFormat}".
- experienceRewrites: ONLY Weak / VeryWeak / Irrelevant rewrites (and rare Good polish). Max ${limits.maxExperienceRewrites} items total. rating must be one of: Perfect, Good, Weak, VeryWeak, Irrelevant. For NEW bullets use original="" and rating="Good". Do NOT include Perfect bullets. company must match the resume exactly.
- skillAdditions: ONLY concrete tools/hard skills from gaps.missingSkills. Never put domain phrases or years claims in skills. Use EXISTING category labels only.

Rules:
- Strong JD match is mandatory: cover as many gaps.responsibilities as possible via rewrites + limited new bullets.
- Evaluate mentally first; output ONLY the changes. Prefer keeping Perfect/Good bullets as-is.
- Do not invent unsupported claims. Do not copy the JD.
- NEW bullets must feel like real project involvement at that company (reuse named systems/projects from existing bullets when present).
- Put missingSkills into skillAdditions AND evidence them inside rewritten/new experience bullets.
- Empty arrays are allowed only when Perfect/Good bullets already cover the JD well.
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
    { maxTokens: 4096 },
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

/** Summary bullet count by years of experience (JD-Tailored builder). */
export function summaryBulletCountForYears(years) {
  const y = Number(years) || 0
  if (y <= 4) return 5
  if (y <= 6) return 7
  if (y <= 10) return 10
  return 12
}

/**
 * Generate a JD-tailored resume from scratch (no existing resume).
 * Resume title/role must match the JD role. Skills must cover JD + related skills.
 */
export async function generateResumeFromJd(formData, jdData) {
  const companies = Array.isArray(formData.companies) ? formData.companies : []
  const years = Number(formData.yearsOfExperience) || 0
  const summaryCount = summaryBulletCountForYears(years)
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
    const loc = [c.city, c.state].filter(Boolean).join(', ')
    const n = Math.min(15, Math.max(3, Number(c.bulletCount) || 8))
    return `${i + 1}. Company="${c.name}" | Role="${c.role}" | Start=${c.startDate || '?'} | End=${c.endDate || 'Present'} | City/State="${loc || 'N/A'}" | BulletCount=${n} | OptionalSummaryGuidance="${String(c.summary || '').trim() || '(none)'}"`
  }).join('\n')

  return jsonCompletion(
    `You are an expert resume writer building a brand-new resume from scratch that is STRONGLY tailored to a specific job description.

${JD_BULLET_RULES}

Hard rules:
- The candidate has NO existing resume — invent believable, JD-aligned content from their facts + the JD.
- Resume target role / title MUST be exactly: "${roleTitle}" (the JD role). Do not use a different title.
- Use the EXACT company names, per-company roles, and dates the user provided. Do not rename companies or invent extra jobs.
- For EACH company, write EXACTLY the BulletCount listed for that company (no more, no less).
- EVERY experience bullet must be ~2 lines (28–40 words) and must include at least one JD skill/tool/keyword.
- Align every bullet to JD responsibilities, tools, and keywords — sound like someone who already does this job with real project ownership.
- PRESENT / MOST RECENT company (first in the list): weave in MOST of the JD required skills, tools, and keywords naturally across its bullets.
- Older companies: still JD-aligned with real project stories; each bullet still needs ≥1 JD skill.
- If a company has OptionalSummaryGuidance, use it as soft guidance for that company's bullets (do not copy it verbatim into bullets unless it fits).
- summaryBullets: return EXACTLY ${summaryCount} strong, JD-aligned summary bullets. Leave "summary" as a short 1–2 sentence overview.
- skillCategories: return 5–7 category headings. Include EVERY skill from the JD list below (required + preferred + tools + keywords) plus closely related skills. Do not omit JD skills.
- skills + technicalSkills: flat list covering the SAME complete skill set (short names only). Prefer JD vocabulary.
- email/phone/location: copy from user input.
- education: return [] (empty array) unless the user provided education below — then copy those entries.
- Return experience entries in the SAME order as the companies listed.`,
    `Candidate:
- Name: ${formData.name}
- Email: ${formData.email || ''}
- Phone: ${formData.phone || ''}
- City/State: ${[formData.city, formData.state].filter(Boolean).join(', ') || formData.location || ''}
- User role hint: ${formData.role || '(use JD role)'}
- Years of experience: ${years}
- Required summary bullet count: ${summaryCount}
- Education (use as-is if present): ${JSON.stringify(formData.education || [])}

JD analysis (tailor heavily to this):
- Role title: ${roleTitle}
- Required skills: ${(jdData?.requiredSkills || []).join(', ') || '(see JD text)'}
- Preferred skills: ${(jdData?.preferredSkills || []).join(', ') || ''}
- Tools/technologies: ${(jdData?.toolsTechnologies || []).join(', ') || ''}
- Must-have keywords: ${(jdData?.mustHaveKeywords || []).join(', ') || ''}
- Domain keywords: ${(jdData?.domainKeywords || []).join(', ') || ''}
- Key responsibilities: ${(jdData?.responsibilities || []).slice(0, 12).join(' | ') || ''}
- All JD skills that MUST appear in skillCategories AND mostly in the PRESENT company bullets: ${jdSkills.join(', ') || '(extract from JD text)'}

Companies (present→past order already applied by caller — #1 is present/most recent):
${companyLines || '(none)'}

Raw JD excerpt (for extra context):
${String(formData.jdText || '').slice(0, 4500)}

Generate the complete resume JSON.`,
    'build_jd_resume',
    BUILD_RESUME_SCHEMA,
    { maxTokens: 5096 },
  )
}
