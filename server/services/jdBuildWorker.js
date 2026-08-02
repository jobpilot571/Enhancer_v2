import { getSession, updateSession, setGeneratedDocx } from '../store/sessionStore.js'
import { updateBuildJob } from '../store/buildJobStore.js'
import { analyzeJd, generateResumeFromJd, jdSummaryBulletCount } from './openaiService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'
import { beginAiUsageTracking, endAiUsageTracking, runWithAiCostContext } from './aiProvider.js'
import { AI_SERVICES, toFinalAiCost } from './aiCostTracking.js'

function log(jobId, message) {
  console.log(`[jd-build:${jobId.slice(0, 8)}] ${message}`)
}

function formatDates(start, end) {
  const s = String(start || '').trim()
  const e = String(end || '').trim() || 'Present'
  if (!s) return e
  return `${s} - ${e}`
}

function sanitizeLocPart(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^(n\/?a|na|none|null|undefined|remote|tbd|unknown)$/i.test(v)) return ''
  return v
}

function formatCityState(city, state) {
  return [sanitizeLocPart(city), sanitizeLocPart(state)].filter(Boolean).join(', ')
}

/** Parse "Jan 2020" / "2020-01" / "Present" into a sortable timestamp (higher = more recent). */
function dateSortKey(value) {
  const raw = String(value || '').trim()
  if (!raw || /^present$/i.test(raw) || /^current$/i.test(raw)) {
    return Number.MAX_SAFE_INTEGER
  }
  const ts = Date.parse(raw)
  if (Number.isFinite(ts)) return ts
  const m = raw.match(/([A-Za-z]{3,9})?\s*(\d{4})/)
  if (m) {
    const months = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, sept: 8, september: 8,
      oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
    }
    const month = m[1] ? (months[m[1].toLowerCase()] ?? 0) : 0
    return Date.UTC(Number(m[2]), month, 1)
  }
  return 0
}

/** Present → past by end date, then start date. */
export function sortCompaniesPresentToPast(companies) {
  return [...companies].sort((a, b) => {
    const endDiff = dateSortKey(b.endDate) - dateSortKey(a.endDate)
    if (endDiff !== 0) return endDiff
    return dateSortKey(b.startDate) - dateSortKey(a.startDate)
  })
}

function collectJdSkills(jdData) {
  return [...new Set([
    ...(jdData?.requiredSkills || []),
    ...(jdData?.preferredSkills || []),
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.mustHaveKeywords || []),
    ...(jdData?.domainKeywords || []),
  ].map((s) => String(s || '').trim()).filter(Boolean))]
}

/** Ensure JD skills appear in skillCategories; soft-clean bullets without robotic pads. */
function enforceJdSkills(resumeData, jdData, orderedCompanies = []) {
  const jdSkills = collectJdSkills(jdData)
  if (!jdSkills.length) return resumeData

  let skillCategories = Array.isArray(resumeData.skillCategories)
    ? resumeData.skillCategories.map((c) => ({
        category: c.category,
        skills: [...(c.skills || [])],
      }))
    : []

  const covered = new Set(
    skillCategories.flatMap((c) => c.skills.map((s) => s.toLowerCase())),
  )
  const missing = jdSkills.filter((s) => !covered.has(s.toLowerCase()))
  if (missing.length) {
    const existing = skillCategories.find((c) => /tool|skill|technolog|core/i.test(c.category))
    if (existing) {
      existing.skills = [...new Set([...existing.skills, ...missing])]
    } else {
      skillCategories.push({ category: 'Core Technologies', skills: missing })
    }
  }
  skillCategories = skillCategories
    .filter((c) => c.category && c.skills.length)
    .slice(0, 7)

  const flatSkills = [...new Set([
    ...(resumeData.skills || []),
    ...(resumeData.technicalSkills || []),
    ...skillCategories.flatMap((c) => c.skills),
    ...jdSkills,
  ].map((s) => String(s || '').trim()).filter(Boolean))]

  const experience = (resumeData.experience || []).map((job, jobIdx) => {
    const ranges = [
      { min: 12, max: 14, def: 13 },
      { min: 11, max: 13, def: 12 },
      { min: 10, max: 12, def: 11 },
      { min: 9, max: 11, def: 10 },
      { min: 7, max: 9, def: 8 },
    ]
    const range = ranges[jobIdx] || { min: 7, max: 12, def: 8 }
    const maxBullets = Math.min(
      range.max,
      Math.max(range.min, Number(orderedCompanies[jobIdx]?.bulletCount) || job.bullets?.length || range.def),
    )
    const bullets = [...(job.bullets || [])].slice(0, maxBullets).map((raw) => {
      let text = String(raw || '').trim()
      if (!text) return text
      // Soft cleanup only — do not append robotic skill pads
      text = text
        .replace(/\s+/g, ' ')
        .replace(/[–—]/g, ' ')
        .replace(/\(\s*/g, '')
        .replace(/\s*\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      return text
    })
    return { ...job, bullets }
  })

  return {
    ...resumeData,
    skillCategories,
    skills: flatSkills,
    technicalSkills: flatSkills,
    experience,
  }
}

function mergeJdResumeWithForm(aiResume, formData, jdData, orderedCompanies) {
  const roleTitle = String(jdData?.roleTitle || formData.role || '').trim()
  const location = formatCityState(formData.city, formData.state)
  const summaryCount = jdSummaryBulletCount()

  const summaryBullets = (aiResume.summaryBullets || [])
    .map((b) => String(b || '').trim()
      .replace(/[–—]/g, ' ')
      .replace(/\(\s*/g, '')
      .replace(/\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean)

  const trimmedSummary = summaryBullets.slice(0, summaryCount)

  const experience = orderedCompanies.map((c, i) => {
    const aiJob = (aiResume.experience || [])[i] || {}
    const bulletCount = Math.min(15, Math.max(3, Number(c.bulletCount) || 8))
    const bullets = (aiJob.bullets || [])
      .map((b) => String(b || '').trim())
      .filter(Boolean)
      .slice(0, bulletCount)

    return {
      company: String(c.name || '').trim(),
      title: String(c.role || roleTitle).trim(),
      dates: formatDates(c.startDate, c.endDate),
      location: formatCityState(c.city, c.state),
      city: c.city || '',
      state: c.state || '',
      bullets,
    }
  })

  let skillCategories = Array.isArray(aiResume.skillCategories)
    ? aiResume.skillCategories
      .map((cat) => ({
        category: String(cat.category || '').trim(),
        skills: (cat.skills || []).map((s) => String(s || '').trim()).filter(Boolean),
      }))
      .filter((c) => c.category && c.skills.length)
    : []

  const jdFlat = collectJdSkills(jdData)
  if (skillCategories.length < 5 || jdFlat.length) {
    const leftovers = jdFlat.filter(
      (s) => !skillCategories.some((c) => c.skills.some((x) => x.toLowerCase() === s.toLowerCase())),
    )
    if (leftovers.length) {
      skillCategories.push({ category: 'Core Technologies', skills: leftovers.slice(0, 24) })
    }
  }
  skillCategories = skillCategories.slice(0, 7)

  const flatFromCats = skillCategories.flatMap((c) => c.skills)
  const aiSkills = [
    ...(aiResume.skills || []),
    ...(aiResume.technicalSkills || []),
    ...flatFromCats,
    ...jdFlat,
  ].map((s) => String(s || '').trim()).filter(Boolean)
  const skills = [...new Set(aiSkills)]

  const merged = {
    name: String(formData.name || aiResume.name || '').trim(),
    email: String(formData.email || '').trim(),
    phone: String(formData.phone || '').trim(),
    linkedin: String(formData.linkedin || '').trim(),
    title: roleTitle,
    role: roleTitle,
    location,
    summary: (aiResume.summary || '').trim(),
    summaryBullets: trimmedSummary,
    skills,
    technicalSkills: skills,
    skillCategories,
    keywords: skills,
    experience,
    education: Array.isArray(formData.education) && formData.education.length
      ? formData.education
      : [],
  }

  return enforceJdSkills(merged, jdData, orderedCompanies)
}

export async function runJdBuildJob(jobId, sessionId, { userId = null } = {}) {
  return runWithAiCostContext({
    userId,
    sessionId,
    jobId,
    operationId: jobId,
    serviceName: AI_SERVICES.JD_BUILDER,
  }, async () => {
  beginAiUsageTracking()
  try {
    const session = getSession(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.kind !== 'jd-builder') throw new Error('Not a JD-builder session')

    const formData = session.builderInput
    if (!formData?.name) throw new Error('Name is required')
    if (!String(formData.jdText || '').trim()) throw new Error('Job description is required')
    if (!Array.isArray(formData.companies) || formData.companies.length === 0) {
      throw new Error('At least one company is required')
    }

    updateBuildJob(jobId, { step: 'parsing_jd', status: 'processing' })
    log(jobId, 'analyzing JD')
    const { data: jdData } = await analyzeJd(formData.jdText)
    updateSession(sessionId, { jdText: formData.jdText, jdData })

    const ordered = sortCompaniesPresentToPast(formData.companies)
    const roleTitle = String(jdData?.roleTitle || formData.role || '').trim()
    if (!roleTitle) throw new Error('Could not determine role from JD — add a clearer job title in the JD or Role field')

    updateBuildJob(jobId, { step: 'generating_content' })
    log(jobId, `generating JD-tailored content via Claude for ${formData.name} / ${roleTitle}`)

    const aiResume = await generateResumeFromJd(
      { ...formData, companies: ordered, role: roleTitle },
      jdData,
    )
    const resumeData = mergeJdResumeWithForm(aiResume, formData, jdData, ordered)
    updateSession(sessionId, { resumeData })
    const shortBullets = (resumeData.experience || []).flatMap((job) =>
      (job.bullets || []).filter((b) => String(b).trim().split(/\s+/).length < 28),
    )
    log(
      jobId,
      `content ready — ${resumeData.experience.length} jobs, ${resumeData.summaryBullets.length} summary bullets`
      + (shortBullets.length ? ` (warn: ${shortBullets.length} bullets under 28 words)` : ''),
    )

    updateBuildJob(jobId, { step: 'building_docx' })
    const templateId = formData.templateId || 'compact-ats'
    log(jobId, `building DOCX template=${templateId}`)
    const buffer = await generateResumeDocx(resumeData, templateId, {
      forceBlack: true,
      fontFamily: formData.fontFamily || 'Calibri',
      fontSizePt: Number(formData.fontSizePt) || 12,
      keywordHighlight: Boolean(formData.keywordHighlight),
    })

    updateBuildJob(jobId, { step: 'preparing_preview' })
    log(jobId, 'saving files')
    setGeneratedDocx(sessionId, buffer, buffer)

    const aiUsage = endAiUsageTracking({ status: 'completed' })
    const finalAiCost = toFinalAiCost(aiUsage)
    updateSession(sessionId, { finalAiCost })

    const result = {
      sessionId,
      fileName: session.fileName,
      downloadUrl: `/api/jd-builder/download/${sessionId}`,
      previewUrl: `/api/jd-builder/file/${sessionId}`,
      resumeData,
      templateId,
      roleTitle,
      finalAiCost,
    }

    updateBuildJob(jobId, { status: 'completed', step: 'preparing_preview', result })
    log(jobId, `completed — AI cost $${finalAiCost.totalCostUsd}`)
  } catch (err) {
    const failedUsage = endAiUsageTracking({ status: 'failed' })
    const finalAiCost = toFinalAiCost(failedUsage)
    console.error(`[jd-build:${jobId.slice(0, 8)}] failed:`, err.message)
    updateSession(sessionId, { finalAiCost })
    updateBuildJob(jobId, {
      status: 'failed',
      error: err.message || 'JD-tailored resume build failed',
      result: { finalAiCost },
    })
  }
  })
}
