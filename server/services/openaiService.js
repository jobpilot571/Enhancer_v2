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
- Each bullet: one clear achievement, complete thought, MAX 18–22 words / about 1–2 lines. Never exceed 2 lines.
- Do NOT start bullets with a bullet character (•). Plain sentence text only.
- Sound like a confident professional, not a job description copy.`

export async function parseResume(resumeText) {
  return jsonCompletion(
    `You are a resume parsing expert. Extract ALL structured data from the resume text. Include every section, heading, bullet, skill, company, title, and date. Return complete JSON.
For SUMMARY/PROFILE/OBJECTIVE:
- If the summary is a prose paragraph (not a bullet list), put the full text in "summary" and leave summaryBullets as [].
- If the summary is a bullet list, put each bullet in summaryBullets and put a short joined overview in "summary".
Never invent bullets from a paragraph summary.`,
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
  const isParagraph = (resumeData.summaryFormat || '').toLowerCase() === 'paragraph'
    || (!(resumeData.summaryBullets || []).length && !!(resumeData.summary || '').trim())

  if (isParagraph) {
    return jsonCompletion(
      `Enhance a PARAGRAPH-style professional summary for JD alignment.
CRITICAL FORMAT RULE: The original summary is a prose paragraph — return 1-2 NEW prose SENTENCES (not bullets, no leading • or dashes).
These sentences will be woven into the existing paragraph. Keep each sentence under ~35 words.
Do NOT rewrite the whole summary unless needed; prefer additive sentences that weave missing JD skills/tools naturally.
Optionally return bulletRewrites with company="Summary" where original is EXACT existing summary text and replacement is the full enhanced paragraph.`,
      `Existing paragraph summary:\n${resumeData.summary || ''}
Existing summary bullets (should be empty for paragraph resumes):\n${JSON.stringify(resumeData.summaryBullets || [], null, 2)}
Missing skills to weave in:\n${JSON.stringify((comparison.missing || []).slice(0, 12), null, 2)}
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

  return jsonCompletion(
    `Create 1-2 NEW summary bullets for 99% JD alignment. ${BULLET_RULES}
ALWAYS return summaryBullets with 1-2 brand-new bullets (preferred).
Do NOT paraphrase, extend, or lightly rewrite any existing summary bullet — invent a different achievement angle.
Optionally also return bulletRewrites with company="Summary" if rewriting existing text helps.
bulletRewrites.original must be EXACT text from resumeData.summaryBullets when used.
Do NOT leave summaryBullets empty.
Weave missing JD skills/tools into the new bullets naturally.`,
    `Existing summary bullets in resume (DO NOT repeat or paraphrase these):\n${JSON.stringify(resumeData.summaryBullets, null, 2)}
Missing skills to weave into bullets:\n${JSON.stringify((comparison.missing || []).slice(0, 12), null, 2)}
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

  // Compact payload — faster AI, same quality rules
  const summaryFormat = (resumeData.summaryFormat || (
    (!(resumeData.summaryBullets || []).length && (resumeData.summary || '').trim()
      ? 'paragraph'
      : 'bullets')
  ))
  const compactResume = {
    name: resumeData.name,
    summaryFormat,
    summary: (resumeData.summary || '').slice(0, 600),
    summaryBullets: (resumeData.summaryBullets || []).slice(0, 8),
    skills: [...new Set([...(resumeData.skills || []), ...(resumeData.technicalSkills || [])])].slice(0, 40),
    headings: (resumeData.headings || []).slice(0, 20),
    experience: (resumeData.experience || []).map((e) => ({
      company: e.company,
      title: e.title,
      bullets: (e.bullets || []).slice(0, 6),
    })),
  }
  const compactJd = {
    roleTitle: jdData.roleTitle,
    requiredSkills: (jdData.requiredSkills || []).slice(0, 20),
    preferredSkills: (jdData.preferredSkills || []).slice(0, 12),
    toolsTechnologies: (jdData.toolsTechnologies || []).slice(0, 20),
    mustHaveKeywords: (jdData.mustHaveKeywords || []).slice(0, 20),
    domainKeywords: (jdData.domainKeywords || []).slice(0, 12),
    responsibilities: (jdData.responsibilities || []).slice(0, 12),
  }
  const compactComparison = {
    missing: (comparison.missing || []).slice(0, 25),
    present: (comparison.present || []).slice(0, 20),
    atsScore: comparison.atsScore,
  }

  return jsonCompletion(
    `You are an expert resume writer. Create an enhancement plan to achieve 99% alignment with the job description.

${BULLET_RULES}

Enhancement rules (ALL mandatory):
- Preserve original section order, fonts, and resume structure exactly.
- SUMMARY FORMAT RULE (critical): resumeData.summaryFormat is "${summaryFormat}".
  ${summaryFormat === 'paragraph'
    ? '- Paragraph summary: return 1-2 NEW prose SENTENCES in summaryBullets (no bullet glyphs). They will be woven into the existing paragraph. Do NOT convert the summary into a bullet list.'
    : '- Bullet summary: Always return 1-2 NEW summaryBullets that are NOT paraphrases of existing summary bullets. Prefer brand-new JD-aligned achievements.'}
- NEVER return a summary item that repeats or lightly rewords an existing resume summary.
- MANDATORY PER COMPANY: experienceAdditions MUST include EVERY company listed below, each with 1-2 bullets. Prefer experienceAdditions over rewrites for coverage. No company may be skipped.
- Companies in resume (include ALL of these in experienceAdditions): ${companies.join(' | ') || 'none'}
- JD priority keywords (use each ONCE across the whole resume — never repeat the same keyword in multiple bullets): ${jdPriority.join(', ') || 'see comparison.missing'}
- MANDATORY SKILLS LIST: skillsByCategory MUST add SHORT tool/skill names only (e.g. "Jira", "Fiber optics", "AWS") under EXISTING resume category lines (e.g. "Tools & Platforms:", "Cloud & DevOps:"). NEVER invent a new "Technical Skills" heading. NEVER paste JD sentences, soft skills paragraphs, benefits, PTO, equipment, or multi-clause phrases into skills.
- MANDATORY SKILLS IN BULLETS: Missing JD tools that are added to skillsByCategory MUST also appear naturally in at least one new summary or experience bullet (weave 1–2 tools into storytelling — do not dump a skill list into a bullet).
- Never create underlined headings. Never duplicate the Technical Skills section.
- New bullets go in the MIDDLE of lists — never first or last bullet in any section or company.
- bulletRewrites.original must be copied EXACTLY from resumeData summaryBullets or experience bullets.
- experienceAdditions.company must match resume experience company names exactly.
- strategy: brief plan covering summary, each company, and skills.
- Completeness check before answering: summary present and unique? every company in experienceAdditions? every missing skill in skillsByCategory AND mentioned in a bullet? If not, fix before returning.`,
    `Resume:\n${JSON.stringify(compactResume)}\n\nJD:\n${JSON.stringify(compactJd)}\n\nComparison:\n${JSON.stringify(compactComparison)}`,
    'enhancement_plan',
    PLAN_SCHEMA,
  )
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

  return jsonCompletion(
    `You are an expert resume writer creating a professional resume from scratch for someone who does not have one yet.

${BULLET_RULES}

Hard rules:
- Use the EXACT company names, job titles, and dates the user provided. Do not rename companies or invent extra jobs.
- Write EXACTLY ${bulletsPerCompany} bullets for EACH company (no more, no less).
- Weave the user-selected skills for each company naturally into that company's bullets.
- Bullets must be role-appropriate for "${formData.role}" with about ${years} years of experience.
- Make bullets sound human and specific — tools, projects, outcomes — never generic filler.
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

Generate the complete resume JSON.`,
    'build_resume',
    BUILD_RESUME_SCHEMA,
  )
}
