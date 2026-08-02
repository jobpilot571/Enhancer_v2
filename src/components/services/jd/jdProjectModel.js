/** @typedef {'waiting'|'uploading'|'extracting'|'analyzing'|'ready'|'failed'} UploadStatus */
/** @typedef {'high'|'medium'|'low'|'unrelated'} RelevanceLevel */

export const JD_STEPS = [
  { id: 'basic', label: 'Basic Information', short: 'Basics' },
  { id: 'jd', label: 'Job Description', short: 'JD' },
  { id: 'target', label: 'Target Role', short: 'Target' },
  { id: 'references', label: 'Reference Documents', short: 'References' },
  { id: 'templates', label: 'Templates', short: 'Templates' },
  { id: 'preview', label: 'Preview', short: 'Preview' },
  { id: 'saved', label: 'Saved Resumes', short: 'Saved' },
]

export const COMPANY_COUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}))

export const BULLET_OPTIONS = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 3),
  label: `${i + 3} bullets`,
}))

/** Default / allowed bullet counts by company rank (0 = most recent / first). */
export const COMPANY_BULLET_DEFAULTS = [
  { min: 12, max: 14, default: '13' },
  { min: 11, max: 13, default: '12' },
  { min: 10, max: 12, default: '11' },
  { min: 9, max: 11, default: '10' },
  { min: 7, max: 9, default: '8' },
]

export function bulletRangeForCompanyIndex(index) {
  return COMPANY_BULLET_DEFAULTS[index] || { min: 7, max: 12, default: '8' }
}

export function defaultBulletCountForCompanyIndex(index) {
  return bulletRangeForCompanyIndex(index).default
}

export const JD_FONT_OPTIONS = [
  { value: 'Calibri', label: 'Calibri' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
]

export const JD_FONT_SIZE_OPTIONS = [
  { value: '10', label: '10 pt' },
  { value: '11', label: '11 pt' },
  { value: '12', label: '12 pt' },
  { value: '13', label: '13 pt' },
  { value: '14', label: '14 pt' },
]

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

export function emptyExperience(companyIndex = 0) {
  return {
    id: newId('exp'),
    companyName: '',
    jobTitle: '',
    city: '',
    state: '',
    startDate: '',
    endDate: '',
    bulletCount: defaultBulletCountForCompanyIndex(companyIndex),
    summary: '',
    country: '',
  }
}

export function syncExperiences(experiences, count) {
  const n = Math.min(6, Math.max(1, Number(count) || 1))
  const next = (experiences || []).slice(0, n)
  while (next.length < n) next.push(emptyExperience(next.length))
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
      yearsRequired: '',
      companyCount: '1',
      jobDescription: '',
      jdFileName: '',
      aiMode: false,
      aiIndustry: '',
    },
    experiences: [emptyExperience()],
    skills: emptySkillCategories(),
    certifications: [],
    referenceDocuments: [],
    referenceItems: [],
    selectedTemplateId: 'compact-ats',
    fontFamily: 'Calibri',
    fontSizePt: '12',
    keywordHighlight: false,
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
  if (step === 'jd') {
    if (!String(t.jobDescription || '').trim() || String(t.jobDescription).trim().length < 80) {
      return 'Paste a fuller job description (at least a few sentences).'
    }
  }
  if (step === 'target') {
    if (!String(t.jobTitle || '').trim()) return 'Please enter the target role.'
    const list = project.experiences || []
    if (!list.length) return 'Add at least one company.'
    const count = Math.min(6, list.length)
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
      const range = bulletRangeForCompanyIndex(i)
      if (!Number.isFinite(bullets) || bullets < range.min || bullets > range.max) {
        return `Company ${i + 1}: select ${range.min}–${range.max} bullets.`
      }
      const jdText = String(t.jobDescription || '')
      const companyName = String(e.companyName || '').trim()
      if (companyName && jdEmployerLooksLike(companyName, jdText, t.jobTitle)) {
        return `Company ${i + 1}: company name must not match the employer named in the JD.`
      }
    }
  }
  if (step === 'templates') {
    if (!project.selectedTemplateId) return 'Please select a resume template.'
  }
  return ''
}

/** True when a company name appears to be the JD's hiring company. */
export function jdEmployerLooksLike(companyName, jdText, roleTitle = '') {
  const company = String(companyName || '').trim().toLowerCase()
  if (company.length < 3) return false
  const jd = String(jdText || '')
  const lower = jd.toLowerCase()
  if (!lower.includes(company)) return false
  // Role title alone is not an employer match
  const role = String(roleTitle || '').trim().toLowerCase()
  if (role && company === role) return false
  // Strong signals near the company mention
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const nearHire = new RegExp(
    `(?:at|join|joining|for|about|employer|company|organization|inc\\.?|llc|ltd)\\s+[^\\n.]{0,40}${escaped}`
    + `|${escaped}\\s+(?:is hiring|is looking|seeks|is seeking)`,
    'i',
  )
  if (nearHire.test(jd)) return true
  // Company appears in first ~400 chars of JD (often header / about company)
  const head = lower.slice(0, 400)
  return head.includes(company)
}

/**
 * Bridge to legacy /api/jd-builder/build payload until Phase 6 replaces generation.
 */
export function toLegacyBuildPayload(project) {
  const b = project.basicInformation || {}
  const t = project.targetRole || {}
  const companies = (project.experiences || []).slice(0, 6).map((e, idx) => ({
    name: String(e.companyName || '').trim(),
    role: String(e.jobTitle || t.jobTitle || '').trim(),
    startDate: String(e.startDate || '').trim(),
    endDate: String(e.endDate || '').trim() || 'Present',
    city: String(e.city || b.city || '').trim(),
    state: String(e.state || b.state || '').trim(),
    summary: String(e.summary || '').trim(),
    bulletCount: Number(e.bulletCount) || Number(defaultBulletCountForCompanyIndex(idx)),
    country: String(e.country || '').trim(),
  }))
  const yearsFromDates = computeYearsOfExperience(companies.map((c) => ({
    startDate: c.startDate,
    endDate: c.endDate,
  })))
  const yearsRequired = Number(t.yearsRequired)
  const years = yearsFromDates > 0
    ? yearsFromDates
    : (Number.isFinite(yearsRequired) && yearsRequired > 0 ? yearsRequired : 0)

  const approvedRefs = (project.referenceItems || [])
    .filter((i) => i.approved && String(i.cleanedText || '').trim())
  const refSummary = approvedRefs
    .filter((i) => i.category === 'summary')
    .map((i) => String(i.cleanedText).trim())
  const refBullets = approvedRefs
    .filter((i) => ['experience', 'project', 'achievement'].includes(i.category))
    .map((i) => String(i.cleanedText).trim())
  const refSkills = approvedRefs
    .filter((i) => i.category === 'skill' || i.category === 'domain')
    .map((i) => String(i.cleanedText).trim())

  return {
    name: String(b.fullName || '').trim(),
    email: String(b.email || '').trim(),
    phone: String(b.phone || '').trim(),
    linkedin: String(b.linkedin || '').trim(),
    city: String(b.city || '').trim(),
    state: String(b.state || '').trim(),
    role: String(t.jobTitle || '').trim(),
    yearsOfExperience: years,
    yearsRequired: Number.isFinite(yearsRequired) && yearsRequired > 0 ? yearsRequired : null,
    companyCount: companies.filter((c) => c.name).length || companies.length || 1,
    aiMode: Boolean(t.aiMode),
    aiIndustry: String(t.aiIndustry || '').trim(),
    templateId: project.selectedTemplateId || 'compact-ats',
    fontFamily: project.fontFamily || 'Calibri',
    fontSizePt: Number(project.fontSizePt) || 12,
    keywordHighlight: Boolean(project.keywordHighlight),
    jdText: String(t.jobDescription || '').trim(),
    education: (b.education || [])
      .filter((e) => String(e.school || e.degree || '').trim())
      .map((e) => ({
        school: String(e.school || '').trim(),
        degree: [e.degree, e.major].filter(Boolean).join(', '),
        dates: formatEducationDates(e),
        startDate: String(e.startDate || '').trim(),
        endDate: String(e.endDate || '').trim(),
        location: String(e.location || '').trim(),
        gpa: String(e.gpa || '').trim(),
      })),
    referenceMaterial: approvedRefs.length
      ? {
          summaryBullets: refSummary,
          experience: refBullets.length
            ? [{ company: '', title: '', bullets: refBullets }]
            : [],
          skills: refSkills,
        }
      : null,
    companies: companies.filter((c) => c.name).length
      ? companies.filter((c) => c.name)
      : [{
          name: 'Experience',
          role: String(t.jobTitle || '').trim(),
          startDate: 'Jan 2020',
          endDate: 'Present',
          city: String(b.city || '').trim(),
          state: String(b.state || '').trim(),
          summary: '',
          bulletCount: t.aiMode ? 11 : 8,
        }],
  }
}
