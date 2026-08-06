import { structuredJSON } from './aiProvider.js'
import { isTavilyConfigured, tavilySearch } from './tavilySearch.js'
import {
  getCachedCompanyResearch,
  setCachedCompanyResearch,
} from '../store/companyResearchCache.js'

const MAX_QUERIES_PER_COMPANY = 3
const MAX_SNIPPETS = 12
const MAX_FACTS_PER_FIELD = 4

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    verified: {
      type: 'object',
      properties: {
        industry: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['value', 'sourceUrl'],
            additionalProperties: false,
          },
        },
        businessAreas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['value', 'sourceUrl'],
            additionalProperties: false,
          },
        },
        platformsAndTechnologies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['value', 'sourceUrl'],
            additionalProperties: false,
          },
        },
        roleRelatedPublicProjects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['value', 'sourceUrl'],
            additionalProperties: false,
          },
        },
        workflowsAndProcesses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['value', 'sourceUrl'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'industry',
        'businessAreas',
        'platformsAndTechnologies',
        'roleRelatedPublicProjects',
        'workflowsAndProcesses',
      ],
      additionalProperties: false,
    },
    industryTypical: {
      type: 'object',
      properties: {
        businessAreas: { type: 'array', items: { type: 'string' } },
        platformsAndTechnologies: { type: 'array', items: { type: 'string' } },
        roleRelatedProjects: { type: 'array', items: { type: 'string' } },
        workflowsAndProcesses: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'businessAreas',
        'platformsAndTechnologies',
        'roleRelatedProjects',
        'workflowsAndProcesses',
      ],
      additionalProperties: false,
    },
  },
  required: ['verified', 'industryTypical'],
  additionalProperties: false,
}

/**
 * Max 3 search queries per company — prefer official site, careers/jobs, engineering/tech.
 */
export function buildCompanySearchQueries({ company, title, targetRole }) {
  const name = String(company || '').trim()
  const role = String(title || targetRole || 'professional').trim() || 'professional'
  return [
    `${name} official company website about overview`,
    `${name} careers OR jobs "${role}"`,
    `${name} engineering OR technology OR "tech blog" OR platform`,
  ].slice(0, MAX_QUERIES_PER_COMPANY)
}

function scoreResultUrl(url, company) {
  const u = String(url || '').toLowerCase()
  const c = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  let score = 0
  if (c && u.includes(c.slice(0, Math.min(12, c.length)))) score += 5
  if (/careers|jobs|greenhouse|lever\.co|workday|job-openings/i.test(u)) score += 4
  if (/engineering|tech|developers|platform|product/i.test(u)) score += 3
  if (/about|company|who-we-are|our-story/i.test(u)) score += 2
  if (/linkedin\.com|glassdoor|indeed|wikipedia/i.test(u)) score += 1
  if (/facebook|twitter|instagram|tiktok|youtube\.com\/watch/i.test(u)) score -= 3
  return score
}

function preferOfficialSources(results, company) {
  return [...results].sort((a, b) => scoreResultUrl(b.url, company) - scoreResultUrl(a.url, company))
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(String(url || ''))
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeUrlKey(url) {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href.replace(/\/$/, '').toLowerCase()
  } catch {
    return String(url || '').trim().toLowerCase()
  }
}

function filterVerifiedFacts(facts, allowedUrlSet) {
  const out = []
  for (const item of Array.isArray(facts) ? facts : []) {
    const value = String(item?.value || '').trim()
    const sourceUrl = String(item?.sourceUrl || '').trim()
    if (!value || !isValidHttpUrl(sourceUrl)) continue
    const key = normalizeUrlKey(sourceUrl)
    // Allow exact or same-origin match against retrieved sources
    const allowed = [...allowedUrlSet].some((allowedUrl) => {
      if (normalizeUrlKey(allowedUrl) === key) return true
      try {
        return new URL(allowedUrl).hostname === new URL(sourceUrl).hostname
      } catch {
        return false
      }
    })
    if (!allowed) continue
    out.push({ value: value.slice(0, 160), sourceUrl })
    if (out.length >= MAX_FACTS_PER_FIELD) break
  }
  return out
}

function compactStringList(list, max = MAX_FACTS_PER_FIELD) {
  return [...new Set((Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean))]
    .slice(0, max)
}

function emptyVerified() {
  return {
    industry: [],
    businessAreas: [],
    platformsAndTechnologies: [],
    roleRelatedPublicProjects: [],
    workflowsAndProcesses: [],
  }
}

function countVerified(verified) {
  return Object.values(verified || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
}

/**
 * Run up to 3 Tavily searches and extract grounded facts for one employer.
 * @returns {Promise<object|null>} compact research row or null if live research failed
 */
export async function researchOneCompanyLive(employer, jdData) {
  if (!isTavilyConfigured()) return null

  const company = String(employer?.company || '').trim()
  if (!company) return null

  const title = String(employer?.title || '').trim()
  const targetRole = String(jdData?.roleTitle || '').trim()
  const queries = buildCompanySearchQueries({ company, title, targetRole })

  const allResults = []
  const errors = []
  for (const query of queries) {
    try {
      const { results } = await tavilySearch(query, { maxResults: 5, searchDepth: 'basic' })
      allResults.push(...results)
    } catch (err) {
      errors.push(err.message)
      console.warn(`[tavily] query failed for "${company}": ${err.message}`)
    }
  }

  if (!allResults.length) {
    console.warn(
      `[tavily] no results for "${company}"`
      + (errors.length ? ` (${errors[0]})` : ''),
    )
    return null
  }

  const ranked = preferOfficialSources(allResults, company)
  const seen = new Set()
  const snippets = []
  for (const r of ranked) {
    const key = normalizeUrlKey(r.url)
    if (seen.has(key)) continue
    seen.add(key)
    snippets.push({
      title: r.title.slice(0, 120),
      url: r.url,
      content: r.content.slice(0, 700),
    })
    if (snippets.length >= MAX_SNIPPETS) break
  }

  const allowedUrls = new Set(snippets.map((s) => s.url))
  const techHints = [
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.requiredSkills || []),
  ].slice(0, 12)

  let extracted
  try {
    const { result, provider, model, durationMs, costUsd } = await structuredJSON(
      `You extract compact company research for a resume builder from LIVE search snippets only.

Rules (strict):
- verified.* facts MUST be supported by the snippet text AND use a sourceUrl copied exactly from the provided snippet URLs.
- Prefer official company website, careers/jobs pages, engineering/tech pages, and public job postings.
- If a detail is not clearly supported by a snippet, put a short generic note under industryTypical instead — never under verified.
- Do NOT invent private/internal projects, confidential systems, clients, or achievements.
- Do NOT write resume bullets.
- Keep values short (under 120 characters).`,
      JSON.stringify({
        company,
        jobTitle: title || targetRole,
        targetRole,
        jdTechnologies: techHints,
        snippets,
      }),
      'jd_company_web_extract',
      EXTRACT_SCHEMA,
      { maxTokens: 1800, preferProviders: ['groq', 'openai'] },
    )
    console.log(
      `[AI] jd_company_web_extract "${company}" via ${provider}/${model} ${durationMs}ms $${costUsd}`,
    )
    extracted = result
  } catch (err) {
    console.warn(`[tavily] extract failed for "${company}": ${err.message}`)
    return null
  }

  const verified = {
    industry: filterVerifiedFacts(extracted?.verified?.industry, allowedUrls),
    businessAreas: filterVerifiedFacts(extracted?.verified?.businessAreas, allowedUrls),
    platformsAndTechnologies: filterVerifiedFacts(extracted?.verified?.platformsAndTechnologies, allowedUrls),
    roleRelatedPublicProjects: filterVerifiedFacts(extracted?.verified?.roleRelatedPublicProjects, allowedUrls),
    workflowsAndProcesses: filterVerifiedFacts(extracted?.verified?.workflowsAndProcesses, allowedUrls),
  }

  const industryTypical = {
    businessAreas: compactStringList(extracted?.industryTypical?.businessAreas),
    platformsAndTechnologies: compactStringList(extracted?.industryTypical?.platformsAndTechnologies),
    roleRelatedProjects: compactStringList(extracted?.industryTypical?.roleRelatedProjects),
    workflowsAndProcesses: compactStringList(extracted?.industryTypical?.workflowsAndProcesses),
  }

  // Anything that failed URL validation is not trusted as verified — leave only industryTypical fillers.
  if (countVerified(verified) === 0 && !Object.values(industryTypical).some((a) => a.length)) {
    return null
  }

  const sources = [...new Set([
    ...Object.values(verified).flat().map((f) => f.sourceUrl),
  ])].filter(Boolean).slice(0, 10)

  return {
    company,
    researchStatus: 'live',
    verified,
    industryTypical,
    sources,
    queries,
  }
}

/**
 * Convert legacy LLM-only row into the compact verified/industryTypical shape.
 */
export function llmFallbackToResearchRow(llmRow, companyName) {
  const company = String(llmRow?.company || companyName || '').trim()
  return {
    company,
    researchStatus: 'fallback_llm',
    verified: emptyVerified(),
    industryTypical: {
      businessAreas: compactStringList([
        llmRow?.businessArea,
        llmRow?.industry,
      ].filter(Boolean), 3),
      platformsAndTechnologies: compactStringList([
        ...(llmRow?.commonSystems || []),
        ...(llmRow?.commonTools || []),
      ], 6),
      roleRelatedProjects: compactStringList(llmRow?.realisticProjects, 4),
      workflowsAndProcesses: compactStringList([
        ...(llmRow?.workflows || []),
        ...(llmRow?.commonResponsibilities || []),
      ], 5),
    },
    sources: [],
    queries: [],
  }
}

/**
 * Research one employer: cache → Tavily live → null (caller may LLM-fallback).
 */
export async function researchOneCompanyWithCache(employer, jdData) {
  const company = String(employer?.company || '').trim()
  const roleKey = String(employer?.title || jdData?.roleTitle || '').trim()
  if (!company) return null

  const cached = getCachedCompanyResearch(company, roleKey)
  if (cached?.company) {
    return { ...cached, fromCache: true }
  }

  const live = await researchOneCompanyLive(employer, jdData)
  if (live) {
    const toStore = { ...live }
    delete toStore.fromCache
    setCachedCompanyResearch(company, roleKey, toStore)
    return { ...live, fromCache: false }
  }
  return null
}

export { isTavilyConfigured }
