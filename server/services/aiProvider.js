import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  calculateCallCosts,
  estimateCallCostUsd,
  finalizeAiServiceCost,
  getAiCostContext,
  providerDisplayName,
  recordAiRequest,
  runWithAiCostContext,
} from './aiCostTracking.js'

export { estimateCallCostUsd, calculateCallCosts, runWithAiCostContext }

/*
 * Multi-provider AI layer with automatic fallback.
 * Order is controlled by AI_PROVIDER_ORDER (comma-separated).
 * Each provider returns { result, usage } where usage has token counts.
 * Every provider attempt is recorded by the centralized AI cost tracker.
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

/**
 * Normalize provider usage. Marks usageSource as 'actual' when the API returned
 * token counts, otherwise 'estimated' from character length.
 */
function normalizeUsage(raw, system, user, content) {
  const hasPrompt = raw?.prompt_tokens != null || raw?.input_tokens != null
  const hasCompletion = raw?.completion_tokens != null || raw?.output_tokens != null
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
    usageSource: (hasPrompt || hasCompletion) ? 'actual' : 'estimated',
  }
}

function attachUsageToError(err, usage) {
  if (err && usage) {
    try {
      err.aiUsage = usage
    } catch {
      // ignore non-extensible errors
    }
  }
  return err
}

function usageFromError(err) {
  const u = err?.aiUsage || err?.usage || err?.error?.usage || null
  if (!u) return null
  if (u.promptTokens != null || u.completionTokens != null) {
    return {
      promptTokens: Number(u.promptTokens) || 0,
      completionTokens: Number(u.completionTokens) || 0,
      cachedInputTokens: Number(u.cachedInputTokens) || 0,
      totalTokens: Number(u.totalTokens) || ((Number(u.promptTokens) || 0) + (Number(u.completionTokens) || 0)),
      usageSource: u.usageSource || 'actual',
    }
  }
  return normalizeUsage(u, '', '', '')
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
    const usage = normalizeUsage(res.usage, system, user, content)
    try {
      return { result: extractJson(content), usage }
    } catch (err) {
      throw attachUsageToError(err, usage)
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
    const usage = normalizeUsage(res.usage, system, user, text)
    try {
      return { result: extractJson(text), usage }
    } catch (err) {
      throw attachUsageToError(err, usage)
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
    const usage = normalizeUsage({
      prompt_tokens: meta.promptTokenCount,
      completion_tokens: meta.candidatesTokenCount,
    }, system, user, text)
    try {
      return { result: extractJson(text), usage }
    } catch (err) {
      throw attachUsageToError(err, usage)
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
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5'
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

/**
 * Begin collecting AI usage for the current async context.
 * Prefer runWithAiCostContext(...) at the job/route boundary; this remains for
 * enhanceWorker compatibility and clears the in-context event list.
 */
export function beginAiUsageTracking() {
  const ctx = getAiCostContext()
  if (ctx) {
    ctx.events = []
    return ctx.events
  }
  return []
}

/**
 * Finalize and return AI usage collected in the active cost context.
 * @param {{ status?: string, persist?: boolean }} [options]
 */
export function endAiUsageTracking(options = {}) {
  return finalizeAiServiceCost({
    status: options.status || 'completed',
    persist: options.persist !== false,
  })
}

function trackProviderAttempt({
  providerKey,
  providerLabel,
  model,
  task,
  featureName,
  usage,
  durationMs,
  status,
  errorMessage = null,
}) {
  const hasTokens = Boolean(
    usage
    && ((usage.promptTokens || 0) + (usage.completionTokens || 0) > 0),
  )
  // Charge whenever tokens were consumed — including failed post-processing
  const costs = hasTokens
    ? calculateCallCosts(model, usage, providerLabel)
    : {
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      pricingMissing: false,
      pricingVersion: null,
      pricingEffectiveDate: null,
    }
  const event = recordAiRequest({
    providerKey,
    provider: providerDisplayName(providerKey) || providerLabel,
    model,
    task,
    featureName,
    promptTokens: usage?.promptTokens || 0,
    completionTokens: usage?.completionTokens || 0,
    cachedInputTokens: usage?.cachedInputTokens || 0,
    totalTokens: usage?.totalTokens || 0,
    inputCostUsd: costs.inputCostUsd,
    outputCostUsd: costs.outputCostUsd,
    totalCostUsd: costs.totalCostUsd,
    pricingMissing: costs.pricingMissing,
    pricingVersion: costs.pricingVersion,
    pricingEffectiveDate: costs.pricingEffectiveDate,
    processingTimeMs: durationMs,
    status,
    errorMessage,
    usageSource: usage?.usageSource || (hasTokens ? 'actual' : 'unknown'),
  })
  return {
    ...costs,
    costUsd: costs.totalCostUsd,
    requestId: event.requestId,
  }
}

/**
 * Run a structured JSON completion, trying each configured provider in order
 * until one succeeds. Throws only if all providers fail.
 *
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {string[]} [options.preferProviders] — try these first when configured (e.g. ['groq'])
 * @param {string[]} [options.providersOnly] — if set, ONLY these providers run (no fallback to others)
 */
export async function structuredJSON(system, user, schemaName, schema, options = {}) {
  const providers = getProviders()
  const only = (options.providersOnly || [])
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean)
  const prefer = (options.preferProviders || [])
    .map((s) => String(s || '').trim().toLowerCase())
    .filter((name) => providers[name])

  let order
  if (only.length) {
    order = only.filter((name) => providers[name])
    if (order.length === 0) {
      const missing = only.join(', ')
      throw new Error(
        `Required AI provider not configured for "${schemaName}": ${missing}. `
        + 'Set ANTHROPIC_API_KEY (and CLAUDE_MODEL if needed) in your .env / Render env.',
      )
    }
  } else {
    const rest = getOrder().filter((name) => providers[name] && !prefer.includes(name))
    order = [...prefer, ...rest]
  }

  if (order.length === 0) {
    throw new Error('No AI provider configured. Add an API key (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OLLAMA_API_KEY) to your .env file.')
  }

  const errors = []
  const featureName = options.featureName || null
  for (const name of order) {
    const callStarted = Date.now()
    try {
      const raw = await providers[name].run(system, user, schemaName, schema, options)
      const durationMs = Date.now() - callStarted
      const usage = raw.usage || normalizeUsage(null, system, user, '')
      const tracked = trackProviderAttempt({
        providerKey: name,
        providerLabel: providers[name].label,
        model: providers[name].model,
        task: schemaName,
        featureName,
        usage,
        durationMs,
        status: 'Success',
      })
      return {
        result: raw.result,
        provider: providers[name].label,
        model: providers[name].model,
        task: schemaName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        usageSource: usage.usageSource,
        durationMs,
        costUsd: tracked.costUsd,
        inputCostUsd: tracked.inputCostUsd,
        outputCostUsd: tracked.outputCostUsd,
        requestId: tracked.requestId,
      }
    } catch (err) {
      const durationMs = Date.now() - callStarted
      console.warn(`[AI] ${providers[name].label} failed (${durationMs}ms): ${err.message}`)
      trackProviderAttempt({
        providerKey: name,
        providerLabel: providers[name].label,
        model: providers[name].model,
        task: schemaName,
        featureName,
        usage: usageFromError(err),
        durationMs,
        status: 'Failed',
        errorMessage: err.message,
      })
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

/**
 * Vision JSON completion for layout screenshot analysis.
 * Tries OpenAI (gpt-4o-mini) then Gemini vision models.
 */
export async function visionStructuredJSON(system, userText, imageBuffer, mimeType, schemaName, schema, options = {}) {
  if (!imageBuffer?.length) {
    throw new Error('No image buffer for vision analysis')
  }
  const base64 = Buffer.from(imageBuffer).toString('base64')
  const schemaText = schemaInstruction(schema)
  const errors = []
  const featureName = options.featureName || null

  if (process.env.OPENAI_API_KEY) {
    const callStarted = Date.now()
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini'
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90000 })
      const res = await client.chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system + schemaText },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: `data:${mimeType || 'image/png'};base64,${base64}` } },
            ],
          },
        ],
      })
      const content = res.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty vision response')
      const durationMs = Date.now() - callStarted
      const usage = normalizeUsage(res.usage, system, userText, content)
      let parsed
      try {
        parsed = extractJson(content)
      } catch (err) {
        throw attachUsageToError(err, usage)
      }
      const tracked = trackProviderAttempt({
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        model,
        task: schemaName,
        featureName,
        usage,
        durationMs,
        status: 'Success',
      })
      return {
        result: parsed,
        provider: 'OpenAI',
        model,
        task: schemaName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        usageSource: usage.usageSource,
        durationMs,
        costUsd: tracked.costUsd,
        inputCostUsd: tracked.inputCostUsd,
        outputCostUsd: tracked.outputCostUsd,
        requestId: tracked.requestId,
      }
    } catch (err) {
      const durationMs = Date.now() - callStarted
      trackProviderAttempt({
        providerKey: 'openai',
        providerLabel: 'OpenAI',
        model,
        task: schemaName,
        featureName,
        usage: usageFromError(err),
        durationMs,
        status: 'Failed',
        errorMessage: err.message,
      })
      errors.push(`OpenAI Vision: ${err.message}`)
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const callStarted = Date.now()
    const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash'
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const gModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          maxOutputTokens: 800,
        },
      })
      const prompt = `${system}${schemaText}\n\n${userText}`
      const res = await gModel.generateContent([
        { text: prompt },
        { inlineData: { mimeType: mimeType || 'image/png', data: base64 } },
      ])
      const text = res.response.text()
      if (!text) throw new Error('Empty Gemini vision response')
      const durationMs = Date.now() - callStarted
      const meta = res.response.usageMetadata || {}
      const usage = normalizeUsage({
        prompt_tokens: meta.promptTokenCount,
        completion_tokens: meta.candidatesTokenCount,
      }, system, userText, text)
      let parsed
      try {
        parsed = extractJson(text)
      } catch (err) {
        throw attachUsageToError(err, usage)
      }
      const tracked = trackProviderAttempt({
        providerKey: 'gemini',
        providerLabel: 'Gemini',
        model,
        task: schemaName,
        featureName,
        usage,
        durationMs,
        status: 'Success',
      })
      return {
        result: parsed,
        provider: 'Gemini',
        model,
        task: schemaName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        usageSource: usage.usageSource,
        durationMs,
        costUsd: tracked.costUsd,
        inputCostUsd: tracked.inputCostUsd,
        outputCostUsd: tracked.outputCostUsd,
        requestId: tracked.requestId,
      }
    } catch (err) {
      const durationMs = Date.now() - callStarted
      trackProviderAttempt({
        providerKey: 'gemini',
        providerLabel: 'Gemini',
        model,
        task: schemaName,
        featureName,
        usage: usageFromError(err),
        durationMs,
        status: 'Failed',
        errorMessage: err.message,
      })
      errors.push(`Gemini Vision: ${err.message}`)
    }
  }

  throw new Error(`Vision analysis unavailable. ${errors.join(' | ') || 'Configure OPENAI_API_KEY or GEMINI_API_KEY.'}`)
}

export function getScoringEngineInfo() {
  return {
    name: 'JoBPilot ATS Score',
    version: '4.0',
    method: 'JoBPilot ATS Score',
    note: 'JoBPilot ATS Score',
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
