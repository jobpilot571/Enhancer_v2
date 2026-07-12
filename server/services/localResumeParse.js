/**
 * Deterministic local resume parser.
 * Returns { data, confidence 0–1, method: 'local' }.
 */

const SECTION_ALIASES = [
  { key: 'summary', patterns: [/^(professional\s+)?summary\b/i, /^profile\b/i, /^objective\b/i, /^about\s+me\b/i] },
  { key: 'skills', patterns: [/^(technical\s+)?skills\b/i, /^core\s+competenc/i, /^technologies\b/i, /^tools\b/i, /^expertise\b/i] },
  { key: 'experience', patterns: [/^(professional\s+|work\s+|relevant\s+)?experience\b/i, /^employment\b/i, /^work\s+history\b/i] },
  { key: 'education', patterns: [/^education\b/i, /^academic\b/i, /^degrees?\b/i] },
  { key: 'projects', patterns: [/^projects?\b/i, /^key\s+projects\b/i] },
  { key: 'certifications', patterns: [/^certifications?\b/i, /^licenses?\b/i] },
]

const DATE_RANGE_RE = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4})\s*[-–—to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}|Present|Current|Now)/i
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/
// Common Word/DOCX bullet glyphs (• ● ▪ ▸ – etc.)
const BULLET_RE = /^[\u2022\u25CF\u25E6\u25AA\u25AB\u25A0\u2043\u2219\u00B7\u25B8\u25BA\u25C6*>\-*–—]\s*/

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function detectSection(line) {
  const clean = line.replace(/[:|]+$/, '').trim()
  if (clean.length > 48) return null
  for (const section of SECTION_ALIASES) {
    if (section.patterns.some((p) => p.test(clean))) return section.key
  }
  return null
}

function isLikelyHeading(line) {
  if (!line || line.length > 60) return false
  if (detectSection(line)) return true
  if (/^[A-Z][A-Za-z0-9 &/()+-]{2,40}$/.test(line) && line === line.toUpperCase() && line.split(' ').length <= 5) {
    return true
  }
  return false
}

function stripBullet(line) {
  return line.replace(BULLET_RE, '').trim()
}

function parseContact(lines) {
  const header = lines.slice(0, 8).join(' ')
  const email = (header.match(EMAIL_RE) || [])[0] || ''
  const phone = (header.match(PHONE_RE) || [])[0] || ''
  let name = lines[0] || ''
  if (EMAIL_RE.test(name) || PHONE_RE.test(name) || detectSection(name)) name = ''
  if (name.length > 60) name = name.slice(0, 60)
  let location = ''
  for (const line of lines.slice(0, 6)) {
    if (/,\s*[A-Z]{2}\b/.test(line) || /\b(USA|United States|India|Remote)\b/i.test(line)) {
      if (!EMAIL_RE.test(line) && !PHONE_RE.test(line) && line !== name) {
        location = line
        break
      }
    }
  }
  return { name, email, phone, location }
}

function splitSections(lines) {
  const sections = {}
  let current = 'header'
  sections.header = []
  for (const line of lines) {
    const key = detectSection(line)
    if (key) {
      current = key
      if (!sections[current]) sections[current] = []
      continue
    }
    if (!sections[current]) sections[current] = []
    sections[current].push(line)
  }
  return sections
}

function parseSkills(lines) {
  const skills = []
  const categories = []
  for (const line of lines || []) {
    const cleaned = stripBullet(line)
    const catMatch = cleaned.match(/^([^:]{2,40}):\s*(.+)$/)
    if (catMatch) {
      const category = catMatch[1].trim()
      const items = catMatch[2].split(/[,|/•]+/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40)
      categories.push({ category, skills: items })
      skills.push(...items)
      continue
    }
    const items = cleaned.split(/[,|/•]+/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40)
    if (items.length >= 2) skills.push(...items)
    else if (cleaned.length > 1 && cleaned.length < 40) skills.push(cleaned)
  }
  return {
    skills: [...new Set(skills)],
    categories,
  }
}

function parseSummary(lines) {
  const bullets = []
  const prose = []
  for (const line of lines || []) {
    if (BULLET_RE.test(line) || /^[-*]\s+/.test(line)) bullets.push(stripBullet(line))
    else prose.push(line)
  }
  if (bullets.length >= 2) {
    return { summary: prose.join(' ') || bullets.slice(0, 2).join(' '), summaryBullets: bullets }
  }
  return { summary: prose.join(' ').trim() || bullets.join(' '), summaryBullets: [] }
}

function looksLikeJobTitle(text) {
  return /\b(analyst|engineer|developer|manager|consultant|specialist|architect|director|lead|intern|associate|coordinator|scientist|designer|administrator)\b/i.test(text)
}

function parseExperience(lines) {
  const experience = []
  let current = null
  let pendingTitleDates = null // { title, dates } waiting for company line

  const flush = () => {
    if (current && (current.company || current.title || current.bullets.length)) {
      experience.push(current)
    }
    current = null
    pendingTitleDates = null
  }

  for (const line of lines || []) {
    const dateMatch = line.match(DATE_RANGE_RE)
    if (dateMatch && !BULLET_RE.test(line)) {
      flush()
      const before = line.replace(DATE_RANGE_RE, '').replace(/[|•·\t]/g, ' ').trim()
      let company = ''
      let title = ''
      if (/\bat\b/i.test(before)) {
        const parts = before.split(/\bat\b/i)
        title = parts[0].trim()
        company = parts.slice(1).join(' at ').trim()
      } else if (/[-–—|,]/.test(before)) {
        const parts = before.split(/\s*[-–—|,]\s*/)
        if (parts.length >= 2) {
          title = parts[0].trim()
          company = parts.slice(1).join(' - ').trim()
        } else {
          title = before
        }
      } else {
        title = before
      }

      const dates = `${dateMatch[1]} - ${dateMatch[2]}`

      // Classic DOCX layout: "Title <tab> Dates" then next line is company
      if (title && !company && looksLikeJobTitle(title)) {
        pendingTitleDates = { title, dates }
        current = {
          company: '',
          title,
          dates,
          bullets: [],
        }
        continue
      }

      current = {
        company: company || title || 'Unknown Company',
        title: company ? title : (looksLikeJobTitle(title) ? title : ''),
        dates,
        bullets: [],
      }
      if (!company && title && !looksLikeJobTitle(title)) {
        current.company = title
        current.title = ''
      }
      continue
    }

    // Company line immediately after title+dates header
    if (
      pendingTitleDates
      && current
      && !current.company
      && !BULLET_RE.test(line)
      && !dateMatch
      && line.length < 90
      && !isLikelyHeading(line)
    ) {
      current.company = line.split(/\s*[|–—]\s*/)[0].trim() || line
      pendingTitleDates = null
      continue
    }

    // Company-only or title-only line before bullets when no date on same line
    if (!BULLET_RE.test(line) && current && !current.bullets.length && !dateMatch) {
      if (!current.title && line.length < 80) {
        current.title = line
        continue
      }
      if (!current.company && line.length < 80) {
        current.company = line
        continue
      }
    }

    if (!current) {
      if (!BULLET_RE.test(line) && line.length < 90 && !isLikelyHeading(line)) {
        current = { company: line, title: '', dates: '', bullets: [] }
      }
      continue
    }

    if (
      BULLET_RE.test(line)
      || /^[-*]\s+/.test(line)
      || (line.length > 40 && current.bullets.length)
      // Plain paragraph bullets (no glyph) after a job header
      || (line.length > 55 && !dateMatch && !isLikelyHeading(line) && !looksLikeJobTitle(line.slice(0, 60)))
    ) {
      const bullet = stripBullet(line)
      if (bullet) current.bullets.push(bullet)
    }
  }
  flush()
  return experience.filter((e) => e.company || e.bullets.length)
}

function parseEducation(lines) {
  return (lines || []).map((l) => stripBullet(l)).filter(Boolean)
}

function parseProjects(lines) {
  return (lines || []).map((l) => stripBullet(l)).filter(Boolean)
}

/**
 * @param {string} resumeText
 * @returns {{ data: object, confidence: number, method: 'local', signals: object }}
 */
export function parseResumeLocally(resumeText) {
  const lines = normalizeLines(resumeText)
  const contact = parseContact(lines)
  const sections = splitSections(lines)
  const summary = parseSummary(sections.summary || [])
  const skillInfo = parseSkills(sections.skills || [])
  const experience = parseExperience(sections.experience || [])
  const education = parseEducation(sections.education || [])
  const projects = parseProjects(sections.projects || [])
  const certifications = parseEducation(sections.certifications || [])
  const headings = Object.keys(sections).filter((k) => k !== 'header')

  const data = {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    location: contact.location,
    summary: summary.summary,
    summaryBullets: summary.summaryBullets,
    skills: skillInfo.skills,
    technicalSkills: skillInfo.skills.slice(),
    skillCategories: skillInfo.categories,
    headings,
    experience,
    projects,
    education,
    certifications,
    allSections: headings,
  }

  let score = 0
  const signals = {}
  if (data.name) { score += 0.1; signals.name = true }
  if (data.email || data.phone) { score += 0.1; signals.contact = true }
  if (data.summary || data.summaryBullets.length) { score += 0.15; signals.summary = true }
  if (data.skills.length >= 3) { score += 0.2; signals.skills = true }
  else if (data.skills.length) { score += 0.1; signals.skills = 'partial' }
  if (experience.length >= 1) { score += 0.15; signals.experience = true }
  if (experience.some((e) => (e.bullets || []).length >= 2)) { score += 0.2; signals.bullets = true }
  if (experience.some((e) => e.dates)) { score += 0.05; signals.dates = true }
  if (education.length) { score += 0.05; signals.education = true }

  // Companies found but zero bullets → parser missed body text; force AI fallback
  const totalBullets = experience.reduce((n, e) => n + (e.bullets || []).length, 0)
  if (experience.length >= 1 && totalBullets === 0) {
    score = Math.min(score, 0.55)
    signals.bullets = 'missing'
  }

  const confidence = Math.max(0, Math.min(1, Math.round(score * 100) / 100))

  return {
    data,
    confidence,
    method: 'local',
    signals,
  }
}
