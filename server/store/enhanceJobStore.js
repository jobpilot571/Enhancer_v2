import { randomUUID } from 'crypto'

/** @type {Map<string, object>} */
const jobs = new Map()

export function createEnhanceJob(sessionId) {
  const jobId = randomUUID()
  const job = {
    jobId,
    sessionId,
    status: 'processing',
    step: 'analyzing_resume',
    error: null,
    result: null,
    createdAt: Date.now(),
  }
  jobs.set(jobId, job)
  return job
}

export function getEnhanceJob(jobId) {
  return jobs.get(jobId) || null
}

export function updateEnhanceJob(jobId, updates) {
  const job = jobs.get(jobId)
  if (!job) return null
  Object.assign(job, updates)
  return job
}

export const ENHANCE_STEPS = [
  'analyzing_resume',
  'parsing_jd',
  'comparing',
  'writing_plan',
  'updating_resume',
  'preparing_preview',
]
