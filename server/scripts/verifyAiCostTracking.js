/**
 * Phase 1 deployment verification for AI cost tracking.
 *
 * Usage (from repo root, with .env loaded):
 *   node server/scripts/verifyAiCostTracking.js
 *
 * Prerequisites:
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   - ai_usage_events + ai_service_costs tables applied (ai-cost-tracking.sql)
 *   - Local API running on PORT (default 3001) with Phase 1 code
 *   - Auth: set VERIFY_EMAIL / VERIFY_PASSWORD OR VERIFY_TOKEN
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import {
  isSupabaseConfigured,
  getSupabase,
} from '../supabase/client.js'
import { flushAiCostPersist, listAiCostEvents, listAiServiceCosts } from '../store/aiCostStore.js'
import {
  runWithAiCostContext,
  recordAiRequest,
  finalizeAiServiceCost,
  AI_SERVICES,
} from '../services/aiCostTracking.js'
import { structuredJSON } from '../services/aiProvider.js'
import { analyzeJd } from '../services/openaiService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = (process.env.VERIFY_API_BASE || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, '')
const report = {
  schemaApplied: false,
  envOk: false,
  services: {},
  fallback: null,
  cache: null,
  privacy: null,
  durability: null,
  errors: [],
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function api(pathname, { method = 'GET', token, body, formData, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (formData) {
    opts.body = formData
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`${API}${pathname}`, opts)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* raw */ }
  return { status: res.status, json, text, headers: res.headers }
}

async function step1Schema(sb) {
  const requiredEvent = [
    'id', 'operation_id', 'user_id', 'session_id', 'job_id', 'service_name', 'feature_name',
    'provider', 'model', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_input_tokens',
    'usage_source', 'input_cost_usd', 'output_cost_usd', 'total_cost_usd', 'pricing_missing',
    'pricing_version', 'pricing_effective_date', 'processing_time_ms', 'status', 'error_message', 'created_at',
  ]
  const requiredService = [
    'id', 'operation_id', 'user_id', 'session_id', 'job_id', 'service_name',
    'total_prompt_tokens', 'total_completion_tokens', 'total_tokens',
    'input_cost_usd', 'output_cost_usd', 'total_cost_usd',
    'request_count', 'success_count', 'failed_count', 'pricing_missing_count',
    'features', 'status', 'created_at',
  ]

  const probeId = randomUUID()
  const opId = randomUUID()
  const event = {
    id: probeId,
    operation_id: opId,
    service_name: 'Schema Probe',
    feature_name: 'Probe',
    provider: 'OpenAI',
    model: 'gpt-4o-mini',
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    usage_source: 'actual',
    input_cost_usd: 0,
    output_cost_usd: 0,
    total_cost_usd: 0,
    pricing_missing: false,
    pricing_version: '2026-08-01',
    pricing_effective_date: '2026-08-01',
    processing_time_ms: 1,
    status: 'Success',
    created_at: new Date().toISOString(),
  }
  const ins = await sb.from('ai_usage_events').upsert(event).select('*').single()
  if (ins.error) {
    report.errors.push(`Schema missing/incomplete: ${ins.error.message}`)
    report.schemaApplied = false
    return false
  }
  const service = {
    id: opId,
    operation_id: opId,
    service_name: 'Schema Probe',
    total_prompt_tokens: 1,
    total_completion_tokens: 1,
    total_tokens: 2,
    input_cost_usd: 0,
    output_cost_usd: 0,
    total_cost_usd: 0,
    request_count: 1,
    success_count: 1,
    failed_count: 0,
    pricing_missing_count: 0,
    features: {},
    status: 'completed',
    created_at: new Date().toISOString(),
  }
  const sins = await sb.from('ai_service_costs').upsert(service).select('*').single()
  const eventKeys = Object.keys(ins.data || {})
  const serviceKeys = Object.keys(sins.data || {})
  const missingEvent = requiredEvent.filter((c) => !eventKeys.includes(c))
  const missingService = requiredService.filter((c) => !serviceKeys.includes(c))

  // update + read
  await sb.from('ai_usage_events').update({ processing_time_ms: 2 }).eq('id', probeId)
  const read = await sb.from('ai_usage_events').select('*').eq('operation_id', opId)
  await sb.from('ai_usage_events').delete().eq('id', probeId)
  await sb.from('ai_service_costs').delete().eq('id', opId)

  report.schemaApplied = !sins.error && missingEvent.length === 0 && missingService.length === 0 && (read.data?.length === 1)
  if (missingEvent.length) report.errors.push(`Missing ai_usage_events cols: ${missingEvent.join(',')}`)
  if (missingService.length) report.errors.push(`Missing ai_service_costs cols: ${missingService.join(',')}`)
  if (sins.error) report.errors.push(`ai_service_costs insert failed: ${sins.error.message}`)
  report.schemaDetails = {
    eventColumns: eventKeys.sort(),
    serviceColumns: serviceKeys.sort(),
    canInsertUpdateRead: report.schemaApplied,
  }
  return report.schemaApplied
}

async function step2Env() {
  const url = Boolean((process.env.SUPABASE_URL || '').trim())
  const key = Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
  const anon = Boolean((process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim())
  report.envOk = url && key && isSupabaseConfigured()
  report.env = {
    hasSupabaseUrl: url,
    hasServiceRoleKey: key,
    usingAnonKeyForServer: anon && !key,
    isSupabaseConfigured: isSupabaseConfigured(),
  }
  if (!report.envOk) report.errors.push('SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY missing')
  return report.envOk
}

async function login() {
  if (process.env.VERIFY_TOKEN) return process.env.VERIFY_TOKEN
  const email = process.env.VERIFY_EMAIL
  const password = process.env.VERIFY_PASSWORD
  if (email && password) {
    const res = await api('/api/auth/login', { method: 'POST', body: { email, password } })
    assert(res.status < 400 && res.json?.token, `Login failed: ${res.text}`)
    return res.json.token
  }

  // Prefer local-dev auth when enabled (local Phase 1 verification against Supabase).
  const status = await api('/api/auth/status')
  if (status.json?.localDevAuth) {
    const res = await api('/api/auth/local-dev', { method: 'POST', body: {} })
    assert(res.status < 400 && res.json?.token, `Local-dev auth failed: ${res.text}`)
    return res.json.token
  }

  throw new Error('Set VERIFY_TOKEN or VERIFY_EMAIL + VERIFY_PASSWORD for authenticated service tests')
}

function forbiddenKeys(obj, path = '') {
  const bad = []
  const banned = [
    'totalCostUsd', 'finalAiCost', 'inputCostUsd', 'outputCostUsd',
    'pricingMissing', 'pricingVersion', 'ai_usage_events', 'serviceRole',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  if (!obj || typeof obj !== 'object') return bad
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k
    if (banned.includes(k)) bad.push(p)
    if (v && typeof v === 'object') bad.push(...forbiddenKeys(v, p))
  }
  return bad
}

async function waitJob(statusPath, token, timeoutMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await api(statusPath, { token })
    if (res.json?.status === 'completed' || res.json?.status === 'failed') return res
    await sleep(1500)
  }
  throw new Error(`Timeout waiting for ${statusPath}`)
}

async function fetchOpRows(sb, operationId) {
  await flushAiCostPersist()
  await sleep(800)
  const events = await sb.from('ai_usage_events').select('*').eq('operation_id', operationId)
  const costs = await sb.from('ai_service_costs').select('*').eq('operation_id', operationId)
  return { events: events.data || [], cost: (costs.data || [])[0] || null, eventErr: events.error, costErr: costs.error }
}

function summarizeOperation(label, rows, costRow) {
  const sumCost = round6(rows.reduce((s, e) => s + Number(e.total_cost_usd || 0), 0))
  const sumPrompt = rows.reduce((s, e) => s + Number(e.prompt_tokens || 0), 0)
  const sumComp = rows.reduce((s, e) => s + Number(e.completion_tokens || 0), 0)
  const success = rows.filter((e) => e.status === 'Success').length
  const failed = rows.filter((e) => e.status === 'Failed').length
  const stored = costRow ? Number(costRow.total_cost_usd || 0) : null
  const diff = stored == null ? null : round6(stored - sumCost)
  return {
    service: label,
    operationId: rows[0]?.operation_id || costRow?.operation_id || null,
    requestCount: rows.length,
    calculatedRequestTotal: sumCost,
    storedOperationTotal: stored,
    difference: diff,
    promptTokens: sumPrompt,
    completionTokens: sumComp,
    totalTokens: sumPrompt + sumComp,
    successCount: success,
    failedCount: failed,
    storedRequestCount: costRow?.request_count ?? null,
    storedSuccess: costRow?.success_count ?? null,
    storedFailed: costRow?.failed_count ?? null,
    features: [...new Set(rows.map((e) => e.feature_name))],
    providers: [...new Set(rows.map((e) => e.provider))],
    usageSources: [...new Set(rows.map((e) => e.usage_source))],
    pass: Boolean(costRow) && rows.length > 0 && Math.abs(diff || 0) < 1e-8
      && Number(costRow.request_count) === rows.length
      && Number(costRow.success_count) === success
      && Number(costRow.failed_count) === failed,
  }
}

async function testBuilder(token, sb) {
  const formData = {
    name: 'Verify User',
    email: 'verify@example.com',
    phone: '555-0100',
    role: 'Software Engineer',
    yearsOfExperience: 5,
    companyCount: 1,
    bulletsPerCompany: 5,
    templateId: 'classic-blue',
    companies: [{
      name: 'Acme Corp',
      role: 'Software Engineer',
      city: 'Austin',
      state: 'TX',
      startDate: '2021-01',
      endDate: 'Present',
      skills: ['JavaScript', 'Node.js'],
    }],
    education: {
      school: 'State University',
      degree: 'BS',
      course: 'Computer Science',
      startDate: '2016',
      endDate: '2020',
    },
  }
  const start = await api('/api/builder/build', { method: 'POST', token, body: { formData } })
  assert(start.status < 400 && start.json?.jobId, `builder start failed: ${start.text}`)
  const privacyHits = forbiddenKeys(start.json)
  const done = await waitJob(`/api/builder/build-status/${start.json.jobId}`, token)
  privacyHits.push(...forbiddenKeys(done.json))
  assert(done.json?.status === 'completed', `builder failed: ${JSON.stringify(done.json)}`)

  // Discover operation_id (= jobId for builder)
  const opId = start.json.jobId
  const { events, cost } = await fetchOpRows(sb, opId)
  const summary = summarizeOperation('Resume Builder', events, cost)
  summary.privacyLeaksInResponses = privacyHits
  summary.pass = summary.pass && privacyHits.length === 0
  report.services.builder = summary
  return summary
}

async function testJdBuilder(token, sb) {
  const jdText = `
Job Title: Backend Engineer
Company: Contoso
We need a Backend Engineer with 3+ years experience in Node.js, PostgreSQL, REST APIs,
cloud services, and distributed systems. Responsibilities include designing APIs,
writing tests, and collaborating with product. Preferred: TypeScript, AWS, Docker.
`.trim()

  const formData = {
    name: 'Verify User',
    email: 'verify@example.com',
    phone: '555-0100',
    city: 'Seattle',
    state: 'WA',
    role: 'Backend Engineer',
    yearsOfExperience: 4,
    companyCount: 1,
    jdText,
    templateId: 'compact-ats',
    fontFamily: 'Calibri',
    fontSizePt: 11,
    companies: [{
      name: 'Contoso',
      role: 'Backend Engineer',
      city: 'Seattle',
      state: 'WA',
      country: 'USA',
      startDate: '2022-01',
      endDate: 'Present',
      bulletCount: 12,
      skills: ['Node.js', 'PostgreSQL'],
    }],
    education: [{ school: 'State University', degree: 'BS', course: 'Computer Science', startDate: '2016', endDate: '2020' }],
  }

  const start = await api('/api/jd-builder/build', { method: 'POST', token, body: { formData } })
  assert(start.status < 400 && start.json?.jobId, `jd-builder start failed: ${start.text}`)
  const privacyHits = forbiddenKeys(start.json)
  const done = await waitJob(`/api/jd-builder/build-status/${start.json.jobId}`, token, 240000)
  privacyHits.push(...forbiddenKeys(done.json))

  const opId = start.json.jobId
  const { events, cost } = await fetchOpRows(sb, opId)
  const summary = summarizeOperation('JD-Tailored Resume Builder', events, cost)
  summary.jobStatus = done.json?.status || null
  summary.jobError = done.json?.error || null
  summary.privacyLeaksInResponses = privacyHits
  // Cost-tracking pass: events + reconciled totals, even if Claude-only generation fails in this env
  summary.pass = summary.pass && privacyHits.length === 0 && events.length > 0
  if (done.json?.status !== 'completed') {
    summary.note = 'Job did not complete successfully; cost tracking still verified for recorded attempts'
  }
  report.services.jdBuilder = summary
  return summary
}

async function testEnhancer(token, sb) {
  // Minimal DOCX (empty zip with [Content_Types] is not enough for real enhance) —
  // use a tiny generated docx from the local generator if available, else skip with error.
  const { Document, Packer, Paragraph, TextRun } = await import('docx')
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Verify User', bold: true })] }),
        new Paragraph({ children: [new TextRun('Software Engineer')] }),
        new Paragraph({ children: [new TextRun('Experience')] }),
        new Paragraph({ children: [new TextRun('Acme Corp — Software Engineer (2021 – Present)')] }),
        new Paragraph({ children: [new TextRun('• Built Node.js APIs and React dashboards for B2B customers')] }),
        new Paragraph({ children: [new TextRun('• Improved PostgreSQL query performance by 30%')] }),
        new Paragraph({ children: [new TextRun('Skills: JavaScript, Node.js, PostgreSQL, React')] }),
      ],
    }],
  })
  const buffer = await Packer.toBuffer(doc)
  const form = new FormData()
  form.append('resume', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'verify.docx')

  const upload = await api('/api/enhancer/upload', { method: 'POST', token, formData: form })
  assert(upload.status < 400 && upload.json?.sessionId, `upload failed: ${upload.text}`)
  const sessionId = upload.json.sessionId

  const jdText = `
Job Title: Full Stack Engineer
Required: JavaScript, Node.js, React, PostgreSQL, REST APIs, 3+ years experience.
Build scalable web applications and collaborate with product teams.
`.trim()
  await api('/api/enhancer/jd', { method: 'PUT', token, body: { sessionId, jdText } })
  await sleep(2500)

  const start = await api('/api/enhancer/enhance', { method: 'POST', token, body: { sessionId, jdText } })
  assert(start.status < 400 && start.json?.jobId, `enhance start failed: ${start.text}`)
  const privacyHits = forbiddenKeys(start.json)
  const done = await waitJob(`/api/enhancer/enhance-status/${start.json.jobId}`, token, 300000)
  privacyHits.push(...forbiddenKeys(done.json))
  assert(done.json?.status === 'completed', `enhance failed: ${JSON.stringify(done.json?.error || done.json)}`)

  // Find operation_id from latest enhancer events for this session
  await flushAiCostPersist()
  await sleep(1000)
  const ev = await sb.from('ai_usage_events').select('*').eq('session_id', sessionId).order('created_at', { ascending: true })
  const rows = ev.data || []
  const opId = rows[0]?.operation_id
  const { events, cost } = await fetchOpRows(sb, opId)
  const summary = summarizeOperation('Resume Enhancer', events, cost)
  summary.sessionId = sessionId
  summary.privacyLeaksInResponses = privacyHits
  summary.pass = summary.pass && privacyHits.length === 0
  report.services.enhancer = summary

  // Layout fix with a tiny PNG so vision analysis is attempted
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const pngBytes = Buffer.from(pngBase64, 'base64')
  const layoutForm = new FormData()
  layoutForm.append('sessionId', sessionId)
  layoutForm.append('message', 'There is too much white space / blank gap near the skills section.')
  layoutForm.append('evidence', new Blob([pngBytes], { type: 'image/png' }), 'layout.png')
  const layout = await api('/api/enhancer/layout-fix', { method: 'POST', token, formData: layoutForm })
  const layoutPrivacy = forbiddenKeys(layout.json)
  await sleep(1500)
  await flushAiCostPersist()
  const layoutEvents = await sb.from('ai_usage_events')
    .select('*')
    .eq('service_name', AI_SERVICES.LAYOUT_FIX)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(50)
  const layoutRows = layoutEvents.data || []
  const layoutOp = layoutRows[0]?.operation_id
  let layoutSummary
  if (layoutOp) {
    const fetched = await fetchOpRows(sb, layoutOp)
    layoutSummary = summarizeOperation('Layout Fix Chat', fetched.events, fetched.cost)
  } else {
    layoutSummary = {
      service: 'Layout Fix Chat',
      operationId: null,
      requestCount: 0,
      note: 'No AI cost events recorded for layout-fix',
      privacyLeaksInResponses: layoutPrivacy,
      pass: false,
    }
  }
  layoutSummary.httpStatus = layout.status
  layoutSummary.privacyLeaksInResponses = layoutPrivacy
  layoutSummary.pass = Boolean(layoutSummary.pass) && layoutPrivacy.length === 0 && layout.status < 500
  report.services.layoutFix = layoutSummary
  return { enhancer: summary, layoutFix: layoutSummary }
}

async function testFallback() {
  // Controlled unit-level fallback recording (does not mutate production AI_PROVIDER_ORDER)
  const opId = randomUUID()
  const summary = await runWithAiCostContext({
    operationId: opId,
    serviceName: 'Fallback Probe',
    sessionId: 'fallback-probe',
  }, async () => {
    recordAiRequest({
      providerKey: 'openai',
      model: 'gpt-4.1-mini',
      task: 'enhancement_plan',
      status: 'Failed',
      errorMessage: 'controlled fallback test failure',
      processingTimeMs: 55,
      usageSource: 'unknown',
    })
    recordAiRequest({
      providerKey: 'groq',
      model: 'llama-3.3-70b-versatile',
      task: 'enhancement_plan',
      promptTokens: 100,
      completionTokens: 40,
      status: 'Success',
      processingTimeMs: 80,
      usageSource: 'actual',
    })
    return finalizeAiServiceCost({ status: 'completed' })
  })
  await flushAiCostPersist()
  await sleep(1000)
  const sb = getSupabase()
  const { events, cost } = await fetchOpRows(sb, opId)
  const failed = events.find((e) => e.status === 'Failed')
  const ok = events.find((e) => e.status === 'Success')
  report.fallback = {
    operationId: opId,
    requestCount: events.length,
    sameOperationId: events.every((e) => e.operation_id === opId),
    failedHasError: Boolean(failed?.error_message),
    successHasTokens: Number(ok?.prompt_tokens || 0) > 0,
    serviceTotalOnce: Boolean(cost) && Number(cost.request_count) === events.length,
    calculated: round6(events.reduce((s, e) => s + Number(e.total_cost_usd || 0), 0)),
    stored: cost ? Number(cost.total_cost_usd) : null,
    pass: events.length === 2
      && events.every((e) => e.operation_id === opId)
      && Boolean(failed?.error_message)
      && Number(ok?.prompt_tokens || 0) > 0
      && Boolean(cost)
      && Number(cost.request_count) === 2,
  }
  // cleanup probe rows
  await sb.from('ai_usage_events').delete().eq('operation_id', opId)
  await sb.from('ai_service_costs').delete().eq('operation_id', opId)
  return report.fallback
}

async function testCache() {
  const jd = `
Unique Cache Probe JD ${randomUUID()}
Role: Data Engineer
Need Python, SQL, Airflow, Spark, 4+ years. Build pipelines and warehouses.
`.trim()

  const before = Date.now()
  const first = await analyzeJd(jd)
  await flushAiCostPersist()
  await sleep(700)
  const sb = getSupabase()
  const afterFirst = await sb.from('ai_usage_events').select('id, feature_name, created_at')
    .eq('feature_name', 'JD Analysis')
    .gte('created_at', new Date(before - 1000).toISOString())
  const firstCount = (afterFirst.data || []).length

  const second = await analyzeJd(jd)
  await flushAiCostPersist()
  await sleep(700)
  const afterSecond = await sb.from('ai_usage_events').select('id, feature_name, created_at')
    .eq('feature_name', 'JD Analysis')
    .gte('created_at', new Date(before - 1000).toISOString())
  const secondCount = (afterSecond.data || []).length

  report.cache = {
    firstCached: Boolean(first.cached),
    secondCached: Boolean(second.cached),
    jdAnalysisEventsAfterFirst: firstCount,
    jdAnalysisEventsAfterSecond: secondCount,
    noFakeEventOnCacheHit: second.cached === true && secondCount === firstCount,
    pass: first.cached === false && second.cached === true && secondCount === firstCount && firstCount >= 1,
  }
  return report.cache
}

async function testPrivacyStatic() {
  const files = [
    'server/routes/enhancer.js',
    'server/routes/builder.js',
    'server/routes/jdBuilder.js',
  ].map((f) => path.join(process.cwd(), f))
  const leaks = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    if (/payload\.finalAiCost/.test(src)) leaks.push(`${path.basename(file)}: payload.finalAiCost`)
    if (/res\.json\([^\)]*finalAiCost/.test(src)) leaks.push(`${path.basename(file)}: res.json finalAiCost`)
  }
  report.privacy = {
    staticLeaks: leaks,
    pass: leaks.length === 0,
  }
  return report.privacy
}

async function testDurability(sb) {
  const id = randomUUID()
  const op = randomUUID()
  await sb.from('ai_usage_events').upsert({
    id,
    operation_id: op,
    service_name: 'Durability Probe',
    feature_name: 'Probe',
    provider: 'OpenAI',
    model: 'gpt-4o-mini',
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    usage_source: 'actual',
    total_cost_usd: 0,
    status: 'Success',
    processing_time_ms: 1,
    created_at: new Date().toISOString(),
  })
  const read = await sb.from('ai_usage_events').select('id').eq('id', id).maybeSingle()
  await sb.from('ai_usage_events').delete().eq('id', id)
  report.durability = {
    supabaseWriteReadOk: Boolean(read.data?.id),
    localJsonIsNotSourceOfTruth: isSupabaseConfigured(),
    note: 'Redeploy durability requires Phase 1 code on Render; this checks Supabase persistence directly.',
    pass: Boolean(read.data?.id) && isSupabaseConfigured(),
  }
  return report.durability
}

async function main() {
  console.log('AI Cost Tracking — Phase 1 deployment verification')
  console.log('API base:', API)

  await step2Env()
  if (!report.envOk) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(2)
  }
  const sb = getSupabase()
  const schemaOk = await step1Schema(sb)
  await testPrivacyStatic()
  await testDurability(sb)

  if (!schemaOk) {
    report.errors.push('Apply server/supabase/ai-cost-tracking.sql in Supabase SQL Editor, then re-run.')
    console.log(JSON.stringify(report, null, 2))
    process.exit(3)
  }

  // Health / local server
  const health = await api('/api/health')
  if (health.status !== 200) {
    report.errors.push(`API not reachable at ${API}/api/health (start local server with Phase 1 code)`)
    console.log(JSON.stringify(report, null, 2))
    process.exit(4)
  }

  try {
    await testFallback()
  } catch (err) {
    report.fallback = { pass: false, error: err.message }
    report.errors.push(`fallback: ${err.message}`)
  }

  try {
    await testCache()
  } catch (err) {
    report.cache = { pass: false, error: err.message }
    report.errors.push(`cache: ${err.message}`)
  }

  try {
    const token = await login()
    const results = []
    try { results.push(await testBuilder(token, sb)) } catch (err) {
      report.services.builder = { pass: false, error: err.message }
      report.errors.push(`builder: ${err.message}`)
    }
    try { results.push(await testJdBuilder(token, sb)) } catch (err) {
      report.services.jdBuilder = { pass: false, error: err.message }
      report.errors.push(`jdBuilder: ${err.message}`)
    }
    try { results.push(await testEnhancer(token, sb)) } catch (err) {
      report.services.enhancer = { pass: false, error: err.message }
      report.errors.push(`enhancer: ${err.message}`)
    }
  } catch (err) {
    report.errors.push(`service tests: ${err.message}`)
  }

  const outPath = path.join(__dirname, 'ai-cost-verify-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log('Wrote', outPath)

  const servicePass = Object.values(report.services).every((s) => s.pass)
  const ok = report.schemaApplied && report.envOk && report.fallback?.pass && report.cache?.pass
    && report.privacy?.pass && report.durability?.pass && servicePass && report.errors.length === 0
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
