import { randomUUID } from 'crypto'

/** @type {Map<string, object>} */
const jobs = new Map()

export function createBuildJob(sessionId) {
  const jobId = randomUUID()
  const job = {
    jobId,
    sessionId,
    status: 'processing',
    step: 'generating_content',
    error: null,
    result: null,
    createdAt: Date.now(),
  }
  jobs.set(jobId, job)
  return job
}

export function getBuildJob(jobId) {
  return jobs.get(jobId) || null
}

export function updateBuildJob(jobId, updates) {
  const job = jobs.get(jobId)
  if (!job) return null
  Object.assign(job, updates)
  return job
}

export const BUILD_STEPS = [
  'generating_content',
  'building_docx',
  'preparing_preview',
]
