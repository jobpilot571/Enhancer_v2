/** Allow only same-origin relative paths (open-redirect safe). */
export function safeNextPath(raw, fallback = '/') {
  if (!raw || typeof raw !== 'string') return fallback
  const value = raw.trim()
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('://')) return fallback
  return value
}
