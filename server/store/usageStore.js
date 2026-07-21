import { currentUsageMonth, getPlanLimits, FREE_PLAN } from '../services/plans.js'
import { getUsageData, setUsageData } from './durableUserData.js'

function emptyMonth() {
  return { enhancer: 0, builder: 0, jdBuilder: 0 }
}

function readUsage() {
  return getUsageData()
}

function saveUsage(data) {
  setUsageData(data)
}

export function getUserUsage(userId, planId = FREE_PLAN) {
  const month = currentUsageMonth()
  const data = readUsage()
  const key = `${userId}:${month}`
  const used = { ...emptyMonth(), ...(data.usage[key] || {}) }
  const limits = getPlanLimits(planId)

  // JSON cannot represent Infinity — use null so clients treat it as unlimited
  const jsonLimit = (n) => (Number.isFinite(n) ? n : null)

  return {
    month,
    plan: planId,
    used,
    limits: {
      enhancer: jsonLimit(limits.enhancer),
      builder: jsonLimit(limits.builder),
      jdBuilder: jsonLimit(limits.jdBuilder),
    },
    remaining: {
      enhancer: Number.isFinite(limits.enhancer) ? Math.max(0, limits.enhancer - used.enhancer) : null,
      builder: Number.isFinite(limits.builder) ? Math.max(0, limits.builder - used.builder) : null,
      jdBuilder: Number.isFinite(limits.jdBuilder) ? Math.max(0, limits.jdBuilder - used.jdBuilder) : null,
    },
  }
}

/**
 * Atomically check + consume one unit of a usage key.
 * @param {'enhancer'|'builder'|'jdBuilder'} usageKey
 */
export function consumeUsage(userId, planId, usageKey) {
  const limits = getPlanLimits(planId)
  const limit = limits[usageKey]
  if (limit === undefined) {
    const err = new Error('Unknown usage type.')
    err.status = 400
    throw err
  }

  const month = currentUsageMonth()
  const data = readUsage()
  const key = `${userId}:${month}`
  const used = { ...emptyMonth(), ...(data.usage[key] || {}) }

  if (Number.isFinite(limit) && used[usageKey] >= limit) {
    const err = new Error(
      usageKey === 'enhancer'
        ? 'You have used all free enhancements for this month.'
        : usageKey === 'builder'
          ? 'You have used all free resume builds for this month.'
          : 'You have used all free JD builds for this month.',
    )
    err.status = 403
    err.code = 'USAGE_LIMIT'
    throw err
  }

  used[usageKey] = (used[usageKey] || 0) + 1
  data.usage[key] = used
  saveUsage(data)

  return getUserUsage(userId, planId)
}
