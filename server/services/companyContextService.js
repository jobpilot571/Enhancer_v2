import { structuredJSON } from './aiProvider.js'
import {
  researchOneCompanyWithCache,
  llmFallbackToResearchRow,
  isTavilyConfigured,
} from './jdCompanyWebResearch.js'

/**
 * Build company / industry context to ground resume writing.
 *
 * Uses Groq first when GROQ_API_KEY is set (fast LLM knowledge of companies —
 * NOT live Twitter/news). Context is public-company style: industry, products,
 * typical initiatives. Never invents the candidate's personal projects.
 */

const COMPANY_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          industry: { type: 'string' },
          businessFocus: { type: 'string' },
          productsOrServices: { type: 'array', items: { type: 'string' } },
          typicalInitiatives: { type: 'array', items: { type: 'string' } },
          systemsOrDomains: { type: 'array', items: { type: 'string' } },
          stakeholderTypes: { type: 'array', items: { type: 'string' } },
          alignmentTips: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'company',
          'industry',
          'businessFocus',
          'productsOrServices',
          'typicalInitiatives',
          'systemsOrDomains',
          'stakeholderTypes',
          'alignmentTips',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['companies'],
  additionalProperties: false,
}

/** JD-builder research: public industry context for form employers (no bullets yet). */
const JD_COMPANY_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          industry: { type: 'string' },
          businessArea: { type: 'string' },
          commonSystems: { type: 'array', items: { type: 'string' } },
          realisticProjects: { type: 'array', items: { type: 'string' } },
          commonTools: { type: 'array', items: { type: 'string' } },
          workflows: { type: 'array', items: { type: 'string' } },
          commonResponsibilities: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'company',
          'industry',
          'businessArea',
          'commonSystems',
          'realisticProjects',
          'commonTools',
          'workflows',
          'commonResponsibilities',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['companies'],
  additionalProperties: false,
}

function compactExperience(resumeData) {
  return (resumeData?.experience || []).slice(0, 6).map((e) => ({
    company: e.company || '',
    title: e.title || '',
    dates: e.dates || '',
    sampleBullets: (e.bullets || []).slice(0, 4),
  })).filter((e) => e.company)
}

function formatEmploymentPeriod(startDate, endDate) {
  const start = String(startDate || '').trim()
  const end = String(endDate || '').trim() || 'Present'
  if (!start) return end === 'Present' ? '' : end
  return `${start} – ${end}`
}

function compactJdCompanies(companies) {
  return (Array.isArray(companies) ? companies : [])
    .slice(0, 6)
    .map((c) => ({
      company: String(c?.name || c?.company || '').trim(),
      title: String(c?.role || c?.title || '').trim(),
      employmentPeriod: formatEmploymentPeriod(c?.startDate, c?.endDate),
      location: [c?.city, c?.state, c?.country].filter(Boolean).join(', '),
    }))
    .filter((c) => c.company)
}

function normalizeEnhancerRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      company: String(row.company || '').trim(),
      industry: String(row.industry || '').trim(),
      businessFocus: String(row.businessFocus || '').trim(),
      productsOrServices: (row.productsOrServices || []).map(String).filter(Boolean).slice(0, 5),
      typicalInitiatives: (row.typicalInitiatives || []).map(String).filter(Boolean).slice(0, 5),
      systemsOrDomains: (row.systemsOrDomains || []).map(String).filter(Boolean).slice(0, 5),
      stakeholderTypes: (row.stakeholderTypes || []).map(String).filter(Boolean).slice(0, 5),
      alignmentTips: (row.alignmentTips || []).map(String).filter(Boolean).slice(0, 4),
    }))
    .filter((row) => row.company)
}

function normalizeJdRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      company: String(row.company || '').trim(),
      industry: String(row.industry || '').trim(),
      businessArea: String(row.businessArea || '').trim(),
      commonSystems: (row.commonSystems || []).map(String).filter(Boolean).slice(0, 6),
      realisticProjects: (row.realisticProjects || []).map(String).filter(Boolean).slice(0, 5),
      commonTools: (row.commonTools || []).map(String).filter(Boolean).slice(0, 8),
      workflows: (row.workflows || []).map(String).filter(Boolean).slice(0, 5),
      commonResponsibilities: (row.commonResponsibilities || []).map(String).filter(Boolean).slice(0, 6),
    }))
    .filter((row) => row.company)
}

function jdIndustryHint(jdData) {
  const parts = [
    ...(jdData?.domainKeywords || []),
    ...(jdData?.industry ? [jdData.industry] : []),
  ].map((s) => String(s || '').trim()).filter(Boolean)
  return parts.slice(0, 8).join(', ')
}

function jdTechHint(jdData) {
  return [
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.requiredSkills || []),
    ...(jdData?.preferredSkills || []),
  ].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 20)
}

/**
 * Enhancer path: research from existing resume experience rows.
 * @param {object} resumeData
 * @param {object} jdData
 * @returns {Promise<object[]>}
 */
export async function researchCompanyContexts(resumeData, jdData) {
  const experience = compactExperience(resumeData)
  if (!experience.length) return []

  const roleTitle = jdData?.roleTitle || ''
  const responsibilities = (jdData?.responsibilities || []).slice(0, 8)
  const tools = jdTechHint(jdData).slice(0, 16)

  try {
    const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
      await structuredJSON(
        `You are a company/industry research assistant for resume writers.
For each employer on the candidate's resume, return concise PUBLIC company context:
industry, business focus, products/services, typical digital/ops/IT initiatives,
systems/domains (ERP, CRM, inventory, analytics, etc.), and stakeholder types.

Rules (strict):
- Prefer well-known public facts about the company or its industry.
- If the company is obscure, infer from industry cues in the resume bullets — say so briefly in businessFocus.
- Do NOT invent projects the candidate personally led.
- Do NOT invent confidential internal project names or fake metrics.
- alignmentTips: 2–4 concrete ways a ${roleTitle || 'professional'} could frame EXISTING resume work to match this JD's responsibilities — grounded in that company's domain.
- Keep arrays short (3–5 items). Compact JSON only.`,
        JSON.stringify({
          targetRole: roleTitle,
          jdResponsibilities: responsibilities,
          jdToolsAndSkills: tools,
          experience,
        }),
        'company_context_research',
        COMPANY_CONTEXT_SCHEMA,
        {
          maxTokens: 2200,
          preferProviders: ['groq'],
        },
      )

    console.log(
      `[AI] company_context_research via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    return normalizeEnhancerRows(result?.companies)
  } catch (err) {
    console.warn(`[AI] company_context_research failed (continuing without): ${err.message}`)
    return []
  }
}

/**
 * LLM-only JD company context (fallback when live Tavily research fails).
 * @param {object[]} employers — compact employer rows
 * @param {object} jdData
 * @returns {Promise<object[]>}
 */
async function researchJdCompanyContextsLlm(employers, jdData) {
  if (!employers.length) return []

  const targetRole = String(jdData?.roleTitle || '').trim()
  const industryHint = jdIndustryHint(jdData)
  const technologies = jdTechHint(jdData)

  try {
    const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
      await structuredJSON(
        `You are a company/industry research assistant for a JD-tailored resume builder.
For each employer, return compact PUBLIC, high-level context only.

Collect:
- industry and business area
- common systems and platforms used in that industry / at similar companies
- realistic project types for the given job title and target role (generic industry examples)
- common tools, workflows, responsibilities, and business processes

Rules (strict):
- Use only public / commonly known industry knowledge.
- If the company is obscure, infer from industry + role + JD tech — say "industry-typical" in businessArea.
- Do NOT invent or confirm private/internal project names, clients, confidential systems, or exact achievements.
- Do NOT claim the candidate personally did any project — list realistic role-level project TYPES only.
- Do NOT write resume bullets.
- Keep every array short (3–6 items). Compact JSON only.`,
        JSON.stringify({
          targetRole,
          jdIndustryHints: industryHint || '(infer from role and technologies)',
          jdRequiredTechnologies: technologies,
          employers,
        }),
        'jd_company_context_research',
        JD_COMPANY_CONTEXT_SCHEMA,
        {
          maxTokens: 2400,
          preferProviders: ['groq'],
        },
      )

    console.log(
      `[AI] jd_company_context_research via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    return normalizeJdRows(result?.companies)
  } catch (err) {
    console.warn(`[AI] jd_company_context_research failed (continuing without): ${err.message}`)
    return []
  }
}

/**
 * JD Builder path: live Tavily research per employer (cached 30 days), with LLM fallback.
 * Failures never throw — returns compact rows so resume generation can continue.
 *
 * @param {object[]} companies — form companies ({ name, role, startDate, endDate, ... })
 * @param {object} jdData
 * @returns {Promise<object[]>}
 */
export async function researchJdCompanyContexts(companies, jdData) {
  const employers = compactJdCompanies(companies)
  if (!employers.length) return []

  const rows = []
  const needLlmFallback = []

  for (const employer of employers) {
    try {
      const live = await researchOneCompanyWithCache(employer, jdData)
      if (live?.researchStatus === 'live') {
        rows.push(live)
        console.log(
          `[jd-research] ${employer.company}: live`
          + (live.fromCache ? ' (cache)' : '')
          + ` verified=${Object.values(live.verified || {}).flat().length}`
          + ` sources=${(live.sources || []).length}`,
        )
        continue
      }
    } catch (err) {
      console.warn(`[jd-research] live failed for "${employer.company}": ${err.message}`)
    }
    needLlmFallback.push(employer)
  }

  if (needLlmFallback.length) {
    if (!isTavilyConfigured()) {
      console.warn('[jd-research] TAVILY_API_KEY not set — using LLM context fallback for all missing companies')
    } else {
      console.warn(
        `[jd-research] live research incomplete for: ${needLlmFallback.map((e) => e.company).join(', ')} — LLM fallback`,
      )
    }
    try {
      const llmRows = await researchJdCompanyContextsLlm(needLlmFallback, jdData)
      const byName = new Map(llmRows.map((r) => [String(r.company || '').toLowerCase(), r]))
      for (const employer of needLlmFallback) {
        const match = byName.get(employer.company.toLowerCase())
          || llmRows.find((r) => String(r.company || '').toLowerCase().includes(employer.company.toLowerCase().slice(0, 8)))
          || null
        rows.push(llmFallbackToResearchRow(match || { company: employer.company }, employer.company))
      }
    } catch (err) {
      console.warn(`[jd-research] LLM fallback failed (continuing): ${err.message}`)
      for (const employer of needLlmFallback) {
        rows.push(llmFallbackToResearchRow({ company: employer.company }, employer.company))
      }
    }
  }

  // Keep employer order
  const order = new Map(employers.map((e, i) => [e.company.toLowerCase(), i]))
  rows.sort((a, b) => {
    const ai = order.has(String(a.company || '').toLowerCase())
      ? order.get(String(a.company || '').toLowerCase())
      : 999
    const bi = order.has(String(b.company || '').toLowerCase())
      ? order.get(String(b.company || '').toLowerCase())
      : 999
    return ai - bi
  })

  return rows
}
