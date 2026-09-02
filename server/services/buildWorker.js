import { getSession, updateSession, setGeneratedDocx } from '../store/sessionStore.js'
import { updateBuildJob } from '../store/buildJobStore.js'
import { generateResumeFromForm } from './openaiService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'
import { beginAiUsageTracking, endAiUsageTracking, runWithAiCostContext } from './aiProvider.js'
import { AI_SERVICES } from './aiCostTracking.js'

function log(jobId, message) {
  console.log(`[build:${jobId.slice(0, 8)}] ${message}`)
}

function formatDates(start, end) {
  const s = String(start || '').trim()
  const e = String(end || '').trim() || 'Present'
  if (!s) return e
  return `${s} – ${e}`
}

function formatCityState(company) {
  return [company.city, company.state].filter(Boolean).join(', ')
}

const BULLET_RANGES = [
  { min: 12, max: 14, def: 13 },
  { min: 11, max: 13, def: 12 },
  { min: 10, max: 12, def: 11 },
  { min: 9, max: 11, def: 10 },
  { min: 7, max: 9, def: 8 },
]

function bulletsForCompany(company, index, formData) {
  const range = BULLET_RANGES[index] || { min: 7, max: 12, def: 8 }
  const n = Number(company?.bulletCount)
  if (Number.isFinite(n)) return Math.min(range.max, Math.max(range.min, n))
  const fallback = Number(formData?.bulletsPerCompany)
  if (Number.isFinite(fallback)) return Math.min(range.max, Math.max(range.min, fallback))
  return range.def
}

function collectUserSkills(formData) {
  const all = []
  for (const c of formData.companies || []) {
    for (const s of c.skills || []) {
      const t = String(s || '').trim()
      if (t) all.push(t)
    }
  }
  return [...new Set(all)]
}

/** Merge AI output with user-provided facts so names/dates/contact never drift. */
function mergeResumeWithForm(aiResume, formData) {
  const companies = Array.isArray(formData.companies) ? formData.companies : []
  const edu = formData.education || {}
  const userSkills = collectUserSkills(formData)

  const experience = companies.map((c, i) => {
    const aiJob = (aiResume.experience || [])[i] || {}
    const cap = bulletsForCompany(c, i, formData)
    const bullets = (aiJob.bullets || [])
      .map((b) => String(b || '').trim())
      .filter(Boolean)
      .slice(0, cap)

    return {
      company: String(c.name || '').trim(),
      title: String(c.role || formData.role || '').trim(),
      dates: formatDates(c.startDate, c.endDate),
      location: formatCityState(c),
      city: c.city || '',
      state: c.state || '',
      skills: Array.isArray(c.skills) ? c.skills : [],
      bullets,
    }
  })

  const location = formatCityState(companies[0] || {}) || (aiResume.location || '').trim()

  const aiSkills = [
    ...(aiResume.skills || []),
    ...(aiResume.technicalSkills || []),
  ].map((s) => String(s || '').trim()).filter(Boolean)

  const skills = [...new Set([...userSkills, ...aiSkills])]

  return {
    name: String(formData.name || aiResume.name || '').trim(),
    email: String(formData.email || '').trim(),
    phone: String(formData.phone || '').trim(),
    linkedin: String(formData.linkedin || '').trim(),
    title: String(formData.role || '').trim(),
    role: String(formData.role || '').trim(),
    location,
    summary: (aiResume.summary || '').trim(),
    summaryBullets: Array.isArray(aiResume.summaryBullets) ? aiResume.summaryBullets : [],
    skills,
    technicalSkills: skills,
    skillCategories: Array.isArray(aiResume.skillCategories) ? aiResume.skillCategories : [],
    experience,
    education: [
      {
        school: String(edu.school || '').trim(),
        degree: String(edu.degree || '').trim(),
        course: String(edu.course || '').trim(),
        dates: formatDates(edu.startDate, edu.endDate),
        startDate: edu.startDate || '',
        endDate: edu.endDate || '',
      },
    ].filter((e) => e.school || e.degree || e.course),
  }
}

export async function runBuildJob(jobId, sessionId, { userId = null } = {}) {
  return runWithAiCostContext({
    userId,
    sessionId,
    jobId,
    operationId: jobId,
    serviceName: AI_SERVICES.BUILDER,
  }, async () => {
  beginAiUsageTracking()
  try {
    const session = getSession(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.kind !== 'builder') throw new Error('Not a builder session')

    const formData = session.builderInput
    if (!formData?.name || !formData?.role) {
      throw new Error('Name and role are required')
    }
    if (!Array.isArray(formData.companies) || formData.companies.length === 0) {
      throw new Error('At least one company is required')
    }

    updateBuildJob(jobId, { step: 'generating_content', status: 'processing' })
    log(jobId, `generating content for ${formData.name} / ${formData.role}`)

    const aiResume = await generateResumeFromForm(formData)
    const resumeData = mergeResumeWithForm(aiResume, formData)
    updateSession(sessionId, { resumeData })
    log(jobId, `content ready — ${resumeData.experience.length} jobs`)

    updateBuildJob(jobId, { step: 'building_docx' })
    const templateId = formData.templateId || 'classic-blue'
    log(jobId, `building DOCX template=${templateId}`)
    const buffer = await generateResumeDocx(resumeData, templateId)

    updateBuildJob(jobId, { step: 'preparing_preview' })
    log(jobId, 'saving files')
    setGeneratedDocx(sessionId, buffer, buffer)

    const aiUsage = endAiUsageTracking({ status: 'completed' })
    log(jobId, `completed — AI calls=${aiUsage.requestCount || 0} cost=$${aiUsage.totalCostUsd || 0}`)

    const result = {
      sessionId,
      fileName: session.fileName,
      downloadUrl: `/api/builder/download/${sessionId}`,
      previewUrl: `/api/builder/file/${sessionId}`,
      resumeData,
      templateId,
    }

    updateBuildJob(jobId, { status: 'completed', step: 'preparing_preview', result })
    log(jobId, 'completed')
  } catch (err) {
    endAiUsageTracking({ status: 'failed' })
    console.error(`[build:${jobId.slice(0, 8)}] failed:`, err.message)
    updateBuildJob(jobId, {
      status: 'failed',
      error: err.message || 'Resume build failed',
    })
  }
  })
}
