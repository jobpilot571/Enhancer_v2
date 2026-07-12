import { getSessionUser } from '../store/userStore.js'
import { getUserUsage, consumeUsage } from '../store/usageStore.js'

export function getBearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

export function requireUser(req, res, next) {
  const token = getBearerToken(req)
  const user = getSessionUser(token)
  if (!user) {
    return res.status(401).json({ error: 'Sign in to use this service.', code: 'AUTH_REQUIRED' })
  }
  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Verify your email before using this service.',
      needsVerification: true,
      code: 'NEEDS_VERIFICATION',
      email: user.email,
    })
  }
  req.user = user
  req.userToken = token
  next()
}

export function optionalUser(req, _res, next) {
  const token = getBearerToken(req)
  req.user = getSessionUser(token)
  req.userToken = token || null
  next()
}

/** After requireUser — rejects if the plan quota for this key is exhausted (does not consume). */
export function checkUsage(usageKey) {
  return (req, res, next) => {
    try {
      const plan = req.user.plan || 'free'
      const usage = getUserUsage(req.user.id, plan)
      const remaining = usage.remaining[usageKey]
      if (remaining !== null && remaining <= 0) {
        const labels = {
          enhancer: 'resume enhancements',
          builder: 'resume builds',
          jdBuilder: 'JD-tailored resumes',
        }
        const message =
          usageKey === 'enhancer'
            ? `Free plan allows only ${usage.limits.enhancer} resume enhancements this month. You have used all ${usage.limits.enhancer}. Upgrade your plan for more.`
            : `Free plan limit reached (${usage.limits[usageKey]} ${labels[usageKey]} this month). Upgrade your plan for more.`
        return res.status(403).json({
          error: message,
          code: 'PLAN_LIMIT',
          usage,
        })
      }
      req.usagePreview = usage
      next()
    } catch (err) {
      next(err)
    }
  }
}

export { consumeUsage }
