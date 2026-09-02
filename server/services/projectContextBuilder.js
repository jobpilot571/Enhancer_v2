import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { structuredJSON } from './aiProvider.js'

/**
 * Phase 1 — Resume Enhancer Project Context Builder.
 *
 * Internally reconstructs a realistic enterprise production project for each
 * employer using the JD + existing resume + company + role.
 *
 * INSPECT-ONLY. Must never be passed into enhancement-plan prompts, DOCX
 * patching, scoring, or QA. Fail-soft: returns [] so the existing enhancer
 * continues unchanged.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.resolve(__dirname, '../.cache')
const LAST_FILE = path.join(CACHE_DIR, 'last-project-contexts.json')

export const PROJECT_CONTEXT_PHASE = 1
export const PROJECT_CONTEXT_USED_FOR_ENHANCEMENT = false

const CONTEXT_FIELDS = {
  company: { type: 'string' },
  role: { type: 'string' },
  industry: { type: 'string' },
  businessProblem: { type: 'string' },
  projectName: { type: 'string' },
  product: { type: 'string' },
  systemPurpose: { type: 'string' },
  architecture: { type: 'string' },
  workflows: { type: 'array', items: { type: 'string' } },
  technologies: { type: 'array', items: { type: 'string' } },
  integrations: { type: 'array', items: { type: 'string' } },
  candidateResponsibilities: { type: 'array', items: { type: 'string' } },
  productionEnvironment: { type: 'string' },
  operationalChallenges: { type: 'array', items: { type: 'string' } },
  jdRequirementsThatFit: { type: 'array', items: { type: 'string' } },
}

const PROJECT_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: CONTEXT_FIELDS,
        required: Object.keys(CONTEXT_FIELDS),
        additionalProperties: false,
      },
    },
  },
  required: ['projects'],
  additionalProperties: false,
}

function strList(value, max = 8) {
  return [...new Set((Array.isArray(value) ? value : []).map((s) => String(s || '').trim()).filter(Boolean))]
    .slice(0, max)
}

function compactExperience(resumeData) {
  return (resumeData?.experience || []).slice(0, 6).map((e) => ({
    company: String(e.company || '').trim(),
    role: String(e.title || e.role || '').trim(),
    dates: String(e.dates || '').trim(),
    bullets: (e.bullets || []).slice(0, 12).map((b) => String(b || '').trim()).filter(Boolean),
  })).filter((e) => e.company)
}

function compactJd(jdData) {
  return {
    targetRole: String(jdData?.roleTitle || '').trim(),
    industry: String(jdData?.industry || '').trim(),
    responsibilities: (jdData?.responsibilities || []).slice(0, 12).map(String).filter(Boolean),
    requiredSkills: (jdData?.requiredSkills || []).slice(0, 16).map(String).filter(Boolean),
    preferredSkills: (jdData?.preferredSkills || []).slice(0, 8).map(String).filter(Boolean),
    tools: (jdData?.toolsTechnologies || []).slice(0, 16).map(String).filter(Boolean),
    domainKeywords: (jdData?.domainKeywords || []).slice(0, 12).map(String).filter(Boolean),
  }
}

function compactPublicContext(companyContexts) {
  return (Array.isArray(companyContexts) ? companyContexts : []).slice(0, 6).map((row) => ({
    company: String(row.company || '').trim(),
    industry: String(row.industry || '').trim(),
    businessFocus: String(row.businessFocus || '').trim(),
    productsOrServices: (row.productsOrServices || []).map(String).filter(Boolean).slice(0, 4),
    systemsOrDomains: (row.systemsOrDomains || []).map(String).filter(Boolean).slice(0, 4),
  })).filter((row) => row.company)
}

function compactSkills(resumeData) {
  return [...new Set([
    ...(resumeData?.skills || []),
    ...(resumeData?.technicalSkills || []),
  ])].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 24)
}

export function normalizeProjectContext(row, fallback = {}) {
  return {
    company: String(row?.company || fallback.company || '').trim(),
    role: String(row?.role || fallback.role || '').trim(),
    industry: String(row?.industry || '').trim().slice(0, 160),
    businessProblem: String(row?.businessProblem || '').trim().slice(0, 400),
    projectName: String(row?.projectName || '').trim().slice(0, 160),
    product: String(row?.product || '').trim().slice(0, 220),
    systemPurpose: String(row?.systemPurpose || '').trim().slice(0, 400),
    architecture: String(row?.architecture || '').trim().slice(0, 400),
    workflows: strList(row?.workflows, 6),
    technologies: strList(row?.technologies, 10),
    integrations: strList(row?.integrations, 6),
    candidateResponsibilities: strList(row?.candidateResponsibilities, 8),
    productionEnvironment: String(row?.productionEnvironment || '').trim().slice(0, 280),
    operationalChallenges: strList(row?.operationalChallenges, 6),
    jdRequirementsThatFit: strList(row?.jdRequirementsThatFit, 8),
    usedForEnhancement: PROJECT_CONTEXT_USED_FOR_ENHANCEMENT,
  }
}

function matchRow(rows, employer) {
  const name = employer.company.toLowerCase()
  return (Array.isArray(rows) ? rows : []).find((r) => String(r.company || '').toLowerCase() === name)
    || (Array.isArray(rows) ? rows : []).find((r) => {
      const c = String(r.company || '').toLowerCase()
      return c && (name.includes(c) || c.includes(name.slice(0, 8)))
    })
    || null
}

function systemPrompt() {
  return `You are an internal project-context analyst for a resume enhancer.
For EACH employer on the candidate's existing resume, reconstruct ONE realistic enterprise production project they could have been working on.

This output is INTERNAL / DEBUG ONLY. Never write resume bullets. Never invent content for the resume.

Identify for each company:
- industry and business problem
- main project/product
- what the system actually does
- enterprise architecture/environment
- main workflows
- technologies and tools
- integrations
- candidate's realistic responsibilities
- production/deployment environment
- performance, security, monitoring, or operational challenges
- which JD requirements can realistically fit into this project

Rules (strict):
- Ground the project PRIMARILY in the candidate's existing bullets, role, and company.
- Use the JD only to see which requirements could naturally fit this same project — do not force-fit unrelated JD items.
- Reuse named systems, products, tools, and workflows already present in the bullets.
- Do NOT invent unrelated technologies, responsibilities, achievements, customers, or metrics.
- Do NOT invent fake numbers (%, time saved, user counts) that the resume does not support.
- Do NOT claim public company initiatives as the candidate's personal project.
- companyPublicContext (if present) is public industry background only — not proof of the candidate's work.
- If bullets are sparse, infer a plausible enterprise project from role + industry, using ONLY technologies that appear in the resume or JD.
- One coherent production project per company. Keep lists short and concrete. Compact JSON only.`
}

export function formatProjectContextLines(ctx) {
  const list = (arr) => (arr || []).length ? arr.join('; ') : '(none)'
  return [
    `  industry: ${ctx.industry || '(unknown)'}`,
    `  businessProblem: ${ctx.businessProblem || '(none)'}`,
    `  projectName: ${ctx.projectName || '(none)'}`,
    `  product: ${ctx.product || '(none)'}`,
    `  systemPurpose: ${ctx.systemPurpose || '(none)'}`,
    `  architecture: ${ctx.architecture || '(none)'}`,
    `  workflows: ${list(ctx.workflows)}`,
    `  technologies: ${list(ctx.technologies)}`,
    `  integrations: ${list(ctx.integrations)}`,
    `  candidateResponsibilities: ${list(ctx.candidateResponsibilities)}`,
    `  productionEnvironment: ${ctx.productionEnvironment || '(none)'}`,
    `  operationalChallenges: ${list(ctx.operationalChallenges)}`,
    `  jdRequirementsThatFit: ${list(ctx.jdRequirementsThatFit)}`,
    `  usedForEnhancement: ${ctx.usedForEnhancement === true}`,
  ]
}

export function logProjectContexts(logFn, contexts) {
  if (!contexts?.length) {
    logFn('project context: none (inspect-only; enhancer unchanged)')
    return
  }
  logFn(
    `project context: ${contexts.length} companies (inspect-only, NOT used for bullets/plan)`,
  )
  for (const ctx of contexts) {
    logFn(`--- project context: ${ctx.company} / ${ctx.role || '(role unknown)'} ---`)
    for (const line of formatProjectContextLines(ctx)) logFn(line)
  }
}

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

export function saveProjectContextSnapshot({ sessionId, jobId, fileName, contexts, jdRole }) {
  try {
    ensureCacheDir()
    const payload = {
      savedAt: new Date().toISOString(),
      phase: PROJECT_CONTEXT_PHASE,
      usedForEnhancement: PROJECT_CONTEXT_USED_FOR_ENHANCEMENT,
      sessionId: sessionId || null,
      jobId: jobId || null,
      fileName: fileName || null,
      jdRole: jdRole || null,
      companyCount: (contexts || []).length,
      projects: contexts || [],
    }
    fs.writeFileSync(LAST_FILE, JSON.stringify(payload, null, 2))
    if (sessionId) {
      fs.writeFileSync(
        path.join(CACHE_DIR, `project-context-${sessionId}.json`),
        JSON.stringify(payload, null, 2),
      )
    }
    console.log(`[project-context] snapshot → ${LAST_FILE}`)
  } catch (err) {
    console.warn('[project-context] snapshot write failed:', err.message)
  }
}

export function getLastProjectContextSnapshot() {
  try {
    if (!fs.existsSync(LAST_FILE)) return null
    return JSON.parse(fs.readFileSync(LAST_FILE, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Build one internal project context per resume company.
 * Never throws — returns [] on failure so the existing enhancer is undisturbed.
 *
 * @param {object} resumeData
 * @param {object} jdData
 * @param {object} [options]
 * @param {object[]} [options.companyContexts] public industry rows (background only)
 * @param {string} [options.sessionId]
 * @param {string} [options.jobId]
 * @param {string} [options.fileName]
 * @returns {Promise<object[]>}
 */
export async function buildProjectContexts(resumeData, jdData, options = {}) {
  const employers = compactExperience(resumeData)
  if (!employers.length) return []

  const jd = compactJd(jdData)
  const publicContext = compactPublicContext(options.companyContexts)

  try {
    const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
      await structuredJSON(
        systemPrompt(),
        JSON.stringify({
          targetRole: jd.targetRole,
          jd,
          resumeSkills: compactSkills(resumeData),
          employers,
          companyPublicContext: publicContext,
        }),
        'project_context_builder',
        PROJECT_CONTEXT_SCHEMA,
        {
          maxTokens: 3200,
          preferProviders: ['groq'],
        },
      )

    console.log(
      `[AI] project_context_builder via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    const rows = Array.isArray(result?.projects) ? result.projects : []
    const contexts = employers.map((employer) => {
      const match = matchRow(rows, employer)
      return normalizeProjectContext(match || { company: employer.company, role: employer.role }, employer)
    }).filter((ctx) => ctx.company && ctx.projectName)

    saveProjectContextSnapshot({
      sessionId: options.sessionId,
      jobId: options.jobId,
      fileName: options.fileName,
      jdRole: jd.targetRole,
      contexts,
    })

    return contexts
  } catch (err) {
    console.warn(`[AI] project_context_builder failed (continuing without): ${err.message}`)
    saveProjectContextSnapshot({
      sessionId: options.sessionId,
      jobId: options.jobId,
      fileName: options.fileName,
      jdRole: jd.targetRole,
      contexts: [],
    })
    return []
  }
}
