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
        },
        required: ['company', 'original', 'replacement'],
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

const BULLET_RULES = `Bullet writing rules (strict — every bullet MUST follow ALL of these):
- Write like a human professional telling a real project story — not AI-generated or generic.
- Show real-time project involvement: what YOU did, at WHICH company, using WHICH tools, with WHAT outcome.
- Be technical and specific: name tools (SQL, Power BI, Tableau, Python, Jira, etc.), methods, and deliverables.
- Be impressive but believable for the candidate's role, seniority, and industry.
- Use strong action verbs (Led, Built, Designed, Automated, Optimized, Delivered).
- Include measurable impact where possible (%, time saved, volume, users, revenue).
- Weave 1–2 JD keywords naturally — never keyword-stuff.
- Each bullet: one clear achievement, complete thought, MAX 18–22 words / about 1–2 lines. Never exceed 2 lines.
- Do NOT start bullets with a bullet character (•). Plain sentence text only.
- Sound like a confident professional, not a job description copy.`

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
  for (const r of raw.experienceRewrites || []) {
    const company = String(r.company || '').trim()
    if (!company) continue
    const original = String(r.original || '').trim()
    const replacement = String(r.replacement || '').trim()
    if (!replacement) continue
    if (original) {
      bulletRewrites.push({ company, original, replacement })
    } else {
      const list = byCompany.get(company) || []
      list.push(replacement)
      byCompany.set(company, list.slice(0, 2))
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
 */
export async function createEnhancementPlan(resumeData, jdData, comparison) {
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
      bullets: (e.bullets || []).slice(0, 5),
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
    responsibilities: (jdData.responsibilities || []).slice(0, 8),
  }

  const limits = {
    maxSummaryItems: 2,
    maxNewBulletsPerCompany: 2,
    companiesMustCover: companies,
    maxSkillNames: 12,
    // Aim for strong JD keyword coverage after enhancement
    minDomainKeywordsToWeave: Math.min(6, gaps.missingDomainKeywords.length || 0),
  }

  const raw = await jsonCompletion(
    `You are an expert resume writer. Return ONE complete enhancement plan as JSON only.

${BULLET_RULES}

Output fields:
- summaryRewrites: 0–2 items. For NEW summary text set original="" and replacement=new sentence/bullet. For rewrite set original to EXACT existing text. summaryFormat="${summaryFormat}".
- experienceRewrites: cover companies when useful. For NEW bullets set original="" and replacement=new bullet (1–2 per company). For rewrite set original to EXACT existing bullet. company must match resume exactly.
- skillAdditions: ONLY concrete tools/hard skills from gaps.missingSkills (e.g. SQL, Tableau, DBT, Power BI). Never put domain phrases, soft outcomes, or years claims in skills (forbidden: "student success", "learner behaviors", "data-driven research", "4+ years"). Use EXISTING category labels only. Never invent "Technical Skills".

Rules:
- Prefer additions (empty original) over rewrites.
- Compare resume vs gaps line-by-line: add what is missing; do not restate what already exists.
- SUMMARY: Do NOT repeat years-of-experience ("4+ years", "X years") if the resume summary already states tenure. Add JD-aligned impact/tools only.
- DOMAIN KEYWORDS go ONLY into summary/experience bullets — NEVER into skillAdditions. Weave gaps.missingDomainKeywords naturally (target limits.minDomainKeywordsToWeave). Each phrase once.
- When missingSkills is non-empty: put those tools in skillAdditions AND mention 1–2 of them in new experience bullets so they earn full evidence credit.
- Cover gaps.responsibilities with new experience bullets where the resume is thin.
- Do not send education/contact changes.
- Use allowed vocabulary naturally.
- Empty arrays are allowed only when gaps are already covered.
- Stay within change limits.`,
    JSON.stringify({
      resume: compactResume,
      gaps,
      allowedVocabulary: allowedVocab,
      limits,
    }),
    'enhancement_plan',
    COMPACT_PLAN_SCHEMA,
    { maxTokens: 1800 },
  )

  return normalizeEnhancementPlan(raw)
}

/**
 * Technical-failure repair only — not used when plan arrays are merely empty.
 */
export async function repairEnhancementPlan(resumeData, jdData, comparison, reason) {
  console.warn(`[AI] enhancement_plan repair: ${reason}`)
  return createEnhancementPlan(resumeData, jdData, comparison)
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
  const refBlock = ref
    ? [
      'Reference document material (PREFERRED facts / bullet themes — strengthen, do not invent conflicting employers):',
      ref.fileName ? `- Source file: ${ref.fileName}` : '',
      refSummary.length
        ? `- Summary lines to reuse/adapt:\n${refSummary.slice(0, 10).map((b) => `  • ${b}`).join('\n')}`
        : '',
      ...refExperience.map((exp, i) => {
        const bullets = (exp.bullets || []).slice(0, 12)
        if (!bullets.length) return ''
        return `- Ref job ${i + 1}: "${exp.company || '?'}" / "${exp.title || '?'}"\n${bullets.map((b) => `  • ${b}`).join('\n')}`
      }),
    ].filter(Boolean).join('\n')
    : ''

  return jsonCompletion(
    `You are an expert resume writer creating a professional resume from scratch for someone who does not have one yet.

${BULLET_RULES}

Hard rules:
- Use the EXACT company names, job titles, and dates the user provided. Do not rename companies or invent extra jobs.
- Write EXACTLY ${bulletsPerCompany} bullets for EACH company (no more, no less).
- Weave the user-selected skills for each company naturally into that company's bullets.
- Bullets must be role-appropriate for "${formData.role}" with about ${years} years of experience.
- Make bullets sound human and specific — tools, projects, outcomes — never generic filler.
- When reference document material is provided: reuse and polish those bullets for the matching company (same company name or closest match). Keep real achievements, metrics, and tools from the reference. You may rewrite for clarity and ATS impact, but do not invent fake employers or unrelated claims.
- Prefer reference summary lines when writing summaryBullets (polish them; fill remaining slots if needed).
- summaryBullets: return 4–8 strong summary bullets (leave summary as a short 1–2 sentence overview).
- skillCategories: group ALL user-selected skills (plus closely related tools) into 4–8 categories like "Tools", "Data & Reporting", "Methodologies". Prefer the user's selected skills as the core list.
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
- User-selected skills (must appear in skillCategories): ${allUserSkills.join(', ') || '(none — invent realistic skills for the role)'}
- Summary notes from user (optional guidance): ${formData.summaryNotes || '(none — invent a strong summary)'}

Companies (write ${bulletsPerCompany} bullets each; use that company's skills in bullets):
${companyLines || '(none)'}

Education:
- School: ${education.school || ''}
- Course: ${education.course || ''}
- Degree: ${education.degree || ''}
- Start: ${education.startDate || ''}
- End: ${education.endDate || ''}

${refBlock || '(No reference document — invent strong, role-appropriate bullets.)'}

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

${BULLET_RULES}

Hard rules:
- The candidate has NO existing resume — invent believable, JD-aligned content from their facts + the JD.
- Resume target role / title MUST be exactly: "${roleTitle}" (the JD role). Do not use a different title.
- Use the EXACT company names, per-company roles, and dates the user provided. Do not rename companies or invent extra jobs.
- For EACH company, write EXACTLY the BulletCount listed for that company (no more, no less).
- Align every bullet to JD responsibilities, tools, and keywords — sound like someone who already does this job.
- If a company has OptionalSummaryGuidance, use it as soft guidance for that company's bullets (do not copy it verbatim into bullets unless it fits).
- summaryBullets: return EXACTLY ${summaryCount} strong, JD-aligned summary bullets. Leave "summary" as a short 1–2 sentence overview.
- skillCategories: return 5–7 category headings. Include ALL JD skills/tools and closely related skills. Category examples: Languages, Frontend, Backend, Cloud, Databases, DevOps, Tools, Methodologies.
- skills + technicalSkills: flat list of the same skill names (short names only). Prefer JD vocabulary.
- email/phone/location: copy from user input.
- education: return [] (empty array) unless the user provided education (they did not).
- Return experience entries in the SAME order as the companies listed.`,
    `Candidate:
- Name: ${formData.name}
- Email: ${formData.email || ''}
- Phone: ${formData.phone || ''}
- City/State: ${[formData.city, formData.state].filter(Boolean).join(', ') || formData.location || ''}
- User role hint: ${formData.role || '(use JD role)'}
- Years of experience: ${years}
- Required summary bullet count: ${summaryCount}

JD analysis (tailor heavily to this):
- Role title: ${roleTitle}
- Required skills: ${(jdData?.requiredSkills || []).join(', ') || '(see JD text)'}
- Preferred skills: ${(jdData?.preferredSkills || []).join(', ') || ''}
- Tools/technologies: ${(jdData?.toolsTechnologies || []).join(', ') || ''}
- Must-have keywords: ${(jdData?.mustHaveKeywords || []).join(', ') || ''}
- Domain keywords: ${(jdData?.domainKeywords || []).join(', ') || ''}
- Key responsibilities: ${(jdData?.responsibilities || []).slice(0, 12).join(' | ') || ''}
- All JD skills to cover: ${jdSkills.join(', ') || '(extract from JD text)'}

Companies (present→past order already applied by caller):
${companyLines || '(none)'}

Raw JD excerpt (for extra context):
${String(formData.jdText || '').slice(0, 4500)}

Generate the complete resume JSON.`,
    'build_jd_resume',
    BUILD_RESUME_SCHEMA,
    { maxTokens: 5096 },
  )
}
