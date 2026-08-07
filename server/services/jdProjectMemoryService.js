import { structuredJSON } from './aiProvider.js'

/**
 * Internal per-company "project memory" for JD Experience writing.
 * Never appears on the resume — used only as grounding for bullets.
 */

const MEMORY_FIELDS = {
  company: { type: 'string' },
  projectName: { type: 'string' },
  businessObjective: { type: 'string' },
  industry: { type: 'string' },
  teamSize: { type: 'string' },
  candidateRole: { type: 'string' },
  dailyResponsibilities: { type: 'array', items: { type: 'string' } },
  systemsInvolved: { type: 'array', items: { type: 'string' } },
  businessUsersInvolved: { type: 'array', items: { type: 'string' } },
  challengesSolved: { type: 'array', items: { type: 'string' } },
  technologiesUsed: { type: 'array', items: { type: 'string' } },
  deliverables: { type: 'array', items: { type: 'string' } },
  productionIssuesHandled: { type: 'array', items: { type: 'string' } },
  deploymentProcess: { type: 'string' },
  businessOutcomes: { type: 'array', items: { type: 'string' } },
}

const MEMORY_REQUIRED = Object.keys(MEMORY_FIELDS)

const SINGLE_MEMORY_SCHEMA = {
  type: 'object',
  properties: MEMORY_FIELDS,
  required: MEMORY_REQUIRED,
  additionalProperties: false,
}

const BATCH_MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: MEMORY_FIELDS,
        required: MEMORY_REQUIRED,
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
}

function strList(value, max = 6) {
  return [...new Set((Array.isArray(value) ? value : []).map((s) => String(s || '').trim()).filter(Boolean))]
    .slice(0, max)
}

function compactMemory(row) {
  return {
    company: String(row?.company || '').trim(),
    projectName: String(row?.projectName || '').trim(),
    businessObjective: String(row?.businessObjective || '').trim().slice(0, 280),
    industry: String(row?.industry || '').trim().slice(0, 120),
    teamSize: String(row?.teamSize || '').trim().slice(0, 80),
    candidateRole: String(row?.candidateRole || '').trim().slice(0, 120),
    dailyResponsibilities: strList(row?.dailyResponsibilities, 6),
    systemsInvolved: strList(row?.systemsInvolved, 6),
    businessUsersInvolved: strList(row?.businessUsersInvolved, 5),
    challengesSolved: strList(row?.challengesSolved, 5),
    technologiesUsed: strList(row?.technologiesUsed, 8),
    deliverables: strList(row?.deliverables, 5),
    productionIssuesHandled: strList(row?.productionIssuesHandled, 4),
    deploymentProcess: String(row?.deploymentProcess || '').trim().slice(0, 220),
    businessOutcomes: strList(row?.businessOutcomes, 4),
  }
}

function industryHintsFromContext(ctx) {
  if (!ctx) return []
  return [
    ...(ctx.verified?.industry || []).map((x) => (typeof x === 'string' ? x : x?.value)),
    ...(ctx.verified?.businessAreas || []).map((x) => (typeof x === 'string' ? x : x?.value)),
    ...(ctx.industryTypical?.businessAreas || []),
  ].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6)
}

function employerPayload(employers, companyContexts) {
  const ctxByCompany = new Map(
    (companyContexts || []).map((row) => [String(row.company || '').trim().toLowerCase(), row]),
  )
  return employers.map((e) => {
    const ctx = ctxByCompany.get(e.company.toLowerCase())
    return {
      ...e,
      industryHints: industryHintsFromContext(ctx),
      typicalTools: [
        ...(ctx?.verified?.platformsAndTechnologies || []).map((x) => (typeof x === 'string' ? x : x?.value)),
        ...(ctx?.industryTypical?.platformsAndTechnologies || []),
      ].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8),
    }
  })
}

function systemPrompt({ years, roleTitle, siblingProjects = [] }) {
  const siblingNote = siblingProjects.length
    ? `\nOther companies already have these project themes — invent a DIFFERENT project (do not reuse objective, systems, or outcomes):\n${siblingProjects.map((p) => `- ${p.company}: ${p.projectName} — ${p.businessObjective}`).join('\n')}`
    : ''

  return `You create an INTERNAL project memory for a JD-tailored resume writer.
Invent ONE coherent, realistic enterprise project the candidate could have worked on at this employer.

The memory is NEVER printed on the resume. It is only used later to write experience bullets.

Include ALL of these fields:
- projectName (internal only — neutral internal name, not a trademarked customer program)
- businessObjective
- industry
- teamSize
- candidateRole
- dailyResponsibilities
- systemsInvolved
- businessUsersInvolved
- challengesSolved
- technologiesUsed
- deliverables
- productionIssuesHandled
- deploymentProcess
- businessOutcomes

Rules (strict):
- Match seniority implied by the job title and overall years of experience (~${years}).
- Align with the target role "${roleTitle || 'the JD role'}" and JD skills/tools when natural.
- Use industryHints only as industry background — do NOT claim a public company initiative as the candidate's exact project.
- Keep lists short and concrete. No resume bullets. No marketing fluff.
- Believable enterprise delivery: systems, business users, production issues, deployment, outcomes.
- The project may include related workstreams, but it must feel like one real engagement the candidate lived through.${siblingNote}`
}

/**
 * Format memories for the resume writer prompt (human-readable labels).
 * Never meant for the resume itself.
 */
export function formatProjectMemoriesForPrompt(memories = []) {
  const rows = (Array.isArray(memories) ? memories : []).filter((m) => m?.company && m?.projectName)
  if (!rows.length) return ''

  const blocks = rows.map((m, i) => {
    const lines = [
      `Company ${i + 1}: ${m.company}`,
      `Project name (INTERNAL ONLY — never print): ${m.projectName}`,
      `Business objective: ${m.businessObjective}`,
      `Industry: ${m.industry}`,
      `Team size: ${m.teamSize}`,
      `Candidate's role: ${m.candidateRole}`,
      `Daily responsibilities: ${(m.dailyResponsibilities || []).join('; ')}`,
      `Systems involved: ${(m.systemsInvolved || []).join('; ')}`,
      `Business users involved: ${(m.businessUsersInvolved || []).join('; ')}`,
      `Challenges solved: ${(m.challengesSolved || []).join('; ')}`,
      `Technologies used: ${(m.technologiesUsed || []).join('; ')}`,
      `Deliverables: ${(m.deliverables || []).join('; ')}`,
      `Production issues handled: ${(m.productionIssuesHandled || []).join('; ')}`,
      `Deployment process: ${m.deploymentProcess}`,
      `Business outcomes: ${(m.businessOutcomes || []).join('; ')}`,
    ]
    return lines.join('\n')
  })

  return `\nINTERNAL project memories (WRITING ONLY — never print projectName, team size labels, deployment text blocks, memory fields, or this block in the resume).
For EACH company, generate ALL experience bullets from that company's SINGLE project memory so every bullet naturally comes from the same enterprise project. The reader should feel the candidate worked on one or more real enterprise projects at that company — but do not invent a second unrelated project for the same company.

${blocks.join('\n\n')}\n`
}

/**
 * Strip accidental project-memory leaks from resume text (projectName, etc.).
 */
export function stripProjectMemoryLeaks(resumeData, projectMemories = []) {
  if (!resumeData) return resumeData
  const names = (projectMemories || [])
    .map((m) => String(m?.projectName || '').trim())
    .filter((n) => n.length >= 4)

  const scrub = (text) => {
    let out = String(text || '')
    for (const name of names) {
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      out = out.replace(re, '').replace(/\s{2,}/g, ' ').trim()
    }
    out = out
      .replace(/\bproject\s*memory\b/gi, '')
      .replace(/\binternal\s*project\s*name\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return out
  }

  return {
    ...resumeData,
    summary: scrub(resumeData.summary),
    summaryBullets: (resumeData.summaryBullets || []).map(scrub),
    experience: (resumeData.experience || []).map((job) => ({
      ...job,
      bullets: (job.bullets || []).map(scrub),
    })),
    projects: (resumeData.projects || []).map((p) => ({
      ...p,
      name: scrub(p.name || p.title || ''),
      title: scrub(p.title || ''),
      description: scrub(p.description || ''),
      bullets: (p.bullets || []).map(scrub),
    })),
  }
}

async function generateOneMemory(employer, jdData, options = {}, siblingProjects = []) {
  const years = Number(options.yearsOfExperience) || 0
  const roleTitle = String(jdData?.roleTitle || '').trim()

  const { result, provider, model, durationMs, costUsd } = await structuredJSON(
    systemPrompt({ years, roleTitle, siblingProjects }),
    JSON.stringify({
      targetRole: roleTitle,
      yearsOfExperience: years,
      jdRequiredSkills: (jdData?.requiredSkills || []).slice(0, 16),
      jdTools: (jdData?.toolsTechnologies || []).slice(0, 16),
      jdResponsibilities: (jdData?.responsibilities || []).slice(0, 10),
      employer,
    }),
    'jd_project_memory',
    SINGLE_MEMORY_SCHEMA,
    { maxTokens: 1400, preferProviders: ['claude', 'openai', 'gemini'] },
  )

  console.log(
    `[AI] jd_project_memory ${employer.company} via ${provider}/${model} ${durationMs}ms $${costUsd}`,
  )

  const memory = compactMemory({ ...result, company: employer.company })
  if (!memory.projectName) return null
  return {
    ...memory,
    candidateRole: memory.candidateRole || employer.role,
  }
}

async function generateMemoriesBatch(employers, jdData, companyContexts, options = {}) {
  const years = Number(options.yearsOfExperience) || 0
  const roleTitle = String(jdData?.roleTitle || '').trim()
  const payload = employerPayload(employers, companyContexts)

  const { result, provider, model, durationMs, costUsd } = await structuredJSON(
    `You create INTERNAL project memories for a JD-tailored resume writer.
For EACH employer, invent ONE coherent, realistic enterprise project the candidate could have worked on.

Each memory must include: projectName (internal only), businessObjective, industry, teamSize, candidateRole, dailyResponsibilities, systemsInvolved, businessUsersInvolved, challengesSolved, technologiesUsed, deliverables, productionIssuesHandled, deploymentProcess, businessOutcomes.

Rules (strict):
- Exactly one project memory per company in the same order as the employers list.
- Each company's project MUST be different (different objective, systems, users, challenges, outcomes).
- Match seniority implied by the job title and overall years of experience (~${years}).
- Align with the target role "${roleTitle || 'the JD role'}" and JD skills/tools when natural.
- Use industryHints only as industry background — do NOT claim a public company initiative as the candidate's exact project.
- projectName is INTERNAL ONLY (never printed on a resume). Prefer neutral internal names.
- Keep lists short and concrete. No resume bullets. No marketing fluff.
- Believable enterprise delivery: systems, business users, production issues, deployment, outcomes.`,
    JSON.stringify({
      targetRole: roleTitle,
      yearsOfExperience: years,
      jdRequiredSkills: (jdData?.requiredSkills || []).slice(0, 16),
      jdTools: (jdData?.toolsTechnologies || []).slice(0, 16),
      jdResponsibilities: (jdData?.responsibilities || []).slice(0, 10),
      employers: payload,
    }),
    'jd_project_memory',
    BATCH_MEMORY_SCHEMA,
    { maxTokens: 3500, preferProviders: ['claude', 'openai', 'gemini'] },
  )

  console.log(
    `[AI] jd_project_memory batch via ${provider}/${model} ${durationMs}ms $${costUsd}`,
  )

  const rows = Array.isArray(result?.memories) ? result.memories.map(compactMemory) : []
  return employers.map((e) => {
    const match = rows.find((r) => r.company.toLowerCase() === e.company.toLowerCase())
      || rows.find((r) => r.company && e.company.toLowerCase().includes(r.company.toLowerCase().slice(0, 8)))
    if (match?.projectName) {
      return { ...match, company: e.company, candidateRole: match.candidateRole || e.role }
    }
    return null
  }).filter(Boolean)
}

/**
 * Generate one internal project memory per employer BEFORE experience bullets are written.
 * Fail-soft: returns [] on total failure so resume generation can continue (writer invents silently).
 *
 * @param {object[]} companies — ordered form companies
 * @param {object} jdData
 * @param {object[]} [companyContexts]
 * @param {object} [options]
 * @param {number} [options.yearsOfExperience]
 * @returns {Promise<object[]>}
 */
export async function generateJdProjectMemories(companies, jdData, companyContexts = [], options = {}) {
  const employers = (Array.isArray(companies) ? companies : [])
    .slice(0, 6)
    .map((c, index) => ({
      company: String(c?.name || c?.company || '').trim(),
      role: String(c?.role || c?.title || '').trim(),
      startDate: String(c?.startDate || '').trim(),
      endDate: String(c?.endDate || '').trim() || 'Present',
      userGuidance: String(c?.summary || '').trim(),
      index,
    }))
    .filter((e) => e.company)

  if (!employers.length) return []

  const payload = employerPayload(employers, companyContexts)

  // Prefer one dedicated memory call per company (clearer "before bullets" grounding).
  // Fall back to a single batch call if per-company generation yields nothing.
  try {
    const memories = []
    for (const employer of payload) {
      try {
        const siblingProjects = memories.map((m) => ({
          company: m.company,
          projectName: m.projectName,
          businessObjective: m.businessObjective,
        }))
        const memory = await generateOneMemory(employer, jdData, options, siblingProjects)
        if (memory) memories.push(memory)
      } catch (err) {
        console.warn(`[AI] jd_project_memory failed for ${employer.company}: ${err.message}`)
      }
    }

    if (memories.length) return memories

    console.warn('[AI] jd_project_memory per-company empty — trying batch')
    return await generateMemoriesBatch(employers, jdData, companyContexts, options)
  } catch (err) {
    console.warn(`[AI] jd_project_memory failed (continuing without): ${err.message}`)
    try {
      return await generateMemoriesBatch(employers, jdData, companyContexts, options)
    } catch (batchErr) {
      console.warn(`[AI] jd_project_memory batch also failed: ${batchErr.message}`)
      return []
    }
  }
}
