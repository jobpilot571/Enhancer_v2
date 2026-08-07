import { structuredJSON } from './aiProvider.js'
import { cleanJobDescription, getCachedJdAnalysis, setCachedJdAnalysis } from './jdCleaner.js'
import { extractKnownToolsFromText } from './scoringDictionary.js'
import { formatProjectMemoriesForPrompt } from './jdProjectMemoryService.js'

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

/** Shared formatting rules for JD resume bullets (summary + experience). */
const JD_BULLET_FORMAT_RULES = `Bullet formatting (strict — follow ALL):
- Write like a strong working professional: humanized, natural, professional, and easy to understand. NEVER robotic, generic, repetitive, or AI filler.
- Experience length: MOST experience bullets MUST be EXACTLY two FULL lines when rendered (target 32–40 words). Never one-liners.
- For Company #1 (most recent) and Company #2: the FIRST 2–3 experience bullets MUST be THREE full lines (target 48–58 words). Remaining experience bullets for those companies stay two lines (32–40 words).
- Companies #3+: all experience bullets two lines (32–40 words).
- Summary length: each summary bullet is concise (about 12–22 words) — clear and scannable, not a mini paragraph and not a one-word fragment.
- Do NOT use hyphen/dash characters (-) or parentheses () inside bullets. Use combining words instead, e.g. "JSON, XML, and CSV" not "(JSON, XML, CSV)"; "SQL based reporting" not "SQL-based reporting".
- Do NOT start with a bullet character. Plain sentence text only — the document formatter adds real Word bullets.
- No color instructions — content only. Do not bold or highlight keywords in the text.`

/**
 * Professional Summary rules for JD-tailored builds (exactly 6 bullets).
 * Experience / Skills / merge behavior are intentionally NOT covered here.
 */
const JD_SUMMARY_BULLET_RULES = `Professional Summary — exactly 6 bullets (strict):
Return EXACTLY 6 summaryBullets. Leave "summary" as a short 1–2 sentence overview only.

The 6 bullets must collectively cover these purposes IN ORDER:
1) Total years of experience and target role
2) Primary technical expertise (a few core tools/skills only — do not overload)
3) Relevant industry or business domain experience
4) Project delivery and problem-solving experience
5) Stakeholder or team collaboration
6) One clear achievement or business impact (believable; no fake exact metrics)

Tone and quality:
- Concise, natural, professional, easy to understand — written like a real experienced person.
- Must match the candidate's career level and the experience generated for the companies.
- Help a recruiter grasp the background in a few seconds.

JD keywords:
- Use important JD keywords naturally ACROSS the six bullets.
- Do NOT copy the JD or paraphrase the whole posting.
- Do NOT repeat the same tools, skills, or phrases across multiple summary bullets.
- Do NOT overload one bullet with a long technology dump.

Truthfulness:
- Do not add unsupported claims, fake certifications, fake domain expertise, or exact metrics not supported by candidate info or generated experience.
- Prefer qualitative impact when precise numbers are not supported.

Banned robotic phrases (never use):
- Results-driven professional
- Highly motivated individual
- Proven track record
- Dynamic professional
- Seasoned expert
- Also avoid similar clichés: passionate about, leveraging synergies, best-in-class, go-getter.`

/**
 * Experience-only project storytelling rules for JD-tailored builds.
 * Summary / Skills / merge behavior are intentionally NOT covered here.
 */
const JD_EXPERIENCE_PROJECT_RULES = `Experience bullets — from internal project memory (strict):
BEFORE writing bullets for each company, an INTERNAL project memory is created for that company (or you must invent one silently if missing).
That memory is for writing only — NEVER print projectName, team size labels, deployment process text blocks, memory field names, or the memory itself in the resume.

When a project memory is provided for a company:
- Generate ALL experience bullets for that company from THAT SINGLE project memory only.
- Every bullet must naturally come from the same project (objective, systems, users, challenges, tech, deliverables, production issues, outcomes).
- Do NOT invent a second unrelated project for the same company.
- Do NOT write independent bullets that ignore the memory.
- Related workstreams inside the same engagement are fine; disconnected one-off bullets are not.

When no memory is provided for a company, silently create one coherent enterprise project first (with the same internal fields: objective, industry, team, role, responsibilities, systems, users, challenges, tech, deliverables, production issues, deployment, outcomes), then write all bullets from it.

Each company MUST get a DIFFERENT project memory / story (different objective, systems, users, challenges, outcomes, and sentence structures).

Across the company's bullet SET (not every individual bullet), cover:
- the project or business problem,
- what the person personally designed, developed, configured, analyzed, supported, or improved,
- relevant tools and technologies,
- collaboration with users, technical teams, or stakeholders,
- a practical result or business impact when believable.

The reader should feel the candidate actually worked on one or more real enterprise projects during that company tenure.

Seniority voice (match the company's role level):
- Senior: ownership, solution design, leadership, decisions, stakeholder management, delivery, production responsibility.
- Mid: hands-on implementation, configuration, development, analysis, testing, troubleshooting, collaboration.
- Junior: support, testing, documentation, reporting, issue analysis, guided implementation.

JD keywords:
- Keep important JD skills/tools/keywords, but place them ONLY where they naturally fit inside this project's story.
- Distribute keywords across the company's bullet set and across companies — do NOT stuff every keyword into every bullet.
- Present/most recent company may carry more JD keywords; older companies stay relevant without cloning the same keyword list.

Company research usage:
- Use verified research only as background industry/company context.
- Do NOT present a public company initiative as the candidate's exact personal project unless the user provided or confirmed it.
- industryTypical items are generic assumptions — adapt them into believable work, do not copy them as confirmed facts.

Anti-repetition (critical):
- Do NOT repeat the same opener, sentence structure, tools, or outcomes across companies.
- Do NOT put AI, automation, dashboards, regression testing, documentation, or the same percentages into every company.
- AI / automation may appear in at most ONE company when truly natural for that project — never as a forced pattern.
- Sound like real work experience someone lived, not a template.`

/**
 * Technical Skills section rules for JD-tailored builds.
 * Summary / Experience / merge behavior are intentionally NOT covered here.
 */
const JD_SKILLS_RULES = `Technical Skills section (complete technical index — ATS-friendly and scannable):
- The Skills section MUST list every technical skill used in Professional Summary, Experience, and Projects, PLUS important technical skills required by the JD. Do not stop at "missing only" gaps — index all of them.
- Scan Summary, Experience, and Projects before finalizing Skills. Collect unique technical skills, tools, frameworks, platforms, databases, programming languages, cloud services, ERP modules, libraries, methodologies, and domain technologies that actually appear there or are required by the JD.
- Return skillCategories with ONLY categories relevant to the target role. Prefer from this set when they apply:
  Programming Languages | Databases | Frameworks and Libraries | Cloud and DevOps | Tools and Platforms | Domain Skills
- Omit empty or irrelevant categories. Typically 3–6 categories. Do NOT invent filler categories.
- Ban these category names: Core Technologies, Advanced Skills, Advanced and Modern Skills, Leadership and Communication (and any soft-skill or keyword-dump buckets).
- Place every skill under the most appropriate existing category. Never create dump categories to absorb leftovers.
- Each category: short skill NAMES only (e.g. "SQL", "Tableau", "Python", "Oracle Forms") — no descriptions or sentences.
- Remove duplicates using case-insensitive / spacing-normalized matching (SQL and sql are the same; Power BI and PowerBI are the same; PL/SQL and PLSQL are the same). List each skill exactly once across the whole Skills section — never in multiple categories.
- Do NOT add tools only because they appeared in company research unless they are used in generated Experience/Projects or required by the JD.
- Do NOT list soft skills. Never include: Communication, Leadership, Problem Solving, Teamwork, Documentation, Stakeholder Management, Reports, Coding Skills, Business process knowledge, presentation skills, etc. Those belong in Experience narrative only.
- Do NOT repeat the job title, industry name, or generic terms only to pad keyword count.
- Before finishing: verify every important technical keyword used anywhere in the resume is represented exactly once in the appropriate Skills category.
- skills + technicalSkills: flat list of the SAME unique skills as in skillCategories (short names only, no duplicates).`

/** Combines format + summary + experience + skills rules for JD builds. */
const JD_BULLET_RULES = `${JD_BULLET_FORMAT_RULES}

${JD_SUMMARY_BULLET_RULES}

${JD_EXPERIENCE_PROJECT_RULES}

${JD_SKILLS_RULES}`

/**
 * Infer seniority for a company role from title + overall years.
 * @param {string} title
 * @param {number} overallYears
 * @param {number} companyIndex — 0 = most recent
 */
function inferJdCompanySeniority(title, overallYears = 0, companyIndex = 0) {
  const t = String(title || '').toLowerCase()
  if (/\b(intern|trainee|graduate|junior|jr\.?|associate|entry)\b/.test(t)) return 'junior'
  if (/\b(principal|staff|lead|manager|director|architect|senior|sr\.?|head)\b/.test(t)) return 'senior'
  const years = Number(overallYears) || 0
  // Older roles on a long career often skew more junior relative to present
  if (years >= 8 && companyIndex === 0) return 'senior'
  if (years >= 10 && companyIndex <= 1) return 'senior'
  if (years <= 2 || companyIndex >= 3) return 'junior'
  return 'mid'
}

function estimateYearsInRole(startDate, endDate) {
  const parse = (raw) => {
    const s = String(raw || '').trim()
    if (!s || /^present$/i.test(s)) return null
    const m = s.match(/(\d{4})/)
    return m ? Number(m[1]) : null
  }
  const startY = parse(startDate)
  const endY = parse(endDate) || new Date().getFullYear()
  if (!startY) return null
  return Math.max(0, endY - startY)
}

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
 * Bullets prefer Claude, then ChatGPT, then Gemini.
 * @param {object} formData
 * @param {object} jdData
 * @param {object[]} [companyContexts] — optional public research rows from researchJdCompanyContexts
 * @param {object[]} [projectMemories] — internal per-company project memories (never printed on resume)
 */
export async function generateResumeFromJd(formData, jdData, companyContexts = [], projectMemories = []) {
  const companies = Array.isArray(formData.companies) ? formData.companies : []
  const years = Number(formData.yearsOfExperience) || 0
  const summaryCount = jdSummaryBulletCount()
  const roleTitle = String(jdData?.roleTitle || formData.role || '').trim()
  const contexts = Array.isArray(companyContexts) ? companyContexts : []
  const compactContexts = contexts.map((row) => ({
    company: row.company,
    researchStatus: row.researchStatus || 'unknown',
    verified: row.verified || {},
    industryTypical: row.industryTypical || {},
    sources: Array.isArray(row.sources) ? row.sources.slice(0, 8) : [],
  }))
  const companyContextBlock = compactContexts.length
    ? `\nPublic company research (optional grounding — use verified facts with sources when present; treat industryTypical as generic industry assumptions only, not company-confirmed details; do NOT treat any of this as the candidate's personal achievements):\n${JSON.stringify(compactContexts)}\n`
    : ''

  const memories = Array.isArray(projectMemories) ? projectMemories.filter((m) => m?.company && m?.projectName) : []
  const projectMemoryBlock = formatProjectMemoriesForPrompt(memories)

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
    const seniority = inferJdCompanySeniority(c.role || c.title, years, i)
    const yearsInRole = estimateYearsInRole(c.startDate, c.endDate)
    const yearsNote = yearsInRole != null ? ` | YearsInRole≈${yearsInRole}` : ''
    return `${i + 1}. Company="${c.name}" | Role="${c.role}" | Seniority=${seniority}${yearsNote} | Start=${c.startDate || '?'} | End=${c.endDate || 'Present'} | Location="${loc || '(omit if unknown)'}" | BulletCount=${n} | Length=${lengthRule} | UserGuidance="${guidance || '(none)'}"`
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
    ? `\nAI MODE is ON (industry hint: ${formData.aiIndustry || 'from JD'}). First match the JD tightly, then elevate with advanced modern skills. Experience bullets must still follow project-context rules and must not repeat the same AI/automation pattern across companies. Prefer 10–12 dense bullets per company when BulletCount allows.`
    : ''

  return jsonCompletion(
    `You are an elite resume strategist and intelligent AI writer. Build a brand-new resume that first MATCHES THE JD STRONGLY, then makes the candidate look advanced, modern, and market ready for "${roleTitle}".
${aiModeNote}

${JD_BULLET_RULES}

Strategy order (mandatory):
1) JD fit first: cover required skills, tools, responsibilities, keywords, and seniority for ~${years} years of experience.
2) For EACH company: first use the INTERNAL project memory for that company (already generated before this step), THEN write ALL experience bullets from that single memory only.
3) Technical Skills: follow JD_SKILLS_RULES — complete index of technical skills from Summary/Experience/Projects + JD requirements.
4) Modernize vocabulary where natural — never by repeating the same buzzwords in every company.

Hard rules:
- Resume target role / title MUST be exactly: "${roleTitle}" (the JD role). Do not use a different title.
- Use the EXACT company names, per-company roles, and dates the user provided. Do not rename companies or invent extra jobs.
- For EACH company, write EXACTLY the BulletCount listed for that company (no more, no less).
- Professional Summary: follow JD_SUMMARY_BULLET_RULES — EXACTLY ${summaryCount} concise bullets covering years/role, technical expertise, domain, delivery, collaboration, and one believable impact. Match career level to generated experience. No JD copy-paste, no clichés, no unsupported metrics.
- Experience length: follow per-company Length rules (Company #1 and #2 lead with 2–3 three-line bullets).
- NEVER use the JD hiring company as an experience employer. Company names must be distinct from the employer posting the JD.
- Experience: follow JD_EXPERIENCE_PROJECT_RULES — all bullets for a company come from one project memory; never print the memory; keep stories different across companies.
- NEVER include projectName, "project memory", team-size labels, or raw memory fields in summary, skills, or experience text.
- When UserGuidance is provided for a company, fold it into that company's project memory / bullets.
- PRESENT / MOST RECENT company (first in the list): carry a larger share of JD required skills/tools naturally across its bullet SET (not every bullet). Older companies stay JD-aligned with different project stories and fewer overlapping keywords.
- For experience, include AI in at most ONE company only when it fits that project's context — never in every company. Do not force an AI line into the Professional Summary unless it naturally fits one of the six summary purposes.
- Technical Skills: follow JD_SKILLS_RULES exactly (complete technical index of resume + JD; relevant categories only; no soft skills; each skill once; no research-only tools; no banned/dump category names).
- skills + technicalSkills: flat unique list matching skillCategories.
- When reference material is provided: preserve strong original wording for experience; include reference technical tools in Skills only if they are real tools and fit the role; for summary, adapt reference themes into the six-purpose structure without inventing unrelated claims.
- summaryBullets: return EXACTLY ${summaryCount} bullets per JD_SUMMARY_BULLET_RULES. Leave "summary" as a short 1–2 sentence overview.
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
- Required Professional Summary bullets: EXACTLY ${summaryCount} (concise; six purposes in order)
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
- JD technical skills to place in Skills and/or Experience when they are real tools (not vague soft skills): ${jdSkills.join(', ') || '(extract from JD text)'}

Companies (present→past order already applied by caller — #1 is present/most recent).
For each company: write bullets ONLY from that company's INTERNAL project memory:
${companyLines || '(none)'}
${projectMemoryBlock}${companyContextBlock}
${refBlock || '(No reference document — create believable, human, JD-matched project stories with FULL two-line depth.)'}

Raw JD excerpt (for extra context):
${String(formData.jdText || '').slice(0, 4500)}

Generate the complete resume JSON only (no project memories in the output). Follow JD_SUMMARY_BULLET_RULES, JD_EXPERIENCE_PROJECT_RULES, and JD_SKILLS_RULES.`,
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

const JD_REVISE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    resume: {
      type: 'object',
      properties: BUILD_RESUME_SCHEMA.properties,
      required: BUILD_RESUME_SCHEMA.required,
      additionalProperties: false,
    },
  },
  required: ['reply', 'resume'],
  additionalProperties: false,
}

/**
 * Apply a user chat request to an existing JD-tailored resume JSON.
 * Prefers Claude, then ChatGPT, then Gemini.
 */
export async function reviseJdResumeFromChat({
  resumeData,
  message,
  jdData = null,
  builderInput = null,
}) {
  const text = String(message || '').trim()
  if (!text) throw new Error('Revision message is required')
  if (!resumeData || typeof resumeData !== 'object') {
    throw new Error('No resume data available to revise — build a resume first')
  }

  const form = builderInput && typeof builderInput === 'object' ? builderInput : {}
  const roleTitle = String(jdData?.roleTitle || form.role || resumeData.title || '').trim()

  const result = await jsonCompletion(
    `You are JoBPilot's JD-Tailored Resume revision assistant.
The user already has a generated resume. Apply ONLY what they ask in their message.
Return the FULL updated resume JSON plus a short reply confirming what you changed.

Rules:
- Prefer Claude-quality writing: strong action verbs, JD-aligned keywords, human tone.
- Keep contact identity (name/email/phone/location) unless the user explicitly asks to change them.
- If they ask to rename/replace companies, update experience company names and related bullets.
- If they ask to add/remove/rewrite bullets, skills, summary, education, or titles — do that precisely.
- Preserve overall structure (summaryBullets, skillCategories, experience, education).
- Do not invent a brand-new resume from scratch unless they ask for a full rewrite.
- reply: 1–3 short sentences describing what you changed (no JSON in reply).`,
    `User revision request:
${text.slice(0, 4000)}

Target role: ${roleTitle || '(from resume)'}
Hiring company (do not reuse as employer unless user asks): ${String(jdData?.hiringCompany || '').trim() || '(n/a)'}
JD skills/keywords: ${[
      ...(jdData?.requiredSkills || []),
      ...(jdData?.mustHaveKeywords || []),
      ...(jdData?.toolsTechnologies || []),
    ].slice(0, 40).join(', ') || '(n/a)'}

Current resume JSON:
${JSON.stringify(resumeData).slice(0, 28000)}

Return updated resume JSON and a short reply.`,
    'revise_jd_resume',
    JD_REVISE_SCHEMA,
    { maxTokens: 8192, preferProviders: ['claude', 'openai', 'gemini'] },
  )

  const next = result?.resume && typeof result.resume === 'object' ? result.resume : null
  if (!next) throw new Error('AI did not return an updated resume')

  // Keep identity stable unless the user clearly asked to change contact fields
  const keepContact = !/\b(change|update|fix|replace)\b.{0,40}\b(name|email|phone|contact|location|linkedin)\b/i.test(text)
  if (keepContact) {
    next.name = resumeData.name || form.name || next.name
    next.email = resumeData.email || form.email || next.email
    next.phone = resumeData.phone || form.phone || next.phone
    next.location = resumeData.location
      || [form.city, form.state].filter(Boolean).join(', ')
      || next.location
  }

  return {
    reply: String(result?.reply || 'Updated your resume.').slice(0, 800),
    resumeData: next,
  }
}

const JD_CHAT_EXPERIENCE_SCHEMA = {
  type: 'object',
  properties: {
    companyName: { type: 'string' },
    jobTitle: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    bulletCount: { type: 'string' },
    summary: { type: 'string' },
    country: { type: 'string' },
  },
  required: [
    'companyName',
    'jobTitle',
    'city',
    'state',
    'startDate',
    'endDate',
    'bulletCount',
    'summary',
    'country',
  ],
  additionalProperties: false,
}

const JD_WIZARD_CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    navigateToStep: {
      type: 'string',
      description: 'Optional step id: basic, jd, target, references, templates, preview, saved, or empty',
    },
    reviseGeneratedResume: {
      type: 'boolean',
      description: 'True when user wants changes to the already-built DOCX resume content',
    },
    projectUpdates: {
      type: 'object',
      properties: {
        basicInformation: {
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            linkedin: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
          },
          additionalProperties: false,
        },
        targetRole: {
          type: 'object',
          properties: {
            jobTitle: { type: 'string' },
            yearsRequired: { type: 'string' },
            companyCount: { type: 'string' },
            jobDescription: { type: 'string' },
            aiIndustry: { type: 'string' },
          },
          additionalProperties: false,
        },
        experiences: {
          type: 'array',
          items: JD_CHAT_EXPERIENCE_SCHEMA,
        },
        selectedTemplateId: { type: 'string' },
        fontFamily: { type: 'string' },
        fontSizePt: { type: 'string' },
        keywordHighlight: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  required: ['reply', 'reviseGeneratedResume'],
  additionalProperties: false,
}

/**
 * Conversational JD wizard assistant — edits draft project fields and/or flags DOCX revision.
 */
export async function chatJdWizardAssistant({
  message,
  project = null,
  stepId = '',
  thread = [],
  hasBuiltResume = false,
}) {
  const text = String(message || '').trim()
  if (!text) throw new Error('Message is required')

  const recent = (Array.isArray(thread) ? thread : [])
    .slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.text || '').slice(0, 500)}`)
    .join('\n')

  const slimProject = {
    basicInformation: project?.basicInformation || {},
    targetRole: {
      jobTitle: project?.targetRole?.jobTitle || '',
      yearsRequired: project?.targetRole?.yearsRequired || '',
      companyCount: project?.targetRole?.companyCount || '',
      jobDescription: String(project?.targetRole?.jobDescription || '').slice(0, 2500),
      aiIndustry: project?.targetRole?.aiIndustry || '',
    },
    experiences: (project?.experiences || []).map((e) => ({
      companyName: e.companyName || '',
      jobTitle: e.jobTitle || '',
      city: e.city || '',
      state: e.state || '',
      startDate: e.startDate || '',
      endDate: e.endDate || '',
      bulletCount: String(e.bulletCount || ''),
      summary: String(e.summary || '').slice(0, 400),
      country: e.country || '',
    })),
    selectedTemplateId: project?.selectedTemplateId || '',
    fontFamily: project?.fontFamily || '',
    fontSizePt: String(project?.fontSizePt || ''),
    keywordHighlight: Boolean(project?.keywordHighlight),
    sessionId: project?.sessionId || null,
  }

  const result = await jsonCompletion(
    `You are JoBPilot's JD-Tailored Resume Builder assistant chat.
You help across ALL wizard steps (basics, JD, target/companies, references, templates, preview).

Return JSON with:
- reply: short helpful answer (what you changed or what user should do next)
- projectUpdates: only fields the user asked to change (omit unchanged sections)
- experiences: when renaming/replacing/adding/removing companies, return the FULL updated experiences list (1–6 items)
- reviseGeneratedResume: true ONLY if a resume was already built AND the user wants content changes in that generated DOCX (bullets/summary/skills rewrite). False for draft form edits only.
- navigateToStep: optional step id if you want to send them somewhere (basic|jd|target|references|templates|preview|saved)

Rules:
- Prefer Claude-quality clarity. Do exactly what the user asks.
- Dates format like "Jan 2020" or "Present".
- bulletCount must be a string number within allowed ranges by company rank (1st 12-14, 2nd 11-13, 3rd 10-12, 4th 9-11, 5th+ 7-9).
- Never invent a full fake JD unless asked.
- If hasBuiltResume is false, set reviseGeneratedResume=false and edit draft fields instead.
- If user asks to change companies before build, update experiences (not reviseGeneratedResume).
- If user asks to change companies/bullets after build, set reviseGeneratedResume=true AND update experiences when names/roles change.`,
    `Current step: ${stepId || '(unknown)'}
Has built resume DOCX: ${hasBuiltResume ? 'yes' : 'no'}

Recent chat:
${recent || '(none)'}

Current project JSON:
${JSON.stringify(slimProject).slice(0, 18000)}

User message:
${text.slice(0, 4000)}`,
    'jd_wizard_chat',
    JD_WIZARD_CHAT_SCHEMA,
    { maxTokens: 4096, preferProviders: ['claude', 'openai', 'gemini'] },
  )

  return {
    reply: String(result?.reply || 'Okay.').slice(0, 1200),
    projectUpdates: result?.projectUpdates && typeof result.projectUpdates === 'object'
      ? result.projectUpdates
      : null,
    navigateToStep: String(result?.navigateToStep || '').trim() || null,
    reviseGeneratedResume: Boolean(result?.reviseGeneratedResume),
  }
}


