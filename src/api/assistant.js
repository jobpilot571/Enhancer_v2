import { getAuthToken } from './auth'

const API_BASE = (
  import.meta.env.VITE_ASSISTANT_API_BASE
  || import.meta.env.VITE_API_BASE?.replace(/\/enhancer$/, '/assistant')
  || '/api/assistant'
).replace(/\/$/, '')

function authHeaders(extra = {}) {
  const headers = { ...extra }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * Stream site-wide assistant chat with live status events.
 * onEvent({ type, ... })
 */
export async function streamAssistantChat({
  message,
  pathname,
  workspace,
  thread,
  files = [],
  onEvent,
  signal,
}) {
  const form = new FormData()
  form.append('message', message || '')
  form.append('pathname', pathname || '/')
  form.append('workspace', JSON.stringify(workspace || {}))
  form.append('thread', JSON.stringify((thread || []).slice(-10).map((m) => ({
    role: m.role,
    text: String(m.text || '').slice(0, 600),
  }))))
  for (const file of files) {
    if (file) form.append('files', file)
  }

  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal,
  })

  if (!res.ok) {
    let errMsg = res.statusText || 'Assistant request failed'
    try {
      const data = await res.json()
      errMsg = data.error || errMsg
    } catch { /* ignore */ }
    throw new Error(errMsg)
  }

  if (!res.body) {
    const data = await res.json()
    onEvent?.({ type: 'reply', ...data })
    onEvent?.({ type: 'done' })
    return data
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const chunk of parts) {
      const lines = chunk.split('\n')
      let event = 'message'
      let dataLine = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) dataLine += line.slice(5).trim()
      }
      if (!dataLine) continue
      let data = {}
      try { data = JSON.parse(dataLine) } catch { data = { text: dataLine } }
      if (event === 'reply') finalPayload = data
      onEvent?.({ type: event, ...data })
    }
  }

  onEvent?.({ type: 'done' })
  return finalPayload
}
