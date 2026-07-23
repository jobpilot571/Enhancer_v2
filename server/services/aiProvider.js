import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

/*
 * Multi-provider AI layer with automatic fallback.
 * Order is controlled by AI_PROVIDER_ORDER (comma-separated).
 * Each provider returns { result, usage } where usage has token counts.
 */

function stripCodeFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractJson(text) {
  const cleaned = stripCodeFences(text)
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      let slice = cleaned.slice(start, end + 1)
      // Repair common truncation artifacts from long enhancement plans
      slice = slice
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u001f]+/g, ' ')
      try {
        return JSON.parse(slice)
      } catch {
        // Truncated mid-array: close open arrays/objects conservatively
        let repaired = slice.replace(/,\s*$/, '')
        const opens = (repaired.match(/\[/g) || []).length
        const closes = (repaired.match(/\]/g) || []).length
        const openObj = (repaired.match(/\{/g) || []).length
        const closeObj = (repaired.match(/\}/g) || []).length
        repaired += ']'.repeat(Math.max(0, opens - closes))
        repaired += '}'.repeat(Math.max(0, openObj - closeObj))
        repaired = repaired.replace(/,\s*([}\]])/g, '$1')
        return JSON.parse(repaired)
      }
    }
    throw new Error('Provider did not return valid JSON')
  }
}

function schemaInstruction(schema) {
  return `\n\nRespond with ONLY a valid JSON object (no markdown, no commentary) that strictly matches this JSON schema:\n${JSON.stringify(schema)}`
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

function normalizeUsage(raw, system, user, content) {
  const prompt = raw?.prompt_tokens ?? raw?.input_tokens ?? estimateTokens(`${system}\n${user}`)
  const completion = raw?.completion_tokens ?? raw?.output_tokens ?? estimateTokens(content)
  const cached = raw?.prompt_tokens_details?.cached_tokens
    ?? raw?.input_tokens_details?.cached_tokens
    ?? raw?.cache_read_input_tokens
    ?? 0
  return {
    promptTokens: Number(prompt) || 0,
    completionTokens: Number(completion) || 0,
    cachedInputTokens: Number(cached) || 0,
    totalTokens: (Number(prompt) || 0) + (Number(completion) || 0),
  }
}

/* Approximate USD per 1M tokens — used for diagnostics only */
const MODEL_PRICING = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'claude-3-5-sonnet-latest': { input: 3, output: 15 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
}

export function estimateCallCostUsd(model, usage) {
  const key = Object.keys(MODEL_PRICING).find((k) => String(model || '').includes(k)) || model
  const rates = MODEL_PRICING[key] || { input: 0.5, output: 1.5 }
  const cached = usage.cachedInputTokens || 0
  const billedInput = Math.max(0, (usage.promptTokens || 0) - cached) + cached * 0.5
  const inputCost = (billedInput / 1e6) * rates.input
  const outputCost = ((usage.completionTokens || 0) / 1e6) * rates.output
  return Math.round((inputCost + outputCost) * 1e6) / 1e6
}

/* ---------- OpenAI-compatible (OpenAI, Groq, Ollama) ---------- */
function makeOpenAICompatible({ apiKey, baseURL, model, useJsonSchema }) {
  const client = new OpenAI(baseURL ? { apiKey, baseURL, timeout: 120000 } : { apiKey, timeout: 120000 })
  return async (system, user, schemaName, schema, options = {}) => {
    const maxTokens = options.maxTokens || 8192
    const params = {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system + (useJsonSchema ? '' : schemaInstruction(schema)) },
        { role: 'user', content: user },
      ],
    }
    if (useJsonSchema) {
      params.response_format = {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      }
    } else {
      params.response_format = { type: 'json_object' }
    }
    const res = await client.chat.completions.create(params)
    const content = res.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response')
    return {
      result: extractJson(content),
      usage: normalizeUsage(res.usage, system, user, content),
    }
  }
}

/* ---------- Anthropic Claude ---------- */
function makeClaude({ apiKey, model }) {
  const client = new Anthropic({ apiKey })
  return async (system, user, _schemaName, schema, options = {}) => {
    const res = await client.messages.create({
      model,
      max_tokens: options.maxTokens || 4096,
      temperature: 0.2,
      system: system + schemaInstruction(schema),
      messages: [{ role: 'user', content: user }],
    })
    const text = res.content?.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (!text) throw new Error('Empty response')
    return {
      result: extractJson(text),
      usage: normalizeUsage(res.usage, system, user, text),
    }
  }
}

/* ---------- Google Gemini ---------- */
function makeGemini({ apiKey, model }) {
  const genAI = new GoogleGenerativeAI(apiKey)
  return async (system, user, _schemaName, schema, options = {}) => {
    const gModel = genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: options.maxTokens || 4096,
      },
    })
    const prompt = `${system}${schemaInstruction(schema)}\n\n${user}`
    const res = await gModel.generateContent(prompt)
    const text = res.response.text()
    if (!text) throw new Error('Empty response')
    const meta = res.response.usageMetadata || {}
    return {
      result: extractJson(text),
      usage: normalizeUsage({
        prompt_tokens: meta.promptTokenCount,
        completion_tokens: meta.candidatesTokenCount,
      }, system, user, text),
    }
  }
}

/* ---------- Provider registry ---------- */
function buildProviders() {
  const providers = {}

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    providers.openai = {
      label: 'OpenAI (ChatGPT)',
      model,
      run: makeOpenAICompatible({
        apiKey: process.env.OPENAI_API_KEY,
        model,
        useJsonSchema: true,
      }),
    }
  }

  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    providers.groq = {
      label: 'Groq',
      model,
      run: makeOpenAICompatible({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        model,
        useJsonSchema: false,
      }),
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest'
    providers.claude = {
      label: 'Anthropic Claude',
      model,
      run: makeClaude({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model,
      }),
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
    providers.gemini = {
      label: 'Google Gemini',
      model,
      run: makeGemini({
        apiKey: process.env.GEMINI_API_KEY,
        model,
      }),
    }
  }

  if (process.env.OLLAMA_API_KEY) {
    const model = process.env.OLLAMA_MODEL || 'gpt-oss:20b'
    providers.ollama = {
      label: 'Ollama',
      model,
      run: makeOpenAICompatible({
        apiKey: process.env.OLLAMA_API_KEY,
        baseURL: process.env.OLLAMA_BASE_URL || 'https://ollama.com/v1',
        model,
        useJsonSchema: false,
      }),
    }
  }

  return providers
}

let providersCache = null
function getProviders() {
  if (!providersCache) providersCache = buildProviders()
  return providersCache
}

function getOrder() {
  const raw = process.env.AI_PROVIDER_ORDER || 'openai,groq,claude,gemini,ollama'
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

/** Per-async-context usage log for score reports / diagnostics */
let usageLog = null

export function beginAiUsageTracking() {
  usageLog = []
  return usageLog
}

export function endAiUsageTracking() {
  const log = usageLog || []
  usageLog = null
  const byProvider = {}
  let totalPrompt = 0
  let totalCompletion = 0
  let totalCached = 0
  let totalCost = 0
  for (const entry of log) {
    const key = `${entry.provider}::${entry.model}`
    if (!byProvider[key]) {
      byProvider[key] = {
        provider: entry.provider,
        model: entry.model,
        calls: 0,
        tasks: [],
        promptTokens: 0,
        completionTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
      }
    }
    byProvider[key].calls += 1
    byProvider[key].tasks.push(entry.task)
    byProvider[key].promptTokens += entry.promptTokens || 0
    byProvider[key].completionTokens += entry.completionTokens || 0
    byProvider[key].cachedInputTokens += entry.cachedInputTokens || 0
    byProvider[key].costUsd += entry.costUsd || 0
    totalPrompt += entry.promptTokens || 0
    totalCompletion += entry.completionTokens || 0
    totalCached += entry.cachedInputTokens || 0
    totalCost += entry.costUsd || 0
  }
  return {
    calls: log,
    summary: Object.values(byProvider),
    primaryProvider: log[0]?.provider || null,
    primaryModel: log[0]?.model || null,
    totals: {
      llmCalls: log.length,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      cachedInputTokens: totalCached,
      costUsd: Math.round(totalCost * 1e6) / 1e6,
    },
  }
}

/**
 * Run a structured JSON completion, trying each configured provider in order
 * until one succeeds. Throws only if all providers fail.
 *
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {string[]} [options.preferProviders] — try these first when configured (e.g. ['groq'])
 */
export async function structuredJSON(system, user, schemaName, schema, options = {}) {
  const providers = getProviders()
  const prefer = (options.preferProviders || [])
    .map((s) => String(s || '').trim().toLowerCase())
    .filter((name) => providers[name])
  const rest = getOrder().filter((name) => providers[name] && !prefer.includes(name))
  const order = [...prefer, ...rest]

  if (order.length === 0) {
    throw new Error('No AI provider configured. Add an API key (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OLLAMA_API_KEY) to your .env file.')
  }

  const errors = []
  for (const name of order) {
    const callStarted = Date.now()
    try {
      const raw = await providers[name].run(system, user, schemaName, schema, options)
      const durationMs = Date.now() - callStarted
      const usage = raw.usage || normalizeUsage(null, system, user, '')
      const costUsd = estimateCallCostUsd(providers[name].model, usage)
      const info = {
        provider: providers[name].label,
        model: providers[name].model,
        task: schemaName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        durationMs,
        costUsd,
      }
      if (usageLog) usageLog.push(info)
      return { result: raw.result, ...info }
    } catch (err) {
      console.warn(`[AI] ${providers[name].label} failed (${Date.now() - callStarted}ms): ${err.message}`)
      errors.push(`${providers[name].label}: ${err.message}`)
    }
  }

  throw new Error(`All AI providers failed. ${errors.join(' | ')}`)
}

export function getConfiguredProviders() {
  const providers = getProviders()
  return getOrder().filter((name) => providers[name]).map((name) => ({
    label: providers[name].label,
    model: providers[name].model,
  }))
}

export function getScoringEngineInfo() {
  return {
    name: 'JoBPilot Hybrid ATS Scorer',
    version: '4.0',
    method: 'Local 40/40/20 + Groq/Ollama LLM JD-match (atsFriendly / readability / attractiveness)',
    note: 'Final displayed score merges deterministic coverage with LLM JD-selection scoring (Groq/Ollama preferred).',
    categories: {
      skills: 24,
      keywords: 16,
      experience: 40,
      format: 20,
    },
    pillars: {
      keywordAndSkills: 40,
      experienceAndImpact: 40,
      formatAndReadability: 20,
    },
  }
}
