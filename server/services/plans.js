/** Plan entitlements. New signups start on `free`. */

export const FREE_PLAN = 'free'

export const PLAN_LIMITS = {
  free: {
    enhancer: 10,
    builder: 5,
    jdBuilder: 5,
  },
  professional: {
    enhancer: Infinity,
    builder: Infinity,
    jdBuilder: Infinity,
  },
  enterprise: {
    enhancer: Infinity,
    builder: Infinity,
    jdBuilder: Infinity,
  },
}

export const USAGE_KEYS = ['enhancer', 'builder', 'jdBuilder']

export function getPlanLimits(planId = FREE_PLAN) {
  return PLAN_LIMITS[planId] || PLAN_LIMITS[FREE_PLAN]
}

export function currentUsageMonth(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
