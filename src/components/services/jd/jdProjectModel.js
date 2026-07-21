/** @typedef {'waiting'|'uploading'|'extracting'|'analyzing'|'ready'|'failed'} UploadStatus */
/** @typedef {'high'|'medium'|'low'|'unrelated'} RelevanceLevel */

export const JD_STEPS = [
  { id: 'basic', label: 'Basic Information', short: 'Basics' },
  { id: 'target', label: 'Target Role', short: 'Target' },
  { id: 'jd', label: 'Job Description', short: 'JD' },
  { id: 'references', label: 'Reference Documents', short: 'References' },
  { id: 'templates', label: 'Templates', short: 'Templates' },
  { id: 'preview', label: 'Preview', short: 'Preview' },
]

export const COMPANY_COUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}))

export const BULLET_OPTIONS = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 3),
  label: `${i + 3} bullets`,
}))

export const JD_PRODUCT_TEMPLATES = [
  {
    id: 'modern-data',
    productName: 'Modern Professional',
    useCase: 'General professional roles',
    columns: 1,
    estimatedPages: '1–2',
  },
  {
    id: 'compact-ats',
    productName: 'Classic ATS',
    useCase: 'ATS-heavy applications',
    columns: 1,
    estimatedPages: '1–2',
  },
  {
    id: 'technical-black',
    productName: 'Technical Resume',
    useCase: 'Engineering & IT',
    columns: 1,
    estimatedPages: '1–2',
  },
  {
    id: 'navy-executive',
    productName: 'Executive Professional',
    useCase: 'Senior / leadership',
    columns: 1,
    estimatedPages: '2',
  },
  {
    id: 'minimal-gray',
    productName: 'Minimal Clean',
    useCase: 'Clean single-column',
    columns: 1,
    estimatedPages: '1–2',
  },
]

export function newId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function emptyEducation() {
  return {
    id: newId('edu'),
    degree: '',
    major: '',
    school: '',
    location: '',
    startDate: '',
    endDate: '',
    graduationYear: '',
    gpa: '',
  }
}

/** Prefer start/end month-year; fall back to graduation year for older drafts. */
export function formatEducationDates(edu) {
  const start = String(edu?.startDate || '').trim()
  const end = String(edu?.endDate || '').trim()
  if (start && end) return `${start} – ${end}`
  if (end) return end
  if (start) return start
  const year = String(edu?.graduationYear || '').trim()
  return year
}

export function emptyExperience() {
  return {
    id: newId('exp'),
    companyName: '',
    jobTitle: '',
    city: '',
    state: '',
    startDate: '',
    endDate: '',
    bulletCount: '8',
  }
}

export function syncExperiences(experiences, count) {
  const n = Math.min(6, Math.max(1, Number(count) || 1))
  const next = (experiences || []).slice(0, n)
  while (next.length < n) next.push(emptyExperience())
  return next
}

/** Parse "Jan 2020" / "Present" into a timestamp for sorting / span calc. */
function experienceDateKey(value, fallbackNow = false) {
  const raw = String(value || '').trim()
  if (!raw || /^present$|^current$|^now$/i.test(raw)) {
    return fallbackNow ? Date.now() : Number.MAX_SAFE_INTEGER
  }
  const months = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  }
  const m = raw.match(/([A-Za-z]{3,9})?\s*(\d{4})/)
  if (m) {
    const month = m[1] ? (months[m[1].toLowerCase()] ?? 0) : 0
    return Date.UTC(Number(m[2]), month, 1)
  }
  return 0
}

function isCompleteExperienceDate(value, allowPresent = false) {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (allowPresent && /^present$|^current$|^now$/i.test(raw)) return true
  return /^[A-Za-z]{3,9}\s+\d{4}$/.test(raw)
}

/** Approximate total years from earliest start → latest end (or now). */
export function computeYearsOfExperience(experiences) {
  let minStart = Infinity
  let maxEnd = -Infinity
  const now = Date.now()
  for (const e of experiences || []) {
    if (!String(e?.startDate || '').trim()) continue
    const start = experienceDateKey(e.startDate)
    if (!start || start === Number.MAX_SAFE_INTEGER) continue
    const end = experienceDateKey(e.endDate, true)
    const endTs = end === Number.MAX_SAFE_INTEGER ? now : end
    minStart = Math.min(minStart, start)
    maxEnd = Math.max(maxEnd, endTs)
  }
  if (!Number.isFinite(minStart) || minStart === Infinity || maxEnd < minStart) return 0
  const years = (maxEnd - minStart) / (365.25 * 24 * 60 * 60 * 1000)
  return Math.max(0, Math.round(years * 10) / 10)
}

export function emptyCertification() {
  return {
    id: newId('cert'),
    name: '',
    organization: '',
    date: '',
    credentialId: '',
  }
}

export function emptySkillCategories() {
  return {
    'Programming languages': [],
    Frameworks: [],
    Databases: [],
    'Cloud platforms': [],
    'DevOps tools': [],
    'Reporting tools': [],
    'Testing tools': [],
    Methodologies: [],
    'Domain knowledge': [],
    'Other technologies': [],
  }
}

export function createEmptyProject() {
  return {
    id: newId('project'),
    currentStep: 0,
    status: 'draft',
    basicInformation: {
      fullName: '',
      email: '',
      phone: '',
      linkedin: '',
      city: '',
      state: '',
      education: [emptyEducation()],
      basicResumeFileName: '',
      basicResumeExtracted: false,
    },
    targetRole: {
      jobTitle: '',
      companyCount: '3',
      jobDescription: '',
      jdFileName: '',
    },
    experiences: [emptyExperience(), emptyExperience(), emptyExperience()],
    skills: emptySkillCategories(),
    certifications: [],
    referenceDocuments: [],
    referenceItems: [],
    selectedTemplateId: 'compact-ats',
    generatedResume: null,
    sessionId: null,
    previewReady: false,
    updatedAt: new Date().toISOString(),
  }
}

/** Soft warnings for build review — do not block unless required fields missing. */
export function collectWarnings(project) {
  const w = []
  const b = project.basicInformation || {}
  const t = project.targetRole || {}
  if (!String(t.jobDescription || '').trim()) w.push('No job description provided')
  if (!(project.experiences || []).some((e) => String(e.companyName || '').trim())) {
    w.push('No work experience entered')
  }
  for (const exp of project.experiences || []) {
    if (String(exp.companyName || '').trim() && !String(exp.startDate || '').trim()) {
      w.push(`Employment date missing for ${exp.companyName}`)
    }
  }
  const edu = (b.education || [])[0]
  if (!String(edu?.school || '').trim() && !String(edu?.degree || '').trim()) {
    w.push('Education details incomplete')
  }
  const approved = (project.referenceItems || []).filter((i) => i.approved)
  if ((project.referenceDocuments || []).length && approved.length === 0) {
    w.push('No reference material approved')
  }
  return w
}

export function validateStep(project, stepIndex) {
  const step = JD_STEPS[stepIndex]?.id
  const b = project.basicInformation || {}
  const t = project.targetRole || {}

  if (step === 'basic') {
    if (!String(b.fullName || '').trim()) return 'Please enter your full name.'
    if (!String(b.email || '').trim()) return 'Please enter your email.'
    if (!String(b.phone || '').trim()) return 'Please enter your phone number.'
  }
  if (step === 'target') {
    if (!String(t.jobTitle || '').trim()) return 'Please enter the role.'
    if (!t.companyCount) return 'Select how many companies.'
    const count = Number(t.companyCount) || (project.experiences || []).length
    const list = (project.experiences || []).slice(0, count)
    for (let i = 0; i < count; i++) {
      const e = list[i] || {}
      if (!String(e.companyName || '').trim()) return `Company ${i + 1}: enter the company name.`
      if (!String(e.jobTitle || '').trim()) return `Company ${i + 1}: enter the role.`
      if (!isCompleteExperienceDate(e.startDate)) {
        return `Company ${i + 1}: select the start month and year.`
      }
      if (String(e.endDate || '').trim() && !isCompleteExperienceDate(e.endDate, true)) {
        return `Company ${i + 1}: select a complete end month and year, or check Present.`
      }
      if (!String(e.city || '').trim()) return `Company ${i + 1}: select the city.`
      if (!String(e.state || '').trim()) return `Company ${i + 1}: select the state.`
      const bullets = Number(e.bulletCount)
      if (!Number.isFinite(bullets) || bullets < 3 || bullets > 15) {
        return `Company ${i + 1}: select required bullets (3–15).`
      }
    }
  }
  if (step === 'jd') {
    if (!String(t.jobDescription || '').trim() || String(t.jobDescription).trim().length < 80) {
      return 'Paste a fuller job description (at least a few sentences).'
    }
  }
  if (step === 'templates') {
    if (!project.selectedTemplateId) return 'Please select a resume template.'
  }
  return ''
}

/**
 * Bridge to legacy /api/jd-builder/build payload until Phase 6 replaces generation.
 */
export function toLegacyBuildPayload(project) {
  const b = project.basicInformation || {}
  const t = project.targetRole || {}
  const count = Number(t.companyCount) || (project.experiences || []).length
  const companies = (project.experiences || []).slice(0, count).map((e) => ({
    name: String(e.companyName || '').trim(),
    role: String(e.jobTitle || t.jobTitle || '').trim(),
    startDate: String(e.startDate || '').trim(),
    endDate: String(e.endDate || '').trim() || 'Present',
    city: String(e.city || b.city || '').trim() || 'Remote',
    state: String(e.state || b.state || '').trim() || 'N/A',
    summary: '',
    bulletCount: Number(e.bulletCount) || 8,
  }))
  const years = computeYearsOfExperience(companies.map((c) => ({
    startDate: c.startDate,
    endDate: c.endDate,
  })))

  return {
    name: String(b.fullName || '').trim(),
    email: String(b.email || '').trim(),
    phone: String(b.phone || '').trim(),
    linkedin: String(b.linkedin || '').trim(),
    city: String(b.city || '').trim() || 'Remote',
    state: String(b.state || '').trim() || 'N/A',
    role: String(t.jobTitle || '').trim(),
    yearsOfExperience: years,
    companyCount: companies.length || 1,
    templateId: project.selectedTemplateId || 'compact-ats',
    jdText: String(t.jobDescription || '').trim(),
    education: (b.education || [])
      .filter((e) => String(e.school || e.degree || '').trim())
      .map((e) => ({
        school: String(e.school || '').trim(),
        degree: [e.degree, e.major].filter(Boolean).join(' — '),
        dates: formatEducationDates(e),
        startDate: String(e.startDate || '').trim(),
        endDate: String(e.endDate || '').trim(),
        location: String(e.location || '').trim(),
        gpa: String(e.gpa || '').trim(),
      })),
    companies: companies.length
      ? companies
      : [{
          name: 'Experience',
          role: String(t.jobTitle || '').trim(),
          startDate: 'Jan 2020',
          endDate: 'Present',
          city: String(b.city || 'Remote').trim(),
          state: String(b.state || 'N/A').trim(),
          summary: '',
          bulletCount: 8,
        }],
  }
}
