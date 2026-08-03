/**
 * Admin-only AI cost reporting.
 * Aggregates stored rows from ai_usage_events + ai_service_costs (Supabase).
 * Totals are computed on the server from DB records — never invent pricing here.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase/client.js'
import {
  listAiCostEvents,
  listAiServiceCosts,
  isAiCostDbConfigured,
} from '../store/aiCostStore.js'
import { AI_SERVICES } from './aiCostTracking.js'

const PAGE = 1000
const MAX_ROWS = 50_000

const RESUME_SERVICES = new Set([
  AI_SERVICES.ENHANCER,
  AI_SERVICES.BUILDER,
  AI_SERVICES.JD_BUILDER,
])

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

function round4(n) {
  return Math.round((Number(n) || 0) * 1e4) / 1e4
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function parseDateBound(value, endOfDay = false) {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Normalize query filters for dashboard endpoints. */
export function parseAiCostFilters(query = {}) {
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const from = parseDateBound(query.from, false) || defaultFrom.toISOString()
  const to = parseDateBound(query.to, true) || now.toISOString()

  const statusRaw = String(query.status || '').trim()
  let requestStatus = null
  let operationStatus = null
  if (statusRaw) {
    const lower = statusRaw.toLowerCase()
    if (lower === 'success') requestStatus = 'Success'
    else if (statusRaw === 'Failed') requestStatus = 'Failed'
    else if (lower === 'failed') {
      // lowercase "failed" matches request Failed + operation failed
      requestStatus = 'Failed'
      operationStatus = 'failed'
    } else if (lower === 'completed') operationStatus = 'completed'
    else operationStatus = statusRaw
  }

  return {
    from,
    to,
    service: String(query.service || '').trim() || null,
    provider: String(query.provider || '').trim() || null,
    model: String(query.model || '').trim() || null,
    userId: String(query.userId || '').trim() || null,
    operationId: String(query.operationId || '').trim() || null,
    requestStatus,
    operationStatus,
    expensiveLimit: Math.min(100, Math.max(1, Number(query.expensiveLimit) || 25)),
  }
}

function mapEventRow(row) {
  return {
    id: row.id,
    operationId: row.operation_id ?? row.operationId ?? null,
    userId: row.user_id ?? row.userId ?? null,
    sessionId: row.session_id ?? row.sessionId ?? null,
    jobId: row.job_id ?? row.jobId ?? null,
    serviceName: row.service_name ?? row.serviceName,
    featureName: row.feature_name ?? row.featureName,
    provider: row.provider,
    model: row.model,
    promptTokens: Number(row.prompt_tokens ?? row.promptTokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? row.completionTokens ?? 0),
    totalTokens: Number(row.total_tokens ?? row.totalTokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? row.cachedInputTokens ?? 0),
    usageSource: row.usage_source ?? row.usageSource ?? 'unknown',
    inputCostUsd: Number(row.input_cost_usd ?? row.inputCostUsd ?? 0),
    outputCostUsd: Number(row.output_cost_usd ?? row.outputCostUsd ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? row.totalCostUsd ?? 0),
    pricingMissing: Boolean(row.pricing_missing ?? row.pricingMissing),
    pricingVersion: row.pricing_version ?? row.pricingVersion ?? null,
    pricingEffectiveDate: row.pricing_effective_date ?? row.pricingEffectiveDate ?? null,
    processingTimeMs: Number(row.processing_time_ms ?? row.processingTimeMs ?? 0),
    status: row.status,
    errorMessage: row.error_message ?? row.errorMessage ?? null,
    createdAt: row.created_at ?? row.createdAt,
  }
}

function mapOpRow(row) {
  return {
    id: row.id,
    operationId: row.operation_id ?? row.operationId ?? null,
    userId: row.user_id ?? row.userId ?? null,
    sessionId: row.session_id ?? row.sessionId ?? null,
    jobId: row.job_id ?? row.jobId ?? null,
    serviceName: row.service_name ?? row.serviceName,
    totalPromptTokens: Number(row.total_prompt_tokens ?? row.totalPromptTokens ?? 0),
    totalCompletionTokens: Number(row.total_completion_tokens ?? row.totalCompletionTokens ?? 0),
    totalTokens: Number(row.total_tokens ?? row.totalTokens ?? 0),
    inputCostUsd: Number(row.input_cost_usd ?? row.inputCostUsd ?? 0),
    outputCostUsd: Number(row.output_cost_usd ?? row.outputCostUsd ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? row.totalCostUsd ?? 0),
    requestCount: Number(row.request_count ?? row.requestCount ?? 0),
    successCount: Number(row.success_count ?? row.successCount ?? 0),
    failedCount: Number(row.failed_count ?? row.failedCount ?? 0),
    pricingMissingCount: Number(row.pricing_missing_count ?? row.pricingMissingCount ?? 0),
    features: row.features || {},
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
  }
}

async function fetchAllSupabase(table, apply) {
  const sb = getSupabase()
  if (!sb) return []
  const out = []
  let offset = 0
  while (offset < MAX_ROWS) {
    let q = sb.from(table).select('*')
    q = apply(q)
    q = q.order('created_at', { ascending: true }).range(offset, offset + PAGE - 1)
    const { data, error } = await q
    if (error) throw Object.assign(new Error(error.message), { status: 502 })
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return out
}

function applySharedOpFilters(q, filters, { includeDate = true } = {}) {
  if (includeDate) {
    if (filters.from) q = q.gte('created_at', filters.from)
    if (filters.to) q = q.lte('created_at', filters.to)
  }
  if (filters.service) q = q.eq('service_name', filters.service)
  if (filters.userId) q = q.eq('user_id', filters.userId)
  if (filters.operationId) q = q.eq('operation_id', filters.operationId)
  if (filters.operationStatus) q = q.eq('status', filters.operationStatus)
  return q
}

function applySharedEventFilters(q, filters, { includeDate = true } = {}) {
  if (includeDate) {
    if (filters.from) q = q.gte('created_at', filters.from)
    if (filters.to) q = q.lte('created_at', filters.to)
  }
  if (filters.service) q = q.eq('service_name', filters.service)
  if (filters.userId) q = q.eq('user_id', filters.userId)
  if (filters.operationId) q = q.eq('operation_id', filters.operationId)
  if (filters.provider) q = q.eq('provider', filters.provider)
  if (filters.model) q = q.eq('model', filters.model)
  if (filters.requestStatus) q = q.eq('status', filters.requestStatus)
  return q
}

function localEvents(filters, { includeDate = true } = {}) {
  let rows = listAiCostEvents({ limit: MAX_ROWS }).map(mapEventRow)
  if (includeDate) {
    if (filters.from) rows = rows.filter((e) => e.createdAt >= filters.from)
    if (filters.to) rows = rows.filter((e) => e.createdAt <= filters.to)
  }
  if (filters.service) rows = rows.filter((e) => e.serviceName === filters.service)
  if (filters.userId) rows = rows.filter((e) => e.userId === filters.userId)
  if (filters.operationId) rows = rows.filter((e) => e.operationId === filters.operationId)
  if (filters.provider) rows = rows.filter((e) => e.provider === filters.provider)
  if (filters.model) rows = rows.filter((e) => e.model === filters.model)
  if (filters.requestStatus) rows = rows.filter((e) => e.status === filters.requestStatus)
  return rows
}

function localOps(filters, { includeDate = true } = {}) {
  let rows = listAiServiceCosts({ limit: MAX_ROWS }).map(mapOpRow)
  if (includeDate) {
    if (filters.from) rows = rows.filter((e) => e.createdAt >= filters.from)
    if (filters.to) rows = rows.filter((e) => e.createdAt <= filters.to)
  }
  if (filters.service) rows = rows.filter((e) => e.serviceName === filters.service)
  if (filters.userId) rows = rows.filter((e) => e.userId === filters.userId)
  if (filters.operationId) rows = rows.filter((e) => e.operationId === filters.operationId)
  if (filters.operationStatus) rows = rows.filter((e) => e.status === filters.operationStatus)
  return rows
}

async function loadEvents(filters, opts) {
  if (isSupabaseConfigured()) {
    const rows = await fetchAllSupabase('ai_usage_events', (q) => applySharedEventFilters(q, filters, opts))
    return rows.map(mapEventRow)
  }
  return localEvents(filters, opts)
}

async function loadOps(filters, opts) {
  if (isSupabaseConfigured()) {
    const rows = await fetchAllSupabase('ai_service_costs', (q) => applySharedOpFilters(q, filters, opts))
    return rows.map(mapOpRow)
  }
  return localOps(filters, opts)
}

/**
 * When provider/model/requestStatus filters are set, limit operation rows to
 * operations that have at least one matching request (no invented costs).
 */
async function loadOpsRespectingEventFilters(filters) {
  const hasEventOnly =
    Boolean(filters.provider) || Boolean(filters.model) || Boolean(filters.requestStatus)

  let ops = await loadOps(filters)
  if (!hasEventOnly) return ops

  const events = await loadEvents(filters)
  const opIds = new Set(events.map((e) => e.operationId).filter(Boolean))
  return ops.filter((o) => o.operationId && opIds.has(o.operationId))
}

function sumCost(rows) {
  return round6(rows.reduce((s, r) => s + (Number(r.totalCostUsd) || 0), 0))
}

function buildOverview(ops, events, filters, opsToday, opsMonth) {
  const completed = ops.filter((o) => String(o.status || '').toLowerCase() === 'completed')
  const resumeOps = completed.filter((o) => RESUME_SERVICES.has(o.serviceName))
  const avg =
    completed.length > 0 ? round6(sumCost(completed) / completed.length) : 0

  return {
    totalCostToday: sumCost(opsToday),
    totalCostThisMonth: sumCost(opsMonth),
    totalCostInRange: sumCost(ops),
    totalAiRequests: events.length,
    totalResumesProcessed: resumeOps.length,
    averageCostPerCompletedOperation: avg,
    successfulRequests: events.filter((e) => e.status === 'Success').length,
    failedRequests: events.filter((e) => e.status === 'Failed').length,
    missingPricingRequests: events.filter((e) => e.pricingMissing).length,
    operationCount: ops.length,
    completedOperationCount: completed.length,
    range: { from: filters.from, to: filters.to },
    source: isAiCostDbConfigured() ? 'supabase' : 'local-buffer',
  }
}

function buildByService(ops) {
  const map = new Map()
  for (const o of ops) {
    const key = o.serviceName || 'Unknown'
    if (!map.has(key)) {
      map.set(key, {
        serviceName: key,
        totalCostUsd: 0,
        operationCount: 0,
        totalTokens: 0,
        successRequests: 0,
        failedRequests: 0,
        requestCount: 0,
      })
    }
    const row = map.get(key)
    row.totalCostUsd = round6(row.totalCostUsd + (o.totalCostUsd || 0))
    row.operationCount += 1
    row.totalTokens += o.totalTokens || 0
    row.successRequests += o.successCount || 0
    row.failedRequests += o.failedCount || 0
    row.requestCount += o.requestCount || 0
  }

  return [...map.values()]
    .map((r) => {
      const attempts = r.successRequests + r.failedRequests
      return {
        serviceName: r.serviceName,
        totalCostUsd: r.totalCostUsd,
        operationCount: r.operationCount,
        averageCostPerOperation: r.operationCount ? round6(r.totalCostUsd / r.operationCount) : 0,
        totalTokens: r.totalTokens,
        successRate: attempts ? round4(r.successRequests / attempts) : null,
      }
    })
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
}

function buildByProviderModel(events) {
  const map = new Map()
  for (const e of events) {
    const key = `${e.provider}::${e.model}`
    if (!map.has(key)) {
      map.set(key, {
        provider: e.provider,
        model: e.model,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalCostUsd: 0,
        failedCalls: 0,
        totalDurationMs: 0,
      })
    }
    const row = map.get(key)
    row.requestCount += 1
    row.promptTokens += e.promptTokens || 0
    row.completionTokens += e.completionTokens || 0
    row.totalCostUsd = round6(row.totalCostUsd + (e.totalCostUsd || 0))
    if (e.status === 'Failed') row.failedCalls += 1
    row.totalDurationMs += e.processingTimeMs || 0
  }

  return [...map.values()]
    .map((r) => ({
      provider: r.provider,
      model: r.model,
      requestCount: r.requestCount,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalCostUsd: r.totalCostUsd,
      failedCalls: r.failedCalls,
      averageResponseTimeMs: r.requestCount
        ? Math.round(r.totalDurationMs / r.requestCount)
        : 0,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
}

function buildDailyTrend(ops) {
  const map = new Map()
  for (const o of ops) {
    const day = String(o.createdAt || '').slice(0, 10)
    if (!day) continue
    if (!map.has(day)) {
      map.set(day, { date: day, totalCostUsd: 0, operationCount: 0 })
    }
    const row = map.get(day)
    row.totalCostUsd = round6(row.totalCostUsd + (o.totalCostUsd || 0))
    row.operationCount += 1
  }

  return [...map.values()]
    .map((r) => ({
      date: r.date,
      totalCostUsd: r.totalCostUsd,
      operationCount: r.operationCount,
      averageCostPerOperation: r.operationCount ? round6(r.totalCostUsd / r.operationCount) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function buildExpensive(ops, limit) {
  return [...ops]
    .filter((o) => String(o.status || '').toLowerCase() === 'completed')
    .sort((a, b) => (b.totalCostUsd || 0) - (a.totalCostUsd || 0))
    .slice(0, limit)
    .map((o) => ({
      operationId: o.operationId,
      serviceName: o.serviceName,
      userId: o.userId,
      sessionId: o.sessionId,
      totalCostUsd: o.totalCostUsd,
      totalTokens: o.totalTokens,
      requestCount: o.requestCount,
      failedAttempts: o.failedCount,
      createdAt: o.createdAt,
      status: o.status,
    }))
}

function buildFilterOptions(events, ops) {
  const services = new Set([
    ...Object.values(AI_SERVICES),
    ...ops.map((o) => o.serviceName),
    ...events.map((e) => e.serviceName),
  ].filter(Boolean))
  const providers = new Set(events.map((e) => e.provider).filter(Boolean))
  const models = new Set(events.map((e) => e.model).filter(Boolean))
  return {
    services: [...services].sort(),
    providers: [...providers].sort(),
    models: [...models].sort(),
    requestStatuses: ['Success', 'Failed'],
    operationStatuses: ['completed', 'failed'],
  }
}

export async function getAiCostDashboard(filters) {
  const events = await loadEvents(filters)
  const ops = await loadOpsRespectingEventFilters(filters)

  const todayStart = startOfUtcDay().toISOString()
  const monthStart = startOfUtcMonth().toISOString()
  const calendarBase = {
    ...filters,
    from: undefined,
    to: undefined,
    // keep non-date filters; rebuild without date for today/month cards
  }

  const todayFilters = { ...calendarBase, from: todayStart, to: new Date().toISOString() }
  const monthFilters = { ...calendarBase, from: monthStart, to: new Date().toISOString() }

  // Calendar cards use operation-level costs only (no double-count with events).
  const opsToday = await loadOpsRespectingEventFilters(todayFilters)
  const opsMonth = await loadOpsRespectingEventFilters(monthFilters)

  return {
    filters,
    overview: buildOverview(ops, events, filters, opsToday, opsMonth),
    byService: buildByService(ops),
    byProviderModel: buildByProviderModel(events),
    dailyTrend: buildDailyTrend(ops),
    expensiveOperations: buildExpensive(ops, filters.expensiveLimit),
    filterOptions: buildFilterOptions(events, ops),
    generatedAt: new Date().toISOString(),
  }
}

export async function getAiCostOperationDetail(operationId) {
  const id = String(operationId || '').trim()
  if (!id) {
    const err = new Error('operationId is required')
    err.status = 400
    throw err
  }

  const filters = {
    from: null,
    to: null,
    service: null,
    provider: null,
    model: null,
    userId: null,
    operationId: id,
    requestStatus: null,
    operationStatus: null,
  }

  const [ops, events] = await Promise.all([
    loadOps(filters, { includeDate: false }),
    loadEvents(filters, { includeDate: false }),
  ])

  const operation = ops[0] || null
  const attempts = events
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map((e) => ({
      id: e.id,
      featureName: e.featureName,
      provider: e.provider,
      model: e.model,
      status: e.status,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      totalTokens: e.totalTokens,
      inputCostUsd: e.inputCostUsd,
      outputCostUsd: e.outputCostUsd,
      totalCostUsd: e.totalCostUsd,
      processingTimeMs: e.processingTimeMs,
      errorMessage: e.errorMessage,
      usageSource: e.usageSource,
      pricingMissing: e.pricingMissing,
      createdAt: e.createdAt,
      serviceName: e.serviceName,
    }))

  if (!operation && attempts.length === 0) {
    const err = new Error('Operation not found')
    err.status = 404
    throw err
  }

  return {
    operation,
    attempts,
    source: isAiCostDbConfigured() ? 'supabase' : 'local-buffer',
  }
}

export function getAiCostAdminMeta() {
  return {
    services: Object.values(AI_SERVICES),
    durableBackend: isAiCostDbConfigured() ? 'supabase' : 'local-buffer',
    configured: isAiCostDbConfigured(),
  }
}
