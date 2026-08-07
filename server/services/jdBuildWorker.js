import { getSession, updateSession, setGeneratedDocx } from '../store/sessionStore.js'
import { updateBuildJob } from '../store/buildJobStore.js'
import { analyzeJd, generateResumeFromJd, jdSummaryBulletCount } from './openaiService.js'
import { researchJdCompanyContexts } from './companyContextService.js'
import { generateJdProjectMemories, stripProjectMemoryLeaks } from './jdProjectMemoryService.js'
import { improveJdExperienceBullets } from './jdExperienceQualityService.js'
import { generateResumeDocx } from './resumeDocxGenerator.js'
import { beginAiUsageTracking, endAiUsageTracking, runWithAiCostContext } from './aiProvider.js'
import { AI_SERVICES } from './aiCostTracking.js'
import { extractKnownToolsFromText } from './scoringDictionary.js'

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

const BANNED_SKILL_CATEGORY_RE = /^(core\s*technologies|advanced(\s+and)?\s*modern\s*skills|advanced\s*skills|leadership\s*(and|&)?\s*communication|soft\s*skills)$/i

const VAGUE_SKILL_RE = /^(communication|leadership|reports?|reporting|security|codingskills?|businessprocess(es)?(knowledge)?|teamwork|problemsolving|presentation(skills?)?|collaboration|management|analyticalskills?|interpersonalskills?|timemanagement|criticalthinking|adaptability|detailoriented|selfmotivated|documentation|stakeholder(management)?|teamplayer|ownership|delivery|excellentcommunication|strongcommunication|writtencommunication|verbalcommunication)$/i

const SOFT_SKILL_PHRASE_RE = /\b(communication|leadership|teamwork|problem[\s-]*solving|documentation|stakeholder|collaboration|presentation|interpersonal|time\s*management|critical\s*thinking|adaptability|ownership|delivery)\b/i

const ALLOWED_SKILL_CATEGORIES = [
  'Programming Languages',
  'Databases',
  'Frameworks and Libraries',
  'Cloud and DevOps',
  'Tools and Platforms',
  'Domain Skills',
]

/** Known technical terms to harvest from resume narrative (sorted longest-first for matching). */
const KNOWN_TECH_TERMS = [
  'oracle ebs', 'power bi', 'sql server', 'github actions', 'gitlab ci', 'google cloud', 'visual studio',
  'office 365', 'machine learning', 'data warehouse', 'rest api', 'graphql',
  'python', 'java', 'javascript', 'typescript', 'golang', 'kotlin', 'scala', 'ruby', 'php', 'matlab', 'swift',
  'sql', 'snowflake', 'redshift', 'bigquery', 'postgres', 'postgresql', 'mysql', 'mongodb', 'dynamodb',
  'oracle', 'cassandra', 'redis', 'databricks', 'synapse', 'teradata', 'hive', 'dbt',
  'react', 'angular', 'vue', 'nodejs', 'node.js', 'django', 'flask', 'spring', 'fastapi', 'express',
  'pandas', 'numpy', 'scikit-learn', 'scikit', 'tensorflow', 'pytorch', 'spark', 'hadoop', 'kafka',
  'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'jenkins', 'airflow', 'lambda', 's3', 'ec2',
  'tableau', 'looker', 'excel', 'jira', 'confluence', 'salesforce', 'sap', 'servicenow', 'splunk', 'datadog',
  'postman', 'figma', 'git', 'linux', 'windows', 'sharepoint', 'apex', 'soql', 'informatica', 'talend',
  'ssis', 'ssrs', 'powerapps', 'power automate', 'alteryx', 'qlik', 'cognos', 'microstrategy',
  'ansible', 'puppet', 'chef', 'prometheus', 'grafana', 'elasticsearch', 'kibana', 'rabbitmq',
  'agile', 'scrum', 'kanban', 'ci/cd', 'etl', 'elt',
].sort((a, b) => b.length - a.length)

/** Identity key for dedupe: case + spacing insensitive (SQL/sql, Power BI/PowerBI). */
function normalizeSkillKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/node\.js/g, 'nodejs')
    .replace(/postgresql/g, 'postgres')
    .replace(/c\+\+/g, 'cplusplus')
    .replace(/c#/g, 'csharp')
    .replace(/[^a-z0-9+#.]/g, '')
}

function isVagueSkill(skill) {
  const raw = String(skill || '').trim()
  const key = normalizeSkillKey(raw)
  if (!key || key.length < 2) return true
  if (VAGUE_SKILL_RE.test(key)) return true
  if (SOFT_SKILL_PHRASE_RE.test(raw) && !KNOWN_TECH_TERMS.some((t) => normalizeSkillKey(t) === key)) {
    return true
  }
  if (/^(dataanalyst|softwareengineer|retail|healthcare|finance|banking|consulting)$/i.test(key)) return true
  return false
}

function isLikelyTechnicalSkill(skill) {
  if (isVagueSkill(skill)) return false
  const key = normalizeSkillKey(skill)
  if (KNOWN_TECH_TERMS.some((t) => normalizeSkillKey(t) === key)) return true
  // Multi-token tools / versions / modules (e.g. "Oracle Inventory", "AWS Glue")
  if (/[A-Za-z].*\d|\d.*[A-Za-z]/.test(skill) && key.length >= 3) return true
  if (/(sql|api|sdk|etl|cicd|ci\/cd|cloud|warehouse|analytics|module|framework|library|platform)/i.test(key)) {
    return true
  }
  const wordCount = String(skill || '').trim().split(/\s+/).filter(Boolean).length
  if (wordCount >= 2 && key.length >= 4) return true
  // Short known-style tokens
  if (/^[a-z][a-z0-9+#.]{1,24}$/i.test(key) && !/^(the|and|for|with|from|into|over|under|team|work|role)$/i.test(key)) {
    if (key.length <= 3) return /^(sql|aws|gcp|etl|api|sap|git|r)$/i.test(key)
    return /[+#.]/.test(key) || KNOWN_TECH_TERMS.some((t) => normalizeSkillKey(t) === key)
  }
  return false
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resumeNarrativeText(resumeData) {
  return [
    resumeData.summary || '',
    ...((resumeData.summaryBullets || [])),
    ...((resumeData.experience || []).flatMap((job) => [
      job.title || '',
      ...(job.bullets || []),
    ])),
    ...((resumeData.projects || []).flatMap((p) => [
      p.name || p.title || '',
      ...(p.bullets || []),
      p.description || '',
    ])),
  ].join(' \n ')
}

function skillMentionedInText(skill, text) {
  const key = normalizeSkillKey(skill)
  if (!key || !text) return false
  // Allow optional whitespace between characters so "PowerBI" matches "Power BI"
  const flexible = escapeRegExp(String(skill || '').trim())
    .replace(/\\\s+/g, '\\s*')
    .replace(/\s+/g, '\\s*')
  if (flexible.length >= 2) {
    const re = new RegExp(`(?:^|[^a-z0-9+#])${flexible}(?:[^a-z0-9+#]|$)`, 'i')
    if (re.test(text)) return true
  }
  const hay = normalizeSkillKey(text)
  return key.length >= 3 && hay.includes(key)
}

function pickDisplayName(candidates) {
  const list = [...candidates].filter(Boolean)
  if (!list.length) return ''
  // Prefer mixed-case / official-looking forms over all-lowercase
  list.sort((a, b) => {
    const score = (s) => {
      let n = 0
      if (/[A-Z]/.test(s)) n += 2
      if (s.includes(' ') || s.includes('.') || s.includes('#')) n += 1
      if (s.length > 2) n += 1
      return n
    }
    return score(b) - score(a) || a.localeCompare(b)
  })
  return list[0]
}

function softMatchCategoryIndex(cats, preferredCategory) {
  return cats.findIndex((c) => {
    const name = normalizeSkillKey(c.category)
    if (preferredCategory === 'Programming Languages') return /program|language|script/.test(name)
    if (preferredCategory === 'Databases') return /database|datastor|sql|warehouse/.test(name)
    if (preferredCategory === 'Frameworks and Libraries') return /framework|librar|sdk/.test(name)
    if (preferredCategory === 'Cloud and DevOps') return /cloud|devops|infra/.test(name)
    if (preferredCategory === 'Tools and Platforms') return /tool|platform|software|application/.test(name)
    if (preferredCategory === 'Domain Skills') return /domain|analytics|business|industry|method/.test(name)
    return false
  })
}

function jdTechnicalPool(jdData) {
  return [
    ...(jdData?.requiredSkills || []),
    ...(jdData?.toolsTechnologies || []),
    ...(jdData?.preferredSkills || []),
    ...(jdData?.mustHaveKeywords || []),
  ].map((s) => String(s || '').trim()).filter(Boolean)
}

function isJdTechnicalSkill(skill, jdData) {
  const key = normalizeSkillKey(skill)
  if (!key) return false
  return jdTechnicalPool(jdData).some((s) => normalizeSkillKey(s) === key)
}

/** Keep skills that appear in resume narrative or are required by the JD (not research-only). */
function skillBelongsInIndex(skill, narrative, jdData) {
  if (isVagueSkill(skill) || !isLikelyTechnicalSkill(skill)) return false
  if (isJdTechnicalSkill(skill, jdData)) return true
  if (skillMentionedInText(skill, narrative)) return true
  return false
}

function harvestTechFromNarrative(text, knownAliases = []) {
  const found = new Map() // key -> display
  const hay = String(text || '')
  if (!hay.trim()) return found

  const catalog = [
    ...KNOWN_TECH_TERMS,
    ...knownAliases.map((s) => String(s || '').trim()).filter(Boolean),
    ...extractKnownToolsFromText(hay),
  ]
  // longest first so multi-word terms win display preference when both match
  catalog.sort((a, b) => b.length - a.length)

  for (const term of catalog) {
    const key = normalizeSkillKey(term)
    if (!key || isVagueSkill(term) || found.has(key)) continue
    if (!skillMentionedInText(term, hay)) continue
    found.set(key, pickDisplayName([found.get(key), term]))
  }
  return found
}

function collectImportantTechnicalSkills(resumeData, jdData) {
  const byKey = new Map() // key -> display name
  const narrative = resumeNarrativeText(resumeData)

  const add = (skill, { requireEvidence = true, fromJd = false } = {}) => {
    const raw = String(skill || '').trim()
    if (!raw) return
    if (isVagueSkill(raw)) return
    const looksTechnical = isLikelyTechnicalSkill(raw)
      || (fromJd && /^[A-Za-z][A-Za-z0-9+.#/\s-]{1,40}$/.test(raw) && normalizeSkillKey(raw).length >= 2)
    if (!looksTechnical) return
    if (requireEvidence && !skillBelongsInIndex(raw, narrative, jdData)) return
    const key = normalizeSkillKey(raw)
    if (!key) return
    byKey.set(key, pickDisplayName([byKey.get(key), raw]))
  }

  // Existing skill lists — keep only if used in resume or required by JD
  for (const cat of resumeData.skillCategories || []) {
    for (const s of cat.skills || []) add(s)
  }
  for (const s of [...(resumeData.skills || []), ...(resumeData.technicalSkills || [])]) add(s)

  // JD required / tools / preferred / must-have (technical only) — always index
  for (const s of jdTechnicalPool(jdData)) {
    add(s, { requireEvidence: false, fromJd: true })
  }

  // Domain keywords only when technical AND used in the resume narrative
  for (const s of jdData?.domainKeywords || []) {
    if (isLikelyTechnicalSkill(s) && skillMentionedInText(s, narrative)) {
      add(s, { requireEvidence: false })
    }
  }

  // Harvest tech terms actually used in Summary / Experience / Projects
  const knownAliases = [
    ...byKey.values(),
    ...jdTechnicalPool(jdData),
    ...(jdData?.domainKeywords || []),
  ]
  const harvested = harvestTechFromNarrative(narrative, knownAliases)
  for (const [key, display] of harvested) {
    byKey.set(key, pickDisplayName([byKey.get(key), display]))
  }

  // Also pull dictionary tools found in narrative (covers terms beyond local list)
  for (const tool of extractKnownToolsFromText(narrative)) {
    add(tool, { requireEvidence: false })
  }

  return [...byKey.values()]
}

function inferSkillCategoryName(skill) {
  const s = normalizeSkillKey(skill)
  if (!s) return 'Tools and Platforms'

  if (/^(python|java|javascript|typescript|cplusplus|csharp|go|golang|ruby|php|scala|kotlin|swift|r|sas|matlab|bash|shell|apex|soql)$/.test(s)) {
    return 'Programming Languages'
  }
  if (/^(sql|sqlserver|snowflake|redshift|bigquery|postgres|mysql|mongodb|dynamodb|oracle|cassandra|redis|databricks|synapse|teradata|hive|dbt)$/.test(s)
    || /datawarehouse|database/.test(s)) {
    return 'Databases'
  }
  if (/react|angular|vue|nodejs|django|flask|spring|fastapi|express|dotnet|rails|laravel|nextjs|pandas|numpy|scikit|tensorflow|pytorch|spark|hadoop|kafka|framework|library|sdk/.test(s)) {
    return 'Frameworks and Libraries'
  }
  if (/aws|azure|gcp|googlecloud|kubernetes|docker|terraform|jenkins|githubactions|gitlabci|cicd|devops|airflow|lambda|^s3$|^ec2$|ansible|prometheus|grafana/.test(s)
    || (/cloud/.test(s) && !/microsoft/.test(s))) {
    return 'Cloud and DevOps'
  }
  if (/tableau|powerbi|looker|excel|jira|confluence|salesforce|sap|oracleebs|servicenow|figma|postman|splunk|datadog|git|linux|windows|office|sharepoint|alteryx|qlik|cognos|informatica|talend|ssis|ssrs|powerapps|powerautomate|etl|elt|module/.test(s)) {
    return 'Tools and Platforms'
  }
  if (/agile|scrum|kanban|machinelearning|analytics|forecast|inventory|erp|crm/.test(s)) {
    return 'Domain Skills'
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

  if (skillCategories.some((c) => (c.skills || []).some((s) => normalizeSkillKey(s) === key))) {
    return skillCategories
  }

  const cats = skillCategories.map((c) => ({
    category: c.category,
    skills: [...(c.skills || [])],
  }))

  let idx = findCategoryIndex(cats, preferredCategory)
  if (idx < 0) idx = softMatchCategoryIndex(cats, preferredCategory)

  if (idx < 0 && cats.length) {
    idx = cats.findIndex((c) => /tool|platform/i.test(c.category))
    if (idx < 0) idx = 0
  }

  if (idx < 0) {
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

/**
 * Finalize Technical Skills as a complete index of technical terms used in the resume
 * plus important JD technical requirements. Never creates dump categories.
 */
function enforceJdSkills(resumeData, jdData, orderedCompanies = []) {
  const narrative = resumeNarrativeText(resumeData)

  let skillCategories = Array.isArray(resumeData.skillCategories)
    ? resumeData.skillCategories.map((c) => ({
        category: String(c.category || '').trim(),
        skills: [...(c.skills || [])].map((s) => String(s || '').trim()).filter(Boolean),
      }))
    : []

  // Drop banned dump categories; redistribute concrete skills that belong in the index
  const orphanSkills = []
  skillCategories = skillCategories.filter((c) => {
    if (BANNED_SKILL_CATEGORY_RE.test(c.category)) {
      orphanSkills.push(...(c.skills || []))
      return false
    }
    return Boolean(c.category)
  })

  // Prune research-only / soft / unsupported skills from existing categories
  skillCategories = skillCategories.map((c) => ({
    ...c,
    skills: (c.skills || []).filter((s) => skillBelongsInIndex(s, narrative, jdData)),
  }))

  for (const skill of orphanSkills) {
    if (!skillBelongsInIndex(skill, narrative, jdData) && !isJdTechnicalSkill(skill, jdData)) continue
    if (isVagueSkill(skill) || !isLikelyTechnicalSkill(skill)) continue
    skillCategories = placeSkillInCategories(skillCategories, skill, inferSkillCategoryName(skill))
  }

  skillCategories = dedupeCategorySkills(skillCategories)

  const important = collectImportantTechnicalSkills(
    { ...resumeData, skillCategories },
    jdData,
  )

  for (const skill of important) {
    skillCategories = placeSkillInCategories(
      skillCategories,
      skill,
      inferSkillCategoryName(skill),
    )
  }

  skillCategories = dedupeCategorySkills(skillCategories)
    .filter((c) => !BANNED_SKILL_CATEGORY_RE.test(c.category))
    .slice(0, 6)

  // Verify: every important technical keyword is represented exactly once
  const present = new Set(
    skillCategories.flatMap((c) => c.skills.map((s) => normalizeSkillKey(s))),
  )
  for (const skill of important) {
    const key = normalizeSkillKey(skill)
    if (!key || present.has(key)) continue
    skillCategories = placeSkillInCategories(
      skillCategories,
      skill,
      inferSkillCategoryName(skill),
    )
    present.add(key)
  }
  skillCategories = dedupeCategorySkills(skillCategories).slice(0, 6)

  // Final cross-category uniqueness check
  const globalSeen = new Set()
  skillCategories = skillCategories
    .map((c) => {
      const skills = []
      for (const skill of c.skills || []) {
        const key = normalizeSkillKey(skill)
        if (!key || globalSeen.has(key)) continue
        globalSeen.add(key)
        skills.push(skill)
      }
      return { ...c, skills }
    })
    .filter((c) => c.skills.length)

  const flatSkills = []
  const seenFlat = new Set()
  for (const raw of skillCategories.flatMap((c) => c.skills)) {
    const skill = String(raw || '').trim()
    const key = normalizeSkillKey(skill)
    if (!skill || !key || seenFlat.has(key)) continue
    seenFlat.add(key)
    flatSkills.push(skill)
  }

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

  // Final skill index is built in enforceJdSkills (and again after Experience QA).
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

    updateBuildJob(jobId, { step: 'project_memory' })
    log(jobId, 'building internal project memory per company (not shown on resume)')
    let projectMemories = []
    try {
      projectMemories = await generateJdProjectMemories(ordered, jdData, companyContexts, {
        yearsOfExperience: Number(formData.yearsOfExperience) || 0,
      })
    } catch (err) {
      log(jobId, `project memory failed (continuing): ${err.message}`)
      projectMemories = []
    }
    log(
      jobId,
      projectMemories.length
        ? `project memory ready: ${projectMemories.map((m) => `${m.company}→${m.projectName}`).join(' | ')}`
        : 'project memory: none (generation will invent silently)',
    )
    updateSession(sessionId, { projectMemories })

    updateBuildJob(jobId, { step: 'generating_content' })
    log(jobId, `generating JD-tailored content from project memories (Claude → ChatGPT → Gemini) for ${formData.name} / ${roleTitle}`)

    const aiResume = await generateResumeFromJd(
      { ...formData, companies: ordered, role: roleTitle },
      jdData,
      companyContexts,
      projectMemories,
    )
    let resumeData = mergeJdResumeWithForm(aiResume, formData, jdData, ordered)
    resumeData = stripProjectMemoryLeaks(resumeData, projectMemories)

    updateBuildJob(jobId, { step: 'qa_experience' })
    log(jobId, 'running Experience bullet quality check (selective rewrite)')
    resumeData = await improveJdExperienceBullets(resumeData, {
      jdData,
      companyContexts,
      projectMemories,
      log: (msg) => log(jobId, msg),
    })

    // Re-index Technical Skills after Experience QA so rewritten bullets are covered.
    resumeData = enforceJdSkills(resumeData, jdData, ordered)
    resumeData = stripProjectMemoryLeaks(resumeData, projectMemories)
    log(jobId, `skills finalized — ${resumeData.skillCategories?.length || 0} categories, ${(resumeData.skills || []).length} unique skills`)

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
