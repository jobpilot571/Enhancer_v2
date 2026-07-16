import { FREE_PLAN } from './plans.js'
import { isComplimentaryEmail } from '../store/complimentaryStore.js'

/**
 * Resolve the plan used for quotas.
 * Complimentary emails (admin whitelist) get Professional unlimited access.
 */
export function resolveEffectivePlan(user) {
  if (!user) return FREE_PLAN
  if (isComplimentaryEmail(user.email)) return 'professional'
  return user.plan || FREE_PLAN
}

/** Attach effective plan + complimentary flag to a public user object. */
export function withEntitlements(user) {
  if (!user) return null
  const complimentaryAccess =
    isComplimentaryEmail(user.email) || Boolean(user.complimentary)
  const storedPlan = user.plan || FREE_PLAN
  const plan = complimentaryAccess
    ? 'professional'
    : (storedPlan === 'professional' || storedPlan === 'enterprise' ? storedPlan : FREE_PLAN)
  return {
    ...user,
    plan,
    complimentaryAccess: complimentaryAccess || storedPlan === 'professional',
  }
}
