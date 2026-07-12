/**
 * Verify a Google Identity Services ID token.
 * Requires GOOGLE_CLIENT_ID (same as VITE_GOOGLE_CLIENT_ID).
 */

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim())
}

function getGoogleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim()
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
