/**
 * Durable AI cost event ledger.
 *
 * Persistence priority:
 *   1) Supabase Postgres (permanent) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *   2) Local JSON under server/user-data/ as a write-ahead fallback / offline buffer
 *
 * Writes are serialized and non-blocking for AI latency. Local buffer is NOT the
 * source of truth in production — configure Supabase for permanent storage.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getSupabase, isSupabaseConfigured } from '../supabase/client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')
const EVENTS_FILE = path.join(DATA_DIR, 'ai-cost-events.json')
const SERVICE_COSTS_FILE = path.join(DATA_DIR, 'ai-service-costs.json')

const MAX_LOCAL_EVENTS = 50_000
const MAX_LOCAL_SERVICE_COSTS = 10_000

/** @type {object[]} */
let eventsMemory = []
/** @type {object[]} */
let serviceCostsMemory = []
let loaded = false
let persistChain = Promise.resolve()
let warnedNoSupabase = false

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function ensureLoaded() {
  if (loaded) return
  eventsMemory = readJsonArray(EVENTS_FILE)
  serviceCostsMemory = readJsonArray(SERVICE_COSTS_FILE)
  loaded = true
}

function writeLocal() {
  ensureDirs()
  ensureLoaded()
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsMemory.slice(-MAX_LOCAL_EVENTS)))
  fs.writeFileSync(SERVICE_COSTS_FILE, JSON.stringify(serviceCostsMemory.slice(-MAX_LOCAL_SERVICE_COSTS)))
}

function warnIfNoSupabase() {
  if (warnedNoSupabase || isSupabaseConfigured()) return
  warnedNoSupabase = true
  console.warn(
    '[ai-cost] WARNING: Supabase is not configured. AI cost events are buffered to local JSON only '
      + 'and will not survive redeploys. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and run schema.sql.',
  )
}

function eventToRow(event) {
  return {
    id: event.requestId,
    operation_id: event.operationId || null,
    user_id: event.userId || null,
    session_id: event.sessionId || null,
    job_id: event.jobId || null,
    service_name: event.serviceName,
    feature_name: event.featureName,
    provider: event.provider,
    model: event.model,
    prompt_tokens: event.promptTokens || 0,
    completion_tokens: event.completionTokens || 0,
    total_tokens: event.totalTokens || 0,
    cached_input_tokens: event.cachedInputTokens || 0,
    usage_source: event.usageSource || 'unknown',
    input_cost_usd: event.inputCostUsd || 0,
    output_cost_usd: event.outputCostUsd || 0,
    total_cost_usd: event.totalCostUsd || 0,
    pricing_missing: Boolean(event.pricingMissing),
    pricing_version: event.pricingVersion || null,
    pricing_effective_date: event.pricingEffectiveDate || null,
    processing_time_ms: event.processingTimeMs || 0,
    status: event.status,
    error_message: event.errorMessage || null,
    created_at: event.createdAt,
  }
}

function serviceCostToRow(summary) {
  return {
    id: summary.id,
    operation_id: summary.operationId || null,
    user_id: summary.userId || null,
    session_id: summary.sessionId || null,
    job_id: summary.jobId || null,
    service_name: summary.serviceName,
    total_prompt_tokens: summary.totalPromptTokens || 0,
    total_completion_tokens: summary.totalCompletionTokens || 0,
    total_tokens: summary.totalTokens || 0,
    input_cost_usd: summary.inputCostUsd || 0,
    output_cost_usd: summary.outputCostUsd || 0,
    total_cost_usd: summary.totalCostUsd || 0,
    request_count: summary.requestCount || 0,
    success_count: summary.successCount || 0,
    failed_count: summary.failedCount || 0,
    pricing_missing_count: summary.pricingMissingCount || 0,
    features: summary.features || {},
    status: summary.status,
    created_at: summary.createdAt,
  }
}

async function persistEventToSupabase(event) {
  const sb = getSupabase()
  if (!sb) return false
  const { error } = await sb.from('ai_usage_events').upsert(eventToRow(event), { onConflict: 'id' })
  if (error) {
    console.warn(`[ai-cost] supabase event write failed: ${error.message}`)
    return false
  }
  return true
}

async function persistServiceCostToSupabase(summary) {
  const sb = getSupabase()
  if (!sb) return false
  const { error } = await sb.from('ai_service_costs').upsert(serviceCostToRow(summary), { onConflict: 'id' })
  if (error) {
    console.warn(`[ai-cost] supabase service-cost write failed: ${error.message}`)
    return false
  }
  return true
}

function enqueue(work) {
  persistChain = persistChain.then(work).catch((err) => {
    console.warn(`[ai-cost] persist error: ${err.message}`)
  })
}

/** Append one AI request event (always local buffer; Supabase when configured). */
export function appendAiCostEvent(event) {
  warnIfNoSupabase()
  ensureLoaded()
  eventsMemory.push(event)
  if (eventsMemory.length > MAX_LOCAL_EVENTS) {
    eventsMemory = eventsMemory.slice(-MAX_LOCAL_EVENTS)
  }
  enqueue(async () => {
    writeLocal()
    if (isSupabaseConfigured()) await persistEventToSupabase(event)
  })
}

/** Append a completed operation-level cost summary (upserts by operationId). */
export function appendAiServiceCost(summary) {
  warnIfNoSupabase()
  ensureLoaded()
  let row = summary
  if (summary.operationId) {
    const idx = serviceCostsMemory.findIndex((s) => s.operationId === summary.operationId)
    if (idx >= 0) {
      row = { ...summary, id: serviceCostsMemory[idx].id }
      serviceCostsMemory[idx] = row
    } else {
      serviceCostsMemory.push(row)
    }
  } else {
    serviceCostsMemory.push(row)
  }
  if (serviceCostsMemory.length > MAX_LOCAL_SERVICE_COSTS) {
    serviceCostsMemory = serviceCostsMemory.slice(-MAX_LOCAL_SERVICE_COSTS)
  }
  enqueue(async () => {
    writeLocal()
    if (isSupabaseConfigured()) await persistServiceCostToSupabase(row)
  })
}

/** Await pending durable writes (tests / graceful shutdown). */
export async function flushAiCostPersist() {
  await persistChain
}

/** In-memory / local reads for future admin reporting APIs. */
export function listAiCostEvents({ limit = 100, userId, sessionId, serviceName, operationId } = {}) {
  ensureLoaded()
  let rows = eventsMemory
  if (userId) rows = rows.filter((e) => e.userId === userId)
  if (sessionId) rows = rows.filter((e) => e.sessionId === sessionId)
  if (serviceName) rows = rows.filter((e) => e.serviceName === serviceName)
  if (operationId) rows = rows.filter((e) => e.operationId === operationId)
  return rows.slice(-Math.max(1, limit))
}

export function listAiServiceCosts({ limit = 100, userId, sessionId, serviceName, operationId } = {}) {
  ensureLoaded()
  let rows = serviceCostsMemory
  if (userId) rows = rows.filter((e) => e.userId === userId)
  if (sessionId) rows = rows.filter((e) => e.sessionId === sessionId)
  if (serviceName) rows = rows.filter((e) => e.serviceName === serviceName)
  if (operationId) rows = rows.filter((e) => e.operationId === operationId)
  return rows.slice(-Math.max(1, limit))
}

export function isAiCostDbConfigured() {
  return isSupabaseConfigured()
}
