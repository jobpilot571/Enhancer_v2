import { getSession, updateSession, setGeneratedDocx } from '../store/sessionStore.js'
import { updateBuildJob } from '../store/buildJobStore.js'
import { analyzeJd, generateResumeFromJd, summaryBulletCountForYears } from './openaiService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'

function log(jobId, message) {
  console.log(`[jd-build:${jobId.slice(0, 8)}] ${message}`)
}

function formatDates(start, end) {
  const s = String(start || '').trim()
  const e = String(end || '').trim() || 'Present'
  if (!s) return e
  return `${s} – ${e}`
}

function formatCityState(city, state) {
  return [city, state].filter(Boolean).join(', ')
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

function mergeJdResumeWithForm(aiResume, formData, jdData, orderedCompanies) {
  const roleTitle = String(jdData?.roleTitle || formData.role || '').trim()
  const location = formatCityState(formData.city, formData.state)
    || String(aiResume.location || '').trim()
  const summaryCount = summaryBulletCountForYears(formData.yearsOfExperience)

  const summaryBullets = (aiResume.summaryBullets || [])
    .map((b) => String(b || '').trim())
    .filter(Boolean)

  const targetSummary = summaryCount >= 12
    ? Math.max(12, Math.min(summaryBullets.length, 16))
    : summaryCount
  const trimmedSummary = summaryBullets.slice(0, targetSummary)

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

  // Ensure at least 5 categories when JD skills exist
  if (skillCategories.length < 5) {
    const jdFlat = [
      ...(jdData?.requiredSkills || []),
      ...(jdData?.toolsTechnologies || []),
      ...(jdData?.preferredSkills || []),
    ].map((s) => String(s || '').trim()).filter(Boolean)

    const leftovers = jdFlat.filter(
      (s) => !skillCategories.some((c) => c.skills.some((x) => x.toLowerCase() === s.toLowerCase())),
    )
    if (leftovers.length) {
      skillCategories.push({ category: 'Additional Tools', skills: leftovers.slice(0, 16) })
    }
  }
  skillCategories = skillCategories.slice(0, 7)

  const flatFromCats = skillCategories.flatMap((c) => c.skills)
  const aiSkills = [
    ...(aiResume.skills || []),
    ...(aiResume.technicalSkills || []),
    ...flatFromCats,
  ].map((s) => String(s || '').trim()).filter(Boolean)
  const skills = [...new Set(aiSkills)]

  return {
    name: String(formData.name || aiResume.name || '').trim(),
    email: String(formData.email || '').trim(),
    phone: String(formData.phone || '').trim(),
    linkedin: '',
    title: roleTitle,
    role: roleTitle,
    location,
    summary: (aiResume.summary || '').trim(),
    summaryBullets: trimmedSummary,
    skills,
    technicalSkills: skills,
    skillCategories,
    experience,
    education: [],
  }
}

export async function runJdBuildJob(jobId, sessionId) {
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
    log(jobId, `generating JD-tailored content for ${formData.name} / ${roleTitle}`)

    const aiResume = await generateResumeFromJd(
      { ...formData, companies: ordered, role: roleTitle },
      jdData,
    )
    const resumeData = mergeJdResumeWithForm(aiResume, formData, jdData, ordered)
    updateSession(sessionId, { resumeData })
    log(jobId, `content ready — ${resumeData.experience.length} jobs, ${resumeData.summaryBullets.length} summary bullets`)

    updateBuildJob(jobId, { step: 'building_docx' })
    const templateId = formData.templateId || 'jd-classic'
    log(jobId, `building DOCX template=${templateId}`)
    const buffer = await generateResumeDocx(resumeData, templateId)

    updateBuildJob(jobId, { step: 'preparing_preview' })
    log(jobId, 'saving files')
    setGeneratedDocx(sessionId, buffer, buffer)

    const result = {
      sessionId,
      fileName: session.fileName,
      downloadUrl: `/api/jd-builder/download/${sessionId}`,
      previewUrl: `/api/jd-builder/file/${sessionId}`,
      resumeData,
      templateId,
      roleTitle,
    }

    updateBuildJob(jobId, { status: 'completed', step: 'preparing_preview', result })
    log(jobId, 'completed')
  } catch (err) {
    console.error(`[jd-build:${jobId.slice(0, 8)}] failed:`, err.message)
    updateBuildJob(jobId, {
      status: 'failed',
      error: err.message || 'JD-tailored resume build failed',
    })
  }
}
