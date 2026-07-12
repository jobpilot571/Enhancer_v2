import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { currentUsageMonth, getPlanLimits, FREE_PLAN } from '../services/plans.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../user-data')
const USAGE_PATH = path.join(DATA_DIR, 'usage.json')

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readUsage() {
  ensureDirs()
  if (!fs.existsSync(USAGE_PATH)) {
    const empty = { usage: {} }
    fs.writeFileSync(USAGE_PATH, JSON.stringify(empty, null, 2))
    return empty
  }
  try {
    return JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'))
  } catch {
    return { usage: {} }
  }
}

function saveUsage(data) {
  ensureDirs()
  fs.writeFileSync(USAGE_PATH, JSON.stringify(data, null, 2))
}

function emptyMonth() {
  return { enhancer: 0, builder: 0, jdBuilder: 0 }
}

export function getUserUsage(userId, planId = FREE_PLAN) {
  const month = currentUsageMonth()
  const data = readUsage()
  const key = `${userId}:${month}`
  const used = { ...emptyMonth(), ...(data.usage[key] || {}) }
  const limits = getPlanLimits(planId)

  return {
    month,
    plan: planId,
    used,
    limits: {
      enhancer: limits.enhancer,
      builder: limits.builder,
      jdBuilder: limits.jdBuilder,
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
    const labels = {
      enhancer: 'resume enhancements',
      builder: 'resume builds',
      jdBuilder: 'JD-tailored resumes',
    }
    const err = new Error(
      usageKey === 'enhancer'
        ? `Free plan allows only ${limit} resume enhancements this month. You have used all ${limit}. Upgrade your plan for more.`
        : `Free plan limit reached (${limit} ${labels[usageKey]} this month). Upgrade your plan for more.`
    )
    err.status = 403
    err.code = 'PLAN_LIMIT'
    err.usage = getUserUsage(userId, planId)
    throw err
  }

  used[usageKey] += 1
  data.usage[key] = used
  saveUsage(data)
  return getUserUsage(userId, planId)
}
