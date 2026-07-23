/** True when the app is opened on a local Vite host. */
export function isLocalDevHost() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/**
 * Google GIS fails with origin_mismatch on local until Console origins are added.
 * Hide Google on local by default; set VITE_GOOGLE_LOCAL=true after configuring Console.
 */
export function shouldShowGoogleAuth() {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return false
  if (!isLocalDevHost()) return true
  const flag = String(import.meta.env.VITE_GOOGLE_LOCAL || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}
