/**
 * Centralized AI cost tracking.
 *
 * Every call through aiProvider.structuredJSON / visionStructuredJSON is recorded
 * automatically. Request-scoped metadata is provided via AsyncLocalStorage so
 * concurrent users/jobs never mix.
 */

import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import { appendAiCostEvent, appendAiServiceCost, listAiCostEvents } from '../store/aiCostStore.js'

const als = new AsyncLocalStorage()

/** Friendly feature names for schema / task ids */
const FEATURE_NAMES = {
  resume_parse: 'Resume Parse',
  jd_analysis: 'JD Analysis',
  company_context_research: 'Company Research',
  enhancement_plan: 'Enhancement',
  llm_ats_score: 'ATS Score',
  build_resume: 'Resume Generation',
  build_jd_resume: 'Resume Generation',
  suggest_jd_companies: 'Company Suggestions',
  extra_experience_bullets: 'Extra Experience Bullets',
  layout_screenshot_analysis: 'Layout Screenshot Analysis',
}

/** Canonical provider labels for reporting */
const PROVIDER_NAMES = {
  openai: 'OpenAI',
  groq: 'Groq',
  claude: 'Claude',
  gemini: 'Gemini',
  ollama: 'Ollama',
}

export const AI_SERVICES = {
  ENHANCER: 'Resume Enhancer',
  BUILDER: 'Resume Builder',
  JD_BUILDER: 'JD-Tailored Resume Builder',
  LAYOUT_FIX: 'Layout Fix Chat',
}

/** Current pricing catalog version (bump when rates change). */
export const PRICING_VERSION = '2026-08-01'

/**
 * Pricing table: provider + model + input/output USD per 1M tokens.
 * Unknown models must NOT silently price — see resolvePricing().
 */
export const MODEL_PRICING = [
  {
    provider: 'OpenAI',
    model: 'gpt-4.1-mini',
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'OpenAI',
    model: 'gpt-4o-mini',
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'OpenAI',
    model: 'gpt-4o',
    inputPer1M: 2.5,
    outputPer1M: 10,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Groq',
    model: 'llama-3.3-70b-versatile',
    inputPer1M: 0.59,
    outputPer1M: 0.79,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Claude',
    model: 'claude-3-5-sonnet-latest',
    inputPer1M: 3,
    outputPer1M: 15,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Claude',
    model: 'claude-sonnet',
    inputPer1M: 3,
    outputPer1M: 15,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Gemini',
    model: 'gemini-1.5-flash',
    inputPer1M: 0.075,
    outputPer1M: 0.3,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Gemini',
    model: 'gemini-2.0-flash',
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
  {
    provider: 'Ollama',
    model: 'gpt-oss',
    inputPer1M: 0,
    outputPer1M: 0,
    version: PRICING_VERSION,
    effectiveDate: '2026-08-01',
  },
]

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

/**
 * Resolve pricing for a model. Returns pricingMissing=true when unknown
 * (cost stays 0 — never invent rates).
 */
export function resolvePricing(model, providerHint = null) {
  const name = String(model || '')
  const hint = String(providerHint || '').toLowerCase()
  const match = MODEL_PRICING.find((row) => {
    if (!name.includes(row.model)) return false
    if (!hint) return true
    const p = row.provider.toLowerCase()
    return hint.includes(p) || p.includes(hint) || hint.includes(row.provider.split(' ')[0].toLowerCase())
  }) || MODEL_PRICING.find((row) => name.includes(row.model))

  if (!match) {
    return {
      found: false,
      pricingMissing: true,
      provider: providerHint || null,
      model: name || 'unknown',
      inputPer1M: 0,
      outputPer1M: 0,
      version: null,
      effectiveDate: null,
    }
  }
  return {
    found: true,
    pricingMissing: false,
    provider: match.provider,
    model: match.model,
    inputPer1M: match.inputPer1M,
    outputPer1M: match.outputPer1M,
    version: match.version,
    effectiveDate: match.effectiveDate,
  }
}

/**
 * Calculate input / output / total cost from token usage.
 * Cached input tokens are billed at 50% of the input rate.
 * Unknown models → costs 0 + pricingMissing flag.
 */
export function calculateCallCosts(model, usage = {}, providerHint = null) {
  const rates = resolvePricing(model, providerHint)
  if (rates.pricingMissing) {
    return {
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      pricingMissing: true,
      pricingVersion: null,
      pricingEffectiveDate: null,
      pricingModelKey: null,
    }
  }
  const cached = Number(usage.cachedInputTokens) || 0
  const prompt = Number(usage.promptTokens) || 0
  const completion = Number(usage.completionTokens) || 0
  const billedInput = Math.max(0, prompt - cached) + cached * 0.5
  const inputCostUsd = round6((billedInput / 1e6) * rates.inputPer1M)
  const outputCostUsd = round6((completion / 1e6) * rates.outputPer1M)
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: round6(inputCostUsd + outputCostUsd),
    pricingMissing: false,
    pricingVersion: rates.version,
    pricingEffectiveDate: rates.effectiveDate,
    pricingModelKey: rates.model,
  }
}

export function estimateCallCostUsd(model, usage, providerHint = null) {
  return calculateCallCosts(model, usage, providerHint).totalCostUsd
}

export function providerDisplayName(providerKey) {
  const key = String(providerKey || '').toLowerCase()
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key]
  if (key.includes('openai')) return 'OpenAI'
  if (key.includes('claude') || key.includes('anthropic')) return 'Claude'
  if (key.includes('groq')) return 'Groq'
  if (key.includes('gemini') || key.includes('google')) return 'Gemini'
  if (key.includes('ollama')) return 'Ollama'
  return providerKey || 'Unknown'
}

export function featureDisplayName(taskOrFeature, override = null) {
  if (override) return override
  const key = String(taskOrFeature || '')
  return FEATURE_NAMES[key] || key || 'Unknown'
}

function emptyStore(ctx = {}) {
  return {
    userId: ctx.userId || null,
    sessionId: ctx.sessionId || null,
    jobId: ctx.jobId || null,
    operationId: ctx.operationId || randomUUID(),
    serviceName: ctx.serviceName || 'Unknown',
    featureName: ctx.featureName || null,
    events: [],
  }
}

/** Run async work with request-scoped AI cost metadata (isolated per async chain). */
export function runWithAiCostContext(ctx, fn) {
  const store = emptyStore(ctx)
  return als.run(store, () => fn(store))
}

export function getAiCostContext() {
  return als.getStore() || null
}

export function getOperationId() {
  return als.getStore()?.operationId || null
}

/**
 * Stable operation ID for a resume/work session so all AI attempts for one
 * user action chain share the same operationId.
 */
export function ensureSessionOperationId(sessionId, getSession, updateSession) {
  if (!sessionId || !getSession || !updateSession) return randomUUID()
  const session = getSession(sessionId)
  if (!session) return randomUUID()
  if (session.aiOperationId) return session.aiOperationId
  const operationId = randomUUID()
  updateSession(sessionId, { aiOperationId: operationId })
  return operationId
}

/** Merge fields into the active context (no-op outside a context). */
export function updateAiCostContext(patch = {}) {
  const store = als.getStore()
  if (!store) return null
  if (patch.userId !== undefined) store.userId = patch.userId
  if (patch.sessionId !== undefined) store.sessionId = patch.sessionId
  if (patch.jobId !== undefined) store.jobId = patch.jobId
  if (patch.operationId !== undefined) store.operationId = patch.operationId
  if (patch.serviceName !== undefined) store.serviceName = patch.serviceName
  if (patch.featureName !== undefined) store.featureName = patch.featureName
  return store
}

/**
 * Record a single AI provider attempt (success or failure).
 * Always persists to the durable ledger; also appends to the active ALS event list.
 */
export function recordAiRequest({
  providerKey,
  provider,
  model,
  task,
  featureName,
  promptTokens = 0,
  completionTokens = 0,
  cachedInputTokens = 0,
  totalTokens = 0,
  inputCostUsd,
  outputCostUsd,
  totalCostUsd,
  processingTimeMs = 0,
  status = 'Success',
  errorMessage = null,
  usageSource = 'unknown',
  pricingMissing,
  pricingVersion,
  pricingEffectiveDate,
} = {}) {
  const ctx = als.getStore()
  const providerLabel = provider || providerDisplayName(providerKey)
  const costs = (inputCostUsd != null || outputCostUsd != null || totalCostUsd != null)
    ? {
      inputCostUsd: round6(inputCostUsd || 0),
      outputCostUsd: round6(outputCostUsd || 0),
      totalCostUsd: round6(totalCostUsd != null ? totalCostUsd : (Number(inputCostUsd) || 0) + (Number(outputCostUsd) || 0)),
      pricingMissing: Boolean(pricingMissing),
      pricingVersion: pricingVersion || null,
      pricingEffectiveDate: pricingEffectiveDate || null,
    }
    : calculateCallCosts(
      model,
      { promptTokens, completionTokens, cachedInputTokens },
      providerLabel,
    )

  if (costs.pricingMissing) {
    console.warn(
      `[ai-cost] missing pricing for model="${model}" provider="${providerLabel}" — cost recorded as 0`,
    )
  }

  const event = {
    requestId: randomUUID(),
    userId: ctx?.userId || null,
    sessionId: ctx?.sessionId || null,
    jobId: ctx?.jobId || null,
    operationId: ctx?.operationId || null,
    serviceName: ctx?.serviceName || 'Unknown',
    featureName: featureDisplayName(task, featureName || ctx?.featureName || null),
    provider: providerLabel,
    providerKey: providerKey || null,
    model: model || 'unknown',
    task: task || null,
    promptTokens: Number(promptTokens) || 0,
    completionTokens: Number(completionTokens) || 0,
    cachedInputTokens: Number(cachedInputTokens) || 0,
    totalTokens: Number(totalTokens) || ((Number(promptTokens) || 0) + (Number(completionTokens) || 0)),
    usageSource: usageSource === 'estimated' ? 'estimated' : usageSource === 'actual' ? 'actual' : 'unknown',
    inputCostUsd: costs.inputCostUsd,
    outputCostUsd: costs.outputCostUsd,
    totalCostUsd: costs.totalCostUsd,
    pricingMissing: Boolean(costs.pricingMissing),
    pricingVersion: costs.pricingVersion || null,
    pricingEffectiveDate: costs.pricingEffectiveDate || null,
    processingTimeMs: Number(processingTimeMs) || 0,
    status: status === 'Failed' ? 'Failed' : 'Success',
    errorMessage: errorMessage ? String(errorMessage).slice(0, 2000) : null,
    createdAt: new Date().toISOString(),
  }

  if (ctx) ctx.events.push(event)
  appendAiCostEvent(event)

  return event
}

/**
 * Summarize ALL AI attempts for this operation ID (not just the latest call).
 * Merges in-context events with any earlier events already persisted for the
 * same operationId (e.g. enhancer precompute + enhance job).
 */
export function finalizeAiServiceCost({ status = 'completed', persist = true } = {}) {
  const ctx = als.getStore()
  const operationId = ctx?.operationId || null
  const byRequestId = new Map()

  if (operationId) {
    for (const e of listAiCostEvents({ operationId, limit: 20_000 })) {
      byRequestId.set(e.requestId, e)
    }
  }
  for (const e of (ctx?.events || [])) {
    byRequestId.set(e.requestId, e)
  }
  const events = [...byRequestId.values()].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  )
  const features = {}
  let totalPrompt = 0
  let totalCompletion = 0
  let totalCached = 0
  let totalInputCost = 0
  let totalOutputCost = 0
  let totalCost = 0
  let successCount = 0
  let failedCount = 0
  let pricingMissingCount = 0

  const byProvider = {}
  const calls = []

  for (const e of events) {
    totalPrompt += e.promptTokens || 0
    totalCompletion += e.completionTokens || 0
    totalCached += e.cachedInputTokens || 0
    totalInputCost += e.inputCostUsd || 0
    totalOutputCost += e.outputCostUsd || 0
    totalCost += e.totalCostUsd || 0
    if (e.status === 'Failed') failedCount += 1
    else successCount += 1
    if (e.pricingMissing) pricingMissingCount += 1

    const feat = e.featureName || 'Unknown'
    if (!features[feat]) {
      features[feat] = {
        featureName: feat,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: 0,
      }
    }
    features[feat].requestCount += 1
    features[feat].promptTokens += e.promptTokens || 0
    features[feat].completionTokens += e.completionTokens || 0
    features[feat].inputCostUsd = round6(features[feat].inputCostUsd + (e.inputCostUsd || 0))
    features[feat].outputCostUsd = round6(features[feat].outputCostUsd + (e.outputCostUsd || 0))
    features[feat].totalCostUsd = round6(features[feat].totalCostUsd + (e.totalCostUsd || 0))

    const pKey = `${e.provider}::${e.model}`
    if (!byProvider[pKey]) {
      byProvider[pKey] = {
        provider: e.provider,
        model: e.model,
        calls: 0,
        tasks: [],
        promptTokens: 0,
        completionTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
      }
    }
    byProvider[pKey].calls += 1
    byProvider[pKey].tasks.push(e.task || e.featureName)
    byProvider[pKey].promptTokens += e.promptTokens || 0
    byProvider[pKey].completionTokens += e.completionTokens || 0
    byProvider[pKey].cachedInputTokens += e.cachedInputTokens || 0
    byProvider[pKey].costUsd = round6(byProvider[pKey].costUsd + (e.totalCostUsd || 0))

    calls.push({
      requestId: e.requestId,
      operationId: e.operationId,
      task: e.task,
      featureName: e.featureName,
      provider: e.provider,
      model: e.model,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      cachedInputTokens: e.cachedInputTokens,
      totalTokens: e.totalTokens,
      usageSource: e.usageSource,
      inputCostUsd: e.inputCostUsd,
      outputCostUsd: e.outputCostUsd,
      costUsd: e.totalCostUsd,
      pricingMissing: e.pricingMissing,
      durationMs: e.processingTimeMs,
      status: e.status,
      errorMessage: e.errorMessage,
    })
  }

  const summary = {
    id: randomUUID(),
    operationId: ctx?.operationId || null,
    userId: ctx?.userId || null,
    sessionId: ctx?.sessionId || null,
    jobId: ctx?.jobId || null,
    serviceName: ctx?.serviceName || 'Unknown',
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalTokens: totalPrompt + totalCompletion,
    cachedInputTokens: totalCached,
    inputCostUsd: round6(totalInputCost),
    outputCostUsd: round6(totalOutputCost),
    totalCostUsd: round6(totalCost),
    requestCount: events.length,
    successCount,
    failedCount,
    pricingMissingCount,
    features,
    status,
    createdAt: new Date().toISOString(),
    calls,
    summary: Object.values(byProvider),
    primaryProvider: events.find((e) => e.status === 'Success')?.provider || events[0]?.provider || null,
    primaryModel: events.find((e) => e.status === 'Success')?.model || events[0]?.model || null,
    totals: {
      llmCalls: events.length,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      cachedInputTokens: totalCached,
      inputCostUsd: round6(totalInputCost),
      outputCostUsd: round6(totalOutputCost),
      costUsd: round6(totalCost),
    },
  }

  if (persist && events.length > 0) {
    appendAiServiceCost({
      id: summary.operationId || summary.id,
      operationId: summary.operationId,
      userId: summary.userId,
      sessionId: summary.sessionId,
      jobId: summary.jobId,
      serviceName: summary.serviceName,
      totalPromptTokens: summary.totalPromptTokens,
      totalCompletionTokens: summary.totalCompletionTokens,
      totalTokens: summary.totalTokens,
      inputCostUsd: summary.inputCostUsd,
      outputCostUsd: summary.outputCostUsd,
      totalCostUsd: summary.totalCostUsd,
      requestCount: summary.requestCount,
      successCount: summary.successCount,
      failedCount: summary.failedCount,
      pricingMissingCount: summary.pricingMissingCount,
      features: summary.features,
      status: summary.status,
      createdAt: summary.createdAt,
    })
  }

  return summary
}

/** Compact internal final-cost object (not for public user APIs). */
export function toFinalAiCost(summary) {
  if (!summary) {
    return {
      operationId: null,
      totalCostUsd: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      features: {},
    }
  }
  return {
    operationId: summary.operationId || null,
    totalCostUsd: summary.totalCostUsd || 0,
    inputCostUsd: summary.inputCostUsd || 0,
    outputCostUsd: summary.outputCostUsd || 0,
    promptTokens: summary.totalPromptTokens || 0,
    completionTokens: summary.totalCompletionTokens || 0,
    totalTokens: summary.totalTokens || 0,
    requestCount: summary.requestCount || 0,
    successCount: summary.successCount || 0,
    failedCount: summary.failedCount || 0,
    pricingMissingCount: summary.pricingMissingCount || 0,
    features: summary.features || {},
  }
}

/**
 * Public-safe AI usage snapshot for score reports / matchAnalysis.
 * Keeps legacy diagnostics (tokens + costUsd) but strips Phase 1 ledger fields
 * that must stay backend/admin-only (input/output splits, pricing flags, feature costs).
 */
export function toPublicAiUsage(summary) {
  if (!summary) return null
  return {
    calls: (summary.calls || []).map((c) => ({
      task: c.task,
      provider: c.provider,
      model: c.model,
      promptTokens: c.promptTokens || 0,
      completionTokens: c.completionTokens || 0,
      cachedInputTokens: c.cachedInputTokens || 0,
      durationMs: c.durationMs || 0,
      costUsd: c.costUsd || 0,
    })),
    summary: (summary.summary || []).map((s) => ({
      provider: s.provider,
      model: s.model,
      calls: s.calls || 0,
      tasks: s.tasks || [],
      promptTokens: s.promptTokens || 0,
      completionTokens: s.completionTokens || 0,
      cachedInputTokens: s.cachedInputTokens || 0,
      costUsd: s.costUsd || 0,
    })),
    primaryProvider: summary.primaryProvider || null,
    primaryModel: summary.primaryModel || null,
    totals: {
      llmCalls: summary.totals?.llmCalls ?? summary.requestCount ?? 0,
      promptTokens: summary.totals?.promptTokens ?? summary.totalPromptTokens ?? 0,
      completionTokens: summary.totals?.completionTokens ?? summary.totalCompletionTokens ?? 0,
      cachedInputTokens: summary.totals?.cachedInputTokens ?? summary.cachedInputTokens ?? 0,
      costUsd: summary.totals?.costUsd ?? summary.totalCostUsd ?? 0,
    },
  }
}
