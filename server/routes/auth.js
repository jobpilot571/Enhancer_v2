import { Router } from 'express'
import { sendVerificationOtp, isEmailConfigured } from '../services/email.js'
import { isGoogleAuthConfigured, verifyGoogleIdToken } from '../services/googleAuth.js'
import { getUserUsage } from '../store/usageStore.js'
import {
  createUser,
  updateUnverifiedSignup,
  authenticateUser,
  createOtpChallenge,
  verifyOtpChallenge,
  markEmailVerified,
  createSession,
  revokeSession,
  getSessionUser,
  findUserByEmail,
  upsertGoogleUser,
  publicUser,
} from '../store/userStore.js'
import { getBearerToken } from '../middleware/userAuth.js'

const router = Router()

function withUsage(user) {
  if (!user) return null
  const usage = getUserUsage(user.id, user.plan || 'free')
  return { ...user, usage }
}

function sessionResponse(userRecord, extra = {}) {
  const token = createSession(userRecord.id)
  return {
    token,
    user: withUsage(publicUser(userRecord)),
    needsVerification: false,
    ...extra,
  }
}

async function issueOtpAndRespond(res, user, { created = false } = {}) {
  const { email, code, expiresInSeconds } = createOtpChallenge(user.email)
  const emailConfigured = isEmailConfigured()
  let delivery
  let deliveryError = ''

  try {
    delivery = await sendVerificationOtp({
      to: email,
      name: user.name,
      code,
      expiresInSeconds,
    })
  } catch (err) {
    console.error('[auth:otp] Email send failed, falling back to console:', err.message)
    console.log(`[auth:otp] Fallback code for ${email}: ${code} (expires in ${expiresInSeconds}s)`)
    delivery = { delivered: false, mode: 'console-fallback' }
    deliveryError = String(err.message || 'Email delivery failed')
  }

  let message
  if (delivery.delivered) {
    message = 'We sent a 6-digit verification code to your email.'
  } else if (!emailConfigured) {
    message = 'Email delivery is not configured yet. Use the on-screen code below (also printed in the server console).'
  } else if (/invalid|unauthorized|401/i.test(deliveryError)) {
    message = 'Email API key is invalid. Check RESEND_API_KEY in .env (paste the full key from resend.com/api-keys), then restart the server.'
  } else if (/domain|from|not allowed|restricted/i.test(deliveryError)) {
    message = `Email could not be sent (${deliveryError}). With onboarding@resend.dev you can only email your Resend account address, or verify your own domain.`
  } else {
    message = deliveryError
      ? `We could not deliver the email: ${deliveryError}`
      : 'We could not deliver the email. Check spam, or try Resend again.'
  }

  const payload = {
    needsVerification: true,
    email,
    message,
    emailConfigured,
    delivered: Boolean(delivery.delivered),
    expiresInSeconds,
  }

  // Expose OTP on-screen only when email is not configured (local/dev).
  // Never leak codes in production when Resend is configured.
  if (!emailConfigured && !delivery.delivered) {
    payload.previewCode = code
    console.log(`[auth:otp] Preview code for ${email}: ${code}`)
  } else if (!delivery.delivered) {
    console.log(`[auth:otp] Delivery failed for ${email}: ${deliveryError}`)
  }

  return res.status(created ? 201 : 200).json(payload)
}

router.get('/status', (_req, res) => {
  res.json({
    emailConfigured: isEmailConfigured(),
    googleConfigured: isGoogleAuthConfigured(),
    signupEnabled: true,
  })
})

router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body || {}
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' })
    }

    const existing = findUserByEmail(email)
    if (existing?.emailVerifiedAt) {
      return res.status(409).json({
        error: 'An account with this email already exists. Sign in instead.',
        code: 'ALREADY_REGISTERED',
        email: existing.email,
      })
    }

    const user = existing
      ? updateUnverifiedSignup(email, { name, password })
      : createUser({ name, email, password })

    return await issueOtpAndRespond(res, user, { created: !existing })
  } catch (err) {
    next(err)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {}
    const user = authenticateUser(email, password)

    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        error: 'Please verify your email with the code we sent before signing in.',
        needsVerification: true,
        code: 'NEEDS_VERIFICATION',
        email: user.email,
      })
    }

    return res.json(sessionResponse(user))
  } catch (err) {
    if (err.code === 'NOT_REGISTERED') {
      return res.status(404).json({
        error: err.message,
        code: 'NOT_REGISTERED',
        email: err.email,
      })
    }
    next(err)
  }
})

router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body || {}
    const profile = await verifyGoogleIdToken(credential)
    const { user: publicProfile, created } = upsertGoogleUser(profile)
    const user = findUserByEmail(publicProfile.email)

    // First-time or unverified Google accounts must confirm email OTP
    if (!user.emailVerifiedAt) {
      return await issueOtpAndRespond(res, publicUser(user), { created })
    }

    return res.json(sessionResponse(user))
  } catch (err) {
    next(err)
  }
})

router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body || {}
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required.' })
    }

    const existing = findUserByEmail(email)
    if (!existing) {
      return res.status(404).json({
        error: 'No account found with this email. Please sign up first.',
        code: 'NOT_REGISTERED',
        email,
      })
    }

    verifyOtpChallenge(email, code)
    const verified = markEmailVerified(email)
    const full = findUserByEmail(email)
    return res.json({
      ...sessionResponse(full),
      user: withUsage(verified),
      message: 'Email verified. You are on the Free plan with 10 resume enhancements per month.',
    })
  } catch (err) {
    next(err)
  }
})

router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body || {}
    const user = findUserByEmail(email)
    if (!user) {
      return res.status(404).json({
        error: 'No account found with this email. Please sign up first.',
        code: 'NOT_REGISTERED',
        email,
      })
    }
    if (user.emailVerifiedAt) {
      return res.status(400).json({ error: 'Email is already verified. You can sign in.' })
    }
    return await issueOtpAndRespond(res, publicUser(user))
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res) => {
  const token = getBearerToken(req)
  revokeSession(token)
  res.status(204).end()
})

router.get('/me', (req, res) => {
  const token = getBearerToken(req)
  const user = getSessionUser(token)
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized — please sign in.' })
  }
  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Email not verified.',
      needsVerification: true,
      code: 'NEEDS_VERIFICATION',
      email: user.email,
    })
  }
  res.json({ user: withUsage(user) })
})

export default router
