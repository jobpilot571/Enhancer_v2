import { structuredJSON } from './aiProvider.js'

/**
 * Build company / industry context to ground enhancement bullets.
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

function compactExperience(resumeData) {
  return (resumeData?.experience || []).slice(0, 6).map((e) => ({
    company: e.company || '',
    title: e.title || '',
    dates: e.dates || '',
    sampleBullets: (e.bullets || []).slice(0, 4),
  })).filter((e) => e.company)
}

/**
 * @param {object} resumeData
 * @param {object} jdData
 * @returns {Promise<object[]>} per-company context rows
 */
export async function researchCompanyContexts(resumeData, jdData) {
  const experience = compactExperience(resumeData)
  if (!experience.length) return []

  const roleTitle = jdData?.roleTitle || ''
  const responsibilities = (jdData?.responsibilities || []).slice(0, 8)
  const tools = [
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.requiredSkills || []),
  ].slice(0, 16)

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
          // Prefer Groq when configured — fast company/industry grounding
          preferProviders: ['groq'],
        },
      )

    console.log(
      `[AI] company_context_research via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    const rows = Array.isArray(result?.companies) ? result.companies : []
    return rows
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
  } catch (err) {
    console.warn(`[AI] company_context_research failed (continuing without): ${err.message}`)
    return []
  }
}
