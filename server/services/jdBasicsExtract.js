/**
 * Text-first Basics extraction for JD Builder.
 * Only contact + education — never summary/experience lines.
 */

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
])

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i
const CITY_STATE_RE = /\b([A-Za-z][A-Za-z .'-]{1,35}),\s*([A-Z]{2})\b/
const BULLET_RE = /^[\u2022\u25CF\u25E6\u25AA\u25AB\u25A0\u2043\u2219\u00B7\u25B8\u25BA\u25C6*>\-–—]\s*/
const SECTION_START_RE = /^(professional\s+)?(summary|profile|objective|skills|experience|education|projects|certifications|work\s+history|technical\s+skills)\b/i

const DEGREE_RE = /\b(Master(?:'s)?(?:\s+of\s+(?:Science|Arts|Engineering|Business Administration|Education|Fine Arts))?|Bachelor(?:'s)?(?:\s+of\s+(?:Science|Arts|Engineering|Business Administration|Fine Arts))?|Associate(?:'s)?|M\.?\s?S\.?|M\.?\s?A\.?|M\.?\s?Eng\.?|M\.?\s?B\.?\s?A\.?|B\.?\s?S\.?|B\.?\s?A\.?|B\.?\s?E\.?|B\.?\s?Tech\.?|Ph\.?\s?D\.?|Ed\.?\s?D\.?|J\.?\s?D\.?|M\.?\s?D\.?)\b/i

const SCHOOL_RE = /([A-Za-z][A-Za-z &.'-]{2,80}?(?:University|College|Institute|School|Academy)(?:\s+of\s+[A-Za-z &.'-]+)?(?:\s+[A-Za-z][A-Za-z .'-]*)?)/i

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function stripBullet(line) {
  return String(line || '').replace(BULLET_RE, '').trim()
}

function isSectionHeading(line) {
  const clean = stripBullet(line).replace(/[:|]+$/, '').trim()
  if (!clean || clean.length > 48) return false
  return SECTION_START_RE.test(clean)
}

function yearFromText(text) {
  const years = String(text || '').match(/\b(19|20)\d{2}\b/g)
  if (!years?.length) return ''
  return years[years.length - 1]
}

function looksLikeJunkLocation(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (t.length > 45) return true
  if (BULLET_RE.test(t) || /^[•●]/.test(t)) return true
  if (/\b(years? of|experience|engineer|software|cloud|platform|summary|skills)\b/i.test(t)) return true
  if (EMAIL_RE.test(t) || PHONE_RE.test(t)) return true
  if (/\d{2,}/.test(t) && !CITY_STATE_RE.test(t)) return true
  return false
}

function parseCityState(raw) {
  const text = String(raw || '').trim()
  if (!text) return { city: '', state: '' }

  // Prefer City, ST even when the line also has phone/email separators
  const m = text.match(CITY_STATE_RE)
  if (m && US_STATE_CODES.has(m[2].toUpperCase())) {
    const city = m[1].trim()
    if (!looksLikeJunkLocation(city) && city.split(/\s+/).length <= 5) {
      return { city, state: m[2].toUpperCase() }
    }
  }

  // Whole-string location only if short and clean
  if (!looksLikeJunkLocation(text)) {
    const only = text.match(/^([A-Za-z][A-Za-z .'-]{1,35}),\s*([A-Z]{2})$/)
    if (only && US_STATE_CODES.has(only[2].toUpperCase())) {
      return { city: only[1].trim(), state: only[2].toUpperCase() }
    }
  }
  return { city: '', state: '' }
}

function normalizeDegree(raw) {
  let text = String(raw || '').trim()
  if (!text) return ''
  // Strip trailing dates / months glued onto degree
  text = text
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,4}\b.*$/i, '')
    .replace(/\b(19|20)\d{2}\b.*$/g, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .trim()

  const lower = text.toLowerCase().replace(/\./g, '').replace(/'/g, '')
  const map = {
    masters: "Master's",
    master: "Master's",
    masterofscience: 'M.S.',
    masterofarts: 'M.A.',
    ms: 'M.S.',
    mse: 'M.S.',
    msc: 'M.S.',
    mba: 'M.B.A.',
    masterofbusinessadministration: 'M.B.A.',
    bachelors: "Bachelor's",
    bachelor: "Bachelor's",
    bachelorofscience: 'B.S.',
    bachelorofarts: 'B.A.',
    bs: 'B.S.',
    ba: 'B.A.',
    be: 'B.E.',
    btech: 'B.Tech',
    phd: 'Ph.D.',
    doctorate: 'Ph.D.',
    associates: "Associate's",
    associate: "Associate's",
  }
  const compact = lower.replace(/\s+/g, '')
  if (map[compact]) return map[compact]
  if (map[lower]) return map[lower]

  // Prefer short canonical forms when phrase matches
  if (/master\s+of\s+science/i.test(text)) return 'M.S.'
  if (/master\s+of\s+arts/i.test(text)) return 'M.A.'
  if (/bachelor\s+of\s+science/i.test(text)) return 'B.S.'
  if (/bachelor\s+of\s+arts/i.test(text)) return 'B.A.'
  if (/^master/i.test(text)) return "Master's"
  if (/^bachelor/i.test(text)) return "Bachelor's"

  return text.slice(0, 80)
}

function extractMajor(text, degreePhrase = '') {
  const blob = String(text || '')
  // Prefer "in <field>" (not "of Science" from Master of Science)
  const inMatch = blob.match(/\bin\s+([A-Za-z][A-Za-z &/.-]{2,70})/i)
  if (inMatch) {
    let major = inMatch[1].trim()
    major = major
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\b.*$/i, '')
      .replace(/\b(19|20)\d{2}\b.*$/g, '')
      .replace(/\s*[-–—,|].*$/, '')
      .replace(/\s+at\s+.*$/i, '')
      .trim()
    // Drop degree leftovers like "Science" alone after "of Science in …" mishit
    if (/^(science|arts|engineering|business administration|fine arts)$/i.test(major)) {
      major = ''
    }
    if (major && !/university|college|mequon|wisconsin|\bcity\b|\bstate\b/i.test(major) && major.length < 80) {
      return major
    }
  }
  const fromDegree = String(degreePhrase || '').match(/\bin\s+(.+)$/i)
  if (fromDegree) {
    const major = fromDegree[1].trim()
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\b.*$/i, '')
      .replace(/\b(19|20)\d{2}\b.*$/g, '')
      .trim()
    if (major && major.length < 80 && !/university|college/i.test(major)) return major
  }
  return ''
}

function cleanSchoolName(raw) {
  let school = String(raw || '').trim()
  if (!school) return ''
  // Remove trailing city/state glued onto school
  school = school
    .replace(/,?\s*[A-Za-z .'-]{2,35},\s*[A-Z]{2}\s*$/g, '')
    .replace(/\s+(Mequon|Milwaukee|Madison|Chicago|New York|Boston|Austin|Dallas|Seattle|Denver)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Drop if it's just a city
  if (/^[A-Za-z .'-]{2,30}$/.test(school) && !/university|college|institute|school|academy/i.test(school)) {
    return ''
  }
  return school.slice(0, 120)
}

function extractEducationBlock(lines) {
  const start = lines.findIndex((l) => /^education\b/i.test(stripBullet(l).replace(/[:|]+$/, '')))
  if (start < 0) return []

  const block = []
  for (let i = start + 1; i < lines.length; i++) {
    if (isSectionHeading(lines[i]) && !/^education\b/i.test(stripBullet(lines[i]))) break
    block.push(stripBullet(lines[i]))
  }
  return block.filter(Boolean).slice(0, 20)
}

/**
 * Merge education section lines into at most 2 coherent school entries.
 */
function parseEducationFromBlock(blockLines) {
  if (!blockLines.length) return []

  const blob = blockLines.join('\n')
  const schools = []
  for (const line of blockLines) {
    const m = line.match(SCHOOL_RE)
    if (m) {
      const school = cleanSchoolName(m[1])
      if (school && !schools.some((s) => s.toLowerCase() === school.toLowerCase())) {
        schools.push(school)
      }
    }
  }

  // Single-school resume (most common): one merged entry from whole block
  if (schools.length <= 1) {
    const degreeMatch = blob.match(DEGREE_RE)
    const degreeRaw = degreeMatch?.[0] || ''
    // Capture fuller degree phrase for major extraction
    const degreeLine = blockLines.find((l) => DEGREE_RE.test(l)) || ''
    const degree = normalizeDegree(degreeRaw || degreeLine)
    const major = extractMajor(degreeLine || blob, degreeRaw)
    const loc = parseCityState(blob)
    // Prefer location from a short City, ST line
    let location = ''
    for (const line of blockLines) {
      const p = parseCityState(line)
      if (p.city && p.state) {
        location = `${p.city}, ${p.state}`
        break
      }
    }
    if (!location && loc.city && loc.state) location = `${loc.city}, ${loc.state}`

    const school = schools[0] || cleanSchoolName((blob.match(SCHOOL_RE) || [])[1] || '')
    const entry = {
      degree,
      major,
      school,
      location,
      graduationYear: yearFromText(blob),
      gpa: (blob.match(/\bGPA[:\s]*([0-4](?:\.\d{1,2})?)\b/i) || [])[1] || '',
    }
    if (entry.school || entry.degree || entry.major) return [entry]
    return []
  }

  // Multiple schools: group lines around each school mention
  const entries = []
  for (const school of schools.slice(0, 2)) {
    const idx = blockLines.findIndex((l) => l.toLowerCase().includes(school.toLowerCase().slice(0, 20)))
    const window = blockLines.slice(Math.max(0, idx - 2), idx + 3).join('\n')
    const degreeMatch = window.match(DEGREE_RE)
    const degreeLine = blockLines.slice(Math.max(0, idx - 2), idx + 3).find((l) => DEGREE_RE.test(l)) || ''
    const locLine = blockLines.slice(Math.max(0, idx - 1), idx + 3).find((l) => parseCityState(l).city)
    const loc = parseCityState(locLine || window)
    entries.push({
      degree: normalizeDegree(degreeMatch?.[0] || degreeLine),
      major: extractMajor(degreeLine || window, degreeMatch?.[0] || ''),
      school: cleanSchoolName(school),
      location: loc.city && loc.state ? `${loc.city}, ${loc.state}` : '',
      graduationYear: yearFromText(window),
      gpa: (window.match(/\bGPA[:\s]*([0-4](?:\.\d{1,2})?)\b/i) || [])[1] || '',
    })
  }
  return entries.filter((e) => e.school || e.degree)
}

function parseContactFromHeader(lines) {
  // Header = lines before first real section
  const headerEnd = lines.findIndex((l) => isSectionHeading(l))
  const headerLines = lines.slice(0, headerEnd > 0 ? headerEnd : Math.min(12, lines.length))
  const header = headerLines.join(' ')

  const email = (header.match(EMAIL_RE) || [])[0] || ''
  const phone = (header.match(PHONE_RE) || [])[0] || ''
  const linkedin = (header.match(LINKEDIN_RE) || [])[0] || ''

  let fullName = ''
  for (const line of headerLines.slice(0, 3)) {
    const t = stripBullet(line)
    if (!t || EMAIL_RE.test(t) || PHONE_RE.test(t) || LINKEDIN_RE.test(t)) continue
    if (isSectionHeading(t)) continue
    if (CITY_STATE_RE.test(t) && t.length < 40) continue
    if (/^https?:\/\//i.test(t)) continue
    if (t.length >= 2 && t.length <= 60 && /[A-Za-z]/.test(t)) {
      fullName = t.replace(/\s{2,}/g, ' ').trim()
      break
    }
  }

  let city = ''
  let state = ''
  for (const line of headerLines) {
    const loc = parseCityState(line)
    if (loc.city && loc.state) {
      city = loc.city
      state = loc.state
      break
    }
  }

  return { fullName, email, phone, linkedin, city, state }
}

/**
 * Primary entry: parse plain resume text → Basics fields only.
 */
export function extractJdBasicsFromText(resumeText) {
  const lines = normalizeLines(resumeText)
  const contact = parseContactFromHeader(lines)
  const eduBlock = extractEducationBlock(lines)
  const education = parseEducationFromBlock(eduBlock)

  return {
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    linkedin: contact.linkedin,
    city: contact.city,
    state: contact.state,
    education,
  }
}

function isPlausibleCity(city) {
  const t = String(city || '').trim()
  if (!t || looksLikeJunkLocation(t)) return false
  if (t.split(/\s+/).length > 5) return false
  return true
}

function sanitizeBasics(basics) {
  const out = {
    fullName: String(basics?.fullName || '').trim().slice(0, 120),
    email: String(basics?.email || '').trim().slice(0, 160),
    phone: String(basics?.phone || '').trim().slice(0, 40),
    linkedin: String(basics?.linkedin || '').trim(),
    city: '',
    state: '',
    education: [],
  }

  if (/linkedin\.com/i.test(out.linkedin) || out.linkedin.length > 12) {
    out.linkedin = out.linkedin.replace(/^https?:\/\//i, '').slice(0, 200)
  } else {
    out.linkedin = ''
  }

  const loc = parseCityState(
    basics?.city && basics?.state
      ? `${basics.city}, ${basics.state}`
      : (basics?.city || ''),
  )
  if (loc.city && loc.state && isPlausibleCity(loc.city)) {
    out.city = loc.city
    out.state = loc.state
  } else if (US_STATE_CODES.has(String(basics?.state || '').toUpperCase()) && isPlausibleCity(basics?.city)) {
    out.city = String(basics.city).trim()
    out.state = String(basics.state).toUpperCase()
  }

  const edu = Array.isArray(basics?.education) ? basics.education : []
  out.education = edu
    .map((e) => ({
      degree: normalizeDegree(e.degree),
      major: String(e.major || '').trim()
        .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\b.*$/i, '')
        .trim()
        .slice(0, 80),
      school: cleanSchoolName(e.school),
      location: (() => {
        const p = parseCityState(e.location || '')
        return p.city && p.state ? `${p.city}, ${p.state}` : ''
      })(),
      graduationYear: yearFromText(e.graduationYear || e.dates || '') || String(e.graduationYear || '').replace(/\D/g, '').slice(0, 4),
      gpa: String(e.gpa || '').trim().slice(0, 8),
    }))
    .filter((e) => {
      // Drop junk rows (city-as-major, school-less noise)
      if (!e.school && !e.degree) return false
      if (e.major && /^(mequon|madison|milwaukee|chicago|remote)$/i.test(e.major)) return false
      if (e.major && !e.school && !e.degree && e.major.length < 20) return false
      return Boolean(e.school || e.degree)
    })
    // Prefer one entry when schools overlap / second is fragment
    .slice(0, 2)

  if (out.education.length === 2) {
    const [a, b] = out.education
    const sameSchool = a.school && b.school
      && (a.school.toLowerCase().includes(b.school.toLowerCase().slice(0, 12))
        || b.school.toLowerCase().includes(a.school.toLowerCase().slice(0, 12)))
    const bIsFragment = !b.degree && (!b.major || b.major.length < 12)
    if (sameSchool || bIsFragment) {
      out.education = [{
        degree: a.degree || b.degree,
        major: a.major || b.major,
        school: a.school.length >= b.school.length ? a.school : b.school,
        location: a.location || b.location,
        graduationYear: a.graduationYear || b.graduationYear,
        gpa: a.gpa || b.gpa,
      }]
    }
  }

  return out
}

/**
 * Map structured resumeData + raw text → sanitized Basics.
 * Prefers text-first education/contact; uses structured data only to fill gaps.
 */
export function mapJdBasicsFromResume(resumeData, resumeText = '') {
  const fromText = extractJdBasicsFromText(resumeText)

  // Structured contact as backup only
  const structuredLoc = parseCityState(resumeData?.location || '')
  const structured = {
    fullName: String(resumeData?.name || '').trim(),
    email: String(resumeData?.email || '').trim(),
    phone: String(resumeData?.phone || '').trim(),
    linkedin: String(resumeData?.linkedin || resumeData?.linkedIn || '').trim(),
    city: structuredLoc.city,
    state: structuredLoc.state,
    education: [],
  }

  // Structured education objects only (ignore raw line arrays — they create phantom entries)
  const edu = resumeData?.education
  if (edu && !Array.isArray(edu) && typeof edu === 'object') {
    structured.education = [{
      degree: edu.degree || edu.degreeName || '',
      major: edu.major || edu.course || edu.field || '',
      school: edu.school || edu.institution || edu.university || '',
      location: edu.location || '',
      graduationYear: edu.graduationYear || edu.endDate || edu.dates || '',
      gpa: edu.gpa || '',
    }]
  } else if (Array.isArray(edu) && edu.some((e) => e && typeof e === 'object' && !Array.isArray(e))) {
    structured.education = edu
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        degree: e.degree || e.degreeName || '',
        major: e.major || e.course || e.field || '',
        school: e.school || e.institution || e.university || '',
        location: e.location || '',
        graduationYear: e.graduationYear || e.endDate || e.dates || '',
        gpa: e.gpa || '',
      }))
  }

  const merged = {
    fullName: fromText.fullName || structured.fullName,
    email: fromText.email || structured.email,
    phone: fromText.phone || structured.phone,
    linkedin: fromText.linkedin || structured.linkedin,
    city: fromText.city || structured.city,
    state: fromText.state || structured.state,
    // Prefer text-parsed education (merged). Structured only if text found nothing.
    education: fromText.education.length ? fromText.education : structured.education,
  }

  return sanitizeBasics(merged)
}

export { sanitizeBasics, extractEducationBlock, parseEducationFromBlock }
