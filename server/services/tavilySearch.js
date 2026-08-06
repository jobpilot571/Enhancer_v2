/**
 * Minimal Tavily Search client (no SDK).
 * Docs: https://docs.tavily.com — POST https://api.tavily.com/search
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

export function isTavilyConfigured() {
  return Boolean(String(process.env.TAVILY_API_KEY || '').trim())
}

/**
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults]
 * @param {string} [options.searchDepth] basic | advanced | fast | ultra-fast
 * @returns {Promise<{ results: Array<{ title: string, url: string, content: string }>, query: string }>}
 */
export async function tavilySearch(query, options = {}) {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim()
  if (!apiKey) {
    const err = new Error('TAVILY_API_KEY is not configured')
    err.code = 'TAVILY_NOT_CONFIGURED'
    throw err
  }

  const q = String(query || '').trim()
  if (!q) {
    return { results: [], query: '' }
  }

  const body = {
    api_key: apiKey,
    query: q,
    search_depth: options.searchDepth || 'basic',
    max_results: Math.min(8, Math.max(1, Number(options.maxResults) || 5)),
    include_answer: false,
    include_images: false,
    include_raw_content: false,
  }

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data?.detail || data?.error || data?.message || detail
    } catch { /* ignore */ }
    const err = new Error(`Tavily search failed (${res.status}): ${detail}`)
    err.status = res.status
    throw err
  }

  const data = await res.json()
  const results = (Array.isArray(data?.results) ? data.results : [])
    .map((r) => ({
      title: String(r?.title || '').trim(),
      url: String(r?.url || '').trim(),
      content: String(r?.content || r?.raw_content || '').trim(),
    }))
    .filter((r) => r.url)

  return { results, query: q }
}
