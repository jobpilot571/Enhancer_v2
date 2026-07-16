import { FREE_PLAN } from './plans.js'
import {
  isComplimentaryEmail,
  getComplimentaryPlanType,
  normalizePlanType,
  planTypeLabel,
} from '../store/complimentaryStore.js'

/**
 * Resolve the plan used for quotas.
 * Complimentary emails (admin whitelist) get Professional unlimited access.
 */
export function resolveEffectivePlan(user) {
  if (!user) return FREE_PLAN
  if (isComplimentaryEmail(user.email) || user.complimentary) return 'professional'
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

  const planType = complimentaryAccess
    ? normalizePlanType(
      user.complimentaryPlanType || getComplimentaryPlanType(user.email) || 'friend',
    )
    : null

  return {
    ...user,
    plan,
    complimentaryAccess: complimentaryAccess || storedPlan === 'professional',
    complimentaryPlanType: planType,
    planLabel: complimentaryAccess
      ? `${planTypeLabel(planType)} plan`
      : (plan === 'free' ? 'Free plan' : `${String(plan).charAt(0).toUpperCase()}${String(plan).slice(1)} plan`),
  }
}
