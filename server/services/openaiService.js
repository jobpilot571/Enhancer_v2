import { structuredJSON } from './aiProvider.js'

async function jsonCompletion(systemPrompt, userPrompt, schemaName, schema) {
  const { result, provider } = await structuredJSON(systemPrompt, userPrompt, schemaName, schema)
  console.log(`[AI] ${schemaName} handled by ${provider}`)
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

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    strategy: { type: 'string' },
    summaryBullets: { type: 'array', items: { type: 'string' } },
    experienceAdditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['company', 'bullets'],
        additionalProperties: false,
      },
    },
    skillsByCategory: {
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
    skillsToAdd: { type: 'array', items: { type: 'string' } },
    bulletRewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['original', 'replacement', 'company'],
        additionalProperties: false,
      },
    },
    keywordsAdded: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['strategy', 'summaryBullets', 'experienceAdditions', 'skillsByCategory', 'skillsToAdd', 'bulletRewrites', 'keywordsAdded', 'rationale'],
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
- Each bullet: one clear achievement, complete thought, 1–2 lines max.
- Sound like a confident professional, not a job description copy.`

export async function parseResume(resumeText) {
  return jsonCompletion(
    'You are a resume parsing expert. Extract ALL structured data from the resume text. Include every section, heading, bullet, skill, company, title, and date. Return complete JSON.',
    `Parse this resume:\n\n${resumeText}`,
    'resume_parse',
    RESUME_SCHEMA,
  )
}

export async function parseJD(jdText) {
  return jsonCompletion(
    'You are a job description parsing expert. Extract role title, required/preferred skills, responsibilities, tools, domain keywords, and must-have/highlighted keywords.',
    `Parse this job description:\n\n${jdText}`,
    'jd_parse',
    JD_SCHEMA,
  )
}

export async function createMissingExperienceBullets(missingCompanies, resumeData, jdData, comparison) {
  const list = missingCompanies.map((c) => `${c.company} (${c.title || 'role'})`).join(' | ')
  const result = await jsonCompletion(
    `You write 1-2 impressive storytelling experience bullets per company. ${BULLET_RULES}`,
    `These companies each need 1-2 NEW bullets: ${list}
Use JD keywords once, no duplicates. Return experienceAdditions — each entry must have company matching exactly and bullets array with 1-2 items.

Resume:\n${JSON.stringify(resumeData, null, 2)}
JD:\n${JSON.stringify(jdData, null, 2)}
Missing skills:\n${JSON.stringify(comparison.missing, null, 2)}`,
    'missing_experience',
    {
      type: 'object',
      properties: {
        experienceAdditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
            },
            required: ['company', 'bullets'],
            additionalProperties: false,
          },
        },
      },
      required: ['experienceAdditions'],
      additionalProperties: false,
    },
  )
  return result.experienceAdditions || []
}

export async function createSummaryEnhancement(resumeData, jdData, comparison) {
  return jsonCompletion(
    `Create 1-2 summary enhancements for 99% JD alignment. ${BULLET_RULES}
Return 1-2 summaryBullets (new bullets) OR 1-2 bulletRewrites with company="Summary" (or both totaling 1-2 actions).
bulletRewrites.original must be EXACT text from resumeData.summaryBullets.`,
    `Summary bullets in resume:\n${JSON.stringify(resumeData.summaryBullets, null, 2)}
JD:\n${JSON.stringify(jdData, null, 2)}
Priority keywords:\n${JSON.stringify([...(jdData.mustHaveKeywords || []), ...(comparison.missing || [])].slice(0, 12), null, 2)}`,
    'summary_enhancement',
    {
      type: 'object',
      properties: {
        summaryBullets: { type: 'array', items: { type: 'string' } },
        bulletRewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              replacement: { type: 'string' },
              company: { type: 'string' },
            },
            required: ['original', 'replacement', 'company'],
            additionalProperties: false,
          },
        },
      },
      required: ['summaryBullets', 'bulletRewrites'],
      additionalProperties: false,
    },
  )
}

export async function createEnhancementPlan(resumeData, jdData, comparison) {
  const companies = (resumeData.experience || []).map((e) => e.company).filter(Boolean)
  const jdPriority = [
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.requiredSkills || []),
    ...(comparison.missing || []),
  ].slice(0, 20)

  return jsonCompletion(
    `You are an expert resume writer. Create an enhancement plan to achieve 99% alignment with the job description.

${BULLET_RULES}

Enhancement rules (ALL mandatory):
- Preserve original section order, fonts, and resume structure exactly.
- MANDATORY SUMMARY: Add 1-2 new summaryBullets OR rewrite 1-2 existing summary bullets (bulletRewrites company="Summary").
- MANDATORY PER COMPANY: Every company below must receive 1-2 new bullets (experienceAdditions) OR 1-2 rewrites (bulletRewrites). No company may be skipped.
- Companies in resume: ${companies.join(' | ') || 'none'}
- JD priority keywords (use each ONCE across the whole resume — never repeat the same keyword in multiple bullets): ${jdPriority.join(', ') || 'see comparison.missing'}
- Only add skills from comparison.missing that are NOT already in the resume.
- skillsByCategory: add under EXISTING category lines only (e.g. "Data & Reporting:", "Domain:"). Short skill names only.
- Never duplicate skills, bullets, or keywords already in the resume.
- New bullets go in the MIDDLE of lists — never first or last bullet in any section or company.
- bulletRewrites.original must be copied EXACTLY from resumeData summaryBullets or experience bullets.
- experienceAdditions.company must match resume experience company names exactly.
- strategy: brief plan covering summary, each company, and skills.`,
    `Resume data:\n${JSON.stringify(resumeData, null, 2)}\n\nJD data:\n${JSON.stringify(jdData, null, 2)}\n\nComparison:\n${JSON.stringify(comparison, null, 2)}`,
    'enhancement_plan',
    PLAN_SCHEMA,
  )
}
