import { getSession, updateSession, setGeneratedDocx } from '../store/sessionStore.js'
import { updateBuildJob } from '../store/buildJobStore.js'
import { analyzeJd, generateResumeFromJd, jdSummaryBulletCount } from './openaiService.js'
import { researchJdCompanyContexts } from './companyContextService.js'
import { improveJdExperienceBullets } from './jdExperienceQualityService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'
import { beginAiUsageTracking, endAiUsageTracking, runWithAiCostContext } from './aiProvider.js'
import { AI_SERVICES } from './aiCostTracking.js'

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

const BANNED_SKILL_CATEGORY_RE = /^(core\s*technologies|advanced(\s+and)?\s*modern\s*skills|advanced\s*skills|leadership\s*(and|&)?\s*communication|soft\s*skills)$/i

const VAGUE_SKILL_RE = /^(communication|leadership|reports?|reporting|security|coding\s*skills?|business\s*process(es)?(\s*knowledge)?|teamwork|problem[\s-]*solving|presentation(\s*skills?)?|collaboration|management|analytical\s*skills?|interpersonal\s*skills?|time\s*management|critical\s*thinking|adaptability|detail[\s-]*oriented|self[\s-]*motivated)$/i

const ALLOWED_SKILL_CATEGORIES = [
  'Programming Languages',
  'Databases',
  'Frameworks and Libraries',
  'Cloud and DevOps',
  'Tools and Platforms',
  'Domain Skills',
]

function normalizeSkillKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isVagueSkill(skill) {
  const key = normalizeSkillKey(skill)
  if (!key || key.length < 2) return true
  if (VAGUE_SKILL_RE.test(key)) return true
  // Generic padding — role/industry alone is not a technical skill
  if (/^(data analyst|software engineer|retail|healthcare|finance|banking)$/i.test(key)) return true
  return false
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True if skill already appears in Skills lists or in Summary/Experience narrative. */
function skillAlreadyPresent(skill, resumeData, skillCategories) {
  const key = normalizeSkillKey(skill)
  if (!key) return true

  for (const cat of skillCategories || []) {
    for (const s of cat.skills || []) {
      if (normalizeSkillKey(s) === key) return true
    }
  }
  for (const s of [...(resumeData.skills || []), ...(resumeData.technicalSkills || [])]) {
    if (normalizeSkillKey(s) === key) return true
  }

  const narrative = [
    resumeData.summary || '',
    ...((resumeData.summaryBullets || [])),
    ...((resumeData.experience || []).flatMap((job) => [
      job.title || '',
      ...(job.bullets || []),
    ])),
  ].join(' \n ')

  const pattern = new RegExp(`(?:^|[^a-z0-9+#])${escapeRegExp(key)}(?:[^a-z0-9+#]|$)`, 'i')
  return pattern.test(narrative)
}

function experienceSupportScore(skill, resumeData) {
  const key = normalizeSkillKey(skill)
  if (!key) return 0
  const text = [
    ...((resumeData.experience || []).flatMap((job) => job.bullets || [])),
    ...((resumeData.summaryBullets || [])),
  ].join(' \n ').toLowerCase()
  if (!text) return 0
  const pattern = new RegExp(`(?:^|[^a-z0-9+#])${escapeRegExp(key)}(?:[^a-z0-9+#]|$)`, 'i')
  if (pattern.test(text)) return 3
  // Partial token overlap for multi-word tools (e.g. "Power BI" vs "PowerBI")
  const compact = key.replace(/\s+/g, '')
  if (compact.length >= 4 && text.replace(/\s+/g, '').includes(compact)) return 2
  return 0
}

function inferSkillCategoryName(skill) {
  const s = normalizeSkillKey(skill)
  if (!s) return 'Tools and Platforms'

  if (/^(python|java|javascript|typescript|c\+\+|c#|go|golang|ruby|php|scala|kotlin|swift|r|sas|matlab|bash|shell|sql)$/.test(s)
    || /\b(python|java|javascript|typescript|golang|kotlin)\b/.test(s)) {
    return 'Programming Languages'
  }
  if (/sql|snowflake|redshift|bigquery|postgres|mysql|mongodb|dynamodb|oracle|sql\s*server|cassandra|redis|databricks|synapse|teradata|hive/.test(s)
    || /database|dbt\b/.test(s)) {
    return 'Databases'
  }
  if (/react|angular|vue|node\.?js|django|flask|spring|fastapi|express|\.net|rails|laravel|next\.?js|pandas|numpy|scikit|tensorflow|pytorch|spark|hadoop|kafka/.test(s)
    || /framework|library/.test(s)) {
    return 'Frameworks and Libraries'
  }
  if (/aws|azure|gcp|google\s*cloud|kubernetes|docker|terraform|jenkins|github\s*actions|gitlab\s*ci|ci\/?cd|devops|airflow|lambda|s3|ec2|cloud\s*formation/.test(s)
    || /\bcloud\b/.test(s)) {
    return 'Cloud and DevOps'
  }
  if (/tableau|power\s*bi|looker|excel|jira|confluence|salesforce|sap|servicenow|figma|postman|splunk|datadog|cursor|chatgpt|copilot|vscode|git|linux|windows|office\s*365|sharepoint/.test(s)
    || /tool|platform|ide\b/.test(s)) {
    return 'Tools and Platforms'
  }
  return 'Domain Skills'
}

function findCategoryIndex(skillCategories, categoryName) {
  const target = normalizeSkillKey(categoryName)
  return skillCategories.findIndex((c) => normalizeSkillKey(c.category) === target)
}

function placeSkillInCategories(skillCategories, skill, preferredCategory) {
  const key = normalizeSkillKey(skill)
  if (!key) return skillCategories

  // Already present in any category — skip
  if (skillCategories.some((c) => (c.skills || []).some((s) => normalizeSkillKey(s) === key))) {
    return skillCategories
  }

  const cats = skillCategories.map((c) => ({
    category: c.category,
    skills: [...(c.skills || [])],
  }))

  let idx = findCategoryIndex(cats, preferredCategory)
  if (idx < 0) {
    // Prefer an existing related category over creating a new one
    const softMatch = cats.findIndex((c) => {
      const name = normalizeSkillKey(c.category)
      if (preferredCategory === 'Programming Languages') return /program|language|script/.test(name)
      if (preferredCategory === 'Databases') return /data\s*base|data\s*stor|sql|warehouse/.test(name)
      if (preferredCategory === 'Frameworks and Libraries') return /framework|librar|sdk/.test(name)
      if (preferredCategory === 'Cloud and DevOps') return /cloud|devops|infra|platform/.test(name)
      if (preferredCategory === 'Tools and Platforms') return /tool|platform|software|application/.test(name)
      if (preferredCategory === 'Domain Skills') return /domain|analytics|business|industry|method/.test(name)
      return false
    })
    idx = softMatch
  }

  if (idx < 0 && cats.length) {
    // Last resort: Tools and Platforms-like existing bucket, else first real category
    idx = cats.findIndex((c) => /tool|platform/i.test(c.category))
    if (idx < 0) idx = 0
  }

  if (idx < 0) {
    // No categories at all — create one allowed category (never a dump bucket)
    const allowed = ALLOWED_SKILL_CATEGORIES.includes(preferredCategory)
      ? preferredCategory
      : 'Tools and Platforms'
    cats.push({ category: allowed, skills: [skill] })
    return cats
  }

  cats[idx].skills.push(skill)
  return cats
}

function dedupeCategorySkills(skillCategories) {
  const seen = new Set()
  return skillCategories
    .map((c) => {
      const skills = []
      for (const raw of c.skills || []) {
        const skill = String(raw || '').trim()
        const key = normalizeSkillKey(skill)
        if (!skill || !key || seen.has(key) || isVagueSkill(skill)) continue
        seen.add(key)
        skills.push(skill)
      }
      return { category: String(c.category || '').trim(), skills }
    })
    .filter((c) => c.category && c.skills.length && !BANNED_SKILL_CATEGORY_RE.test(c.category))
}

function jdSkillPriority(skill, jdData, resumeData) {
  const key = normalizeSkillKey(skill)
  let score = experienceSupportScore(skill, resumeData)
  const required = (jdData?.requiredSkills || []).some((s) => normalizeSkillKey(s) === key)
  const tools = (jdData?.toolsTechnologies || []).some((s) => normalizeSkillKey(s) === key)
  const preferred = (jdData?.preferredSkills || []).some((s) => normalizeSkillKey(s) === key)
  if (required) score += 4
  if (tools) score += 3
  if (preferred) score += 2
  // Domain keywords are weaker signal for Technical Skills stuffing
  const domain = (jdData?.domainKeywords || []).some((s) => normalizeSkillKey(s) === key)
  if (domain) score += 1
  return score
}

/**
 * Soft-clean bullets and merge missing JD technical skills into existing categories.
 * Never creates Core Technologies / Advanced Skills dump buckets.
 * Skills already covered in Summary, Experience, or Skills are not re-added.
 */
function enforceJdSkills(resumeData, jdData, orderedCompanies = []) {
  const jdSkills = collectJdSkills(jdData)

  let skillCategories = Array.isArray(resumeData.skillCategories)
    ? resumeData.skillCategories.map((c) => ({
        category: String(c.category || '').trim(),
        skills: [...(c.skills || [])].map((s) => String(s || '').trim()).filter(Boolean),
      }))
    : []

  // Drop banned dump categories; keep their concrete skills for redistribution
  const orphanSkills = []
  skillCategories = skillCategories.filter((c) => {
    if (BANNED_SKILL_CATEGORY_RE.test(c.category)) {
      orphanSkills.push(...(c.skills || []))
      return false
    }
    return Boolean(c.category)
  })

  for (const skill of orphanSkills) {
    if (isVagueSkill(skill)) continue
    skillCategories = placeSkillInCategories(skillCategories, skill, inferSkillCategoryName(skill))
  }

  skillCategories = dedupeCategorySkills(skillCategories)

  const candidates = jdSkills
    .filter((s) => !isVagueSkill(s))
    .filter((s) => !skillAlreadyPresent(s, resumeData, skillCategories))
    .map((s) => ({
      skill: s,
      score: jdSkillPriority(s, jdData, resumeData),
      category: inferSkillCategoryName(s),
    }))
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill))

  // Cap additions so long JD tech lists do not keyword-stuff the Skills section.
  // Require score >= 2 (required/tools/preferred or experience support) — skip weak domain-only padding.
  const maxAdd = Math.min(8, Math.max(3, 12 - skillCategories.reduce((n, c) => n + c.skills.length, 0)))
  const toAdd = candidates.filter((c) => c.score >= 2).slice(0, maxAdd)

  for (const item of toAdd) {
    skillCategories = placeSkillInCategories(skillCategories, item.skill, item.category)
  }

  skillCategories = dedupeCategorySkills(skillCategories).slice(0, 6)

  const flatSkills = [...new Set([
    ...skillCategories.flatMap((c) => c.skills),
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
      .filter((c) => c.category && c.skills.length && !BANNED_SKILL_CATEGORY_RE.test(c.category))
    : []

  // Do not dump leftover JD skills into Core Technologies here —
  // enforceJdSkills places only genuine gaps into existing/allowed categories.
  skillCategories = skillCategories.slice(0, 6)

  const flatFromCats = skillCategories.flatMap((c) => c.skills)
  const aiSkills = [
    ...(aiResume.skills || []),
    ...(aiResume.technicalSkills || []),
    ...flatFromCats,
  ].map((s) => String(s || '').trim()).filter((s) => s && !isVagueSkill(s))
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

    updateBuildJob(jobId, { step: 'researching_companies' })
    log(jobId, 'researching public company context (Tavily → cache → LLM fallback)')
    let companyContexts = []
    try {
      companyContexts = await researchJdCompanyContexts(ordered, jdData)
    } catch (err) {
      log(jobId, `company research failed (continuing): ${err.message}`)
      companyContexts = []
    }
    const liveCount = companyContexts.filter((c) => c.researchStatus === 'live').length
    const fallbackCount = companyContexts.filter((c) => c.researchStatus === 'fallback_llm').length
    log(
      jobId,
      companyContexts.length
        ? `company context ready: ${companyContexts.map((c) => c.company).join(', ')} (live=${liveCount}, llm_fallback=${fallbackCount})`
        : 'company context: none (continuing without)',
    )
    updateSession(sessionId, { companyContexts })

    updateBuildJob(jobId, { step: 'generating_content' })
    log(jobId, `generating JD-tailored content (Claude → ChatGPT → Gemini) for ${formData.name} / ${roleTitle}`)

    const aiResume = await generateResumeFromJd(
      { ...formData, companies: ordered, role: roleTitle },
      jdData,
      companyContexts,
    )
    let resumeData = mergeJdResumeWithForm(aiResume, formData, jdData, ordered)

    updateBuildJob(jobId, { step: 'qa_experience' })
    log(jobId, 'running Experience bullet quality check (selective rewrite)')
    resumeData = await improveJdExperienceBullets(resumeData, {
      jdData,
      companyContexts,
      log: (msg) => log(jobId, msg),
    })

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
    log(jobId, `completed — AI calls=${aiUsage.requestCount || 0} cost=$${aiUsage.totalCostUsd || 0}`)

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
    endAiUsageTracking({ status: 'failed' })
    console.error(`[jd-build:${jobId.slice(0, 8)}] failed:`, err.message)
    updateBuildJob(jobId, {
      status: 'failed',
      error: err.message || 'JD-tailored resume build failed',
    })
  }
  })
}
