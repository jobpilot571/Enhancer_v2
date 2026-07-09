import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

/*
 * Multi-provider AI layer with automatic fallback.
 * Order is controlled by AI_PROVIDER_ORDER (comma-separated).
 * Each provider returns parsed JSON matching the requested schema.
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
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('Provider did not return valid JSON')
  }
}

function schemaInstruction(schema) {
  return `\n\nRespond with ONLY a valid JSON object (no markdown, no commentary) that strictly matches this JSON schema:\n${JSON.stringify(schema)}`
}

/* ---------- OpenAI-compatible (OpenAI, Groq, Ollama) ---------- */
function makeOpenAICompatible({ apiKey, baseURL, model, useJsonSchema }) {
  const client = new OpenAI(baseURL ? { apiKey, baseURL, timeout: 120000 } : { apiKey, timeout: 120000 })
  return async (system, user, schemaName, schema) => {
    const params = {
      model,
      temperature: 0.2,
      // Avoid truncated JSON bodies on large resume/plan responses
      max_tokens: 8192,
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
    return extractJson(content)
  }
}

/* ---------- Anthropic Claude ---------- */
function makeClaude({ apiKey, model }) {
  const client = new Anthropic({ apiKey })
  return async (system, user, _schemaName, schema) => {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: system + schemaInstruction(schema),
      messages: [{ role: 'user', content: user }],
    })
    const text = res.content?.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (!text) throw new Error('Empty response')
    return extractJson(text)
  }
}

/* ---------- Google Gemini ---------- */
function makeGemini({ apiKey, model }) {
  const genAI = new GoogleGenerativeAI(apiKey)
  return async (system, user, _schemaName, schema) => {
    const gModel = genAI.getGenerativeModel({
      model,
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    })
    const prompt = `${system}${schemaInstruction(schema)}\n\n${user}`
    const res = await gModel.generateContent(prompt)
    const text = res.response.text()
    if (!text) throw new Error('Empty response')
    return extractJson(text)
  }
}

/* ---------- Provider registry ---------- */
function buildProviders() {
  const providers = {}

  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      label: 'OpenAI',
      run: makeOpenAICompatible({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        useJsonSchema: true,
      }),
    }
  }

  if (process.env.GROQ_API_KEY) {
    providers.groq = {
      label: 'Groq',
      run: makeOpenAICompatible({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        useJsonSchema: false,
      }),
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.claude = {
      label: 'Claude',
      run: makeClaude({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest',
      }),
    }
  }

  if (process.env.GEMINI_API_KEY) {
    providers.gemini = {
      label: 'Gemini',
      run: makeGemini({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      }),
    }
  }

  if (process.env.OLLAMA_API_KEY) {
    providers.ollama = {
      label: 'Ollama',
      run: makeOpenAICompatible({
        apiKey: process.env.OLLAMA_API_KEY,
        baseURL: process.env.OLLAMA_BASE_URL || 'https://ollama.com/v1',
        model: process.env.OLLAMA_MODEL || 'gpt-oss:20b',
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
 * Run a structured JSON completion, trying each configured provider in order
 * until one succeeds. Throws only if all providers fail.
 */
export async function structuredJSON(system, user, schemaName, schema) {
  const providers = getProviders()
  const order = getOrder().filter((name) => providers[name])

  if (order.length === 0) {
    throw new Error('No AI provider configured. Add an API key (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OLLAMA_API_KEY) to your .env file.')
  }

  const errors = []
  for (const name of order) {
    try {
      const result = await providers[name].run(system, user, schemaName, schema)
      return { result, provider: providers[name].label }
    } catch (err) {
      console.warn(`[AI] ${providers[name].label} failed: ${err.message}`)
      errors.push(`${providers[name].label}: ${err.message}`)
    }
  }

  throw new Error(`All AI providers failed. ${errors.join(' | ')}`)
}

export function getConfiguredProviders() {
  const providers = getProviders()
  return getOrder().filter((name) => providers[name]).map((name) => providers[name].label)
}
