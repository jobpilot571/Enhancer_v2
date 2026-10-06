/**
 * Verify a Google Identity Services ID token.
 * Requires GOOGLE_CLIENT_ID (same as VITE_GOOGLE_CLIENT_ID).
 */

const CURRENT_GOOGLE_CLIENT_ID =
  '273668616005-mfd4k3uftj9nhmcbrrbhg2v6eqqfrq8c.apps.googleusercontent.com'
const DELETED_GOOGLE_CLIENT_ID =
  '273668616005-r2g0h1gp0oj9tudrbdhl03c1o35ue0lu.apps.googleusercontent.com'

function getGoogleClientId() {
  const configured = (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  if (!configured || configured === DELETED_GOOGLE_CLIENT_ID) return CURRENT_GOOGLE_CLIENT_ID
  return configured
}

export function isGoogleAuthConfigured() {
  return Boolean(getGoogleClientId())
}

export async function verifyGoogleIdToken(idToken) {
  const clientId = getGoogleClientId()
  if (!clientId) {
    const err = new Error('Google sign-in is not configured on the server.')
    err.status = 503
    throw err
  }
  if (!idToken) {
    const err = new Error('Google credential is required.')
    err.status = 400
    throw err
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  )
  if (!res.ok) {
    const err = new Error('Invalid or expired Google credential.')
    err.status = 401
    throw err
  }

  const payload = await res.json()
  if (payload.aud !== clientId) {
    const err = new Error('Google credential audience mismatch.')
    err.status = 401
    throw err
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    const err = new Error('Google email is not verified.')
    err.status = 401
    throw err
  }
  if (!payload.email || !payload.sub) {
    const err = new Error('Google credential is missing email.')
    err.status = 401
    throw err
  }

  return {
    googleId: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: String(payload.name || payload.email.split('@')[0]).trim(),
    picture: payload.picture || null,
  }
}
