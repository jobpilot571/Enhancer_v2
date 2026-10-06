const CURRENT_GOOGLE_CLIENT_ID =
  '273668616005-mfd4k3uftj9nhmcbrrbhg2v6eqqfrq8c.apps.googleusercontent.com'
const DELETED_GOOGLE_CLIENT_ID =
  '273668616005-r2g0h1gp0oj9tudrbdhl03c1o35ue0lu.apps.googleusercontent.com'

export function getGoogleClientId() {
  const configured = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  if (!configured || configured === DELETED_GOOGLE_CLIENT_ID) return CURRENT_GOOGLE_CLIENT_ID
  return configured
}

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
  if (!getGoogleClientId()) return false
  if (!isLocalDevHost()) return true
  const flag = String(import.meta.env.VITE_GOOGLE_LOCAL || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}
