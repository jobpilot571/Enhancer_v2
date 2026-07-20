/**
 * Map parsed resume data → JD Basics fields (contact + education only).
 */

function splitCityState(loc) {
  const text = String(loc || '').trim()
  if (!text) return { city: '', state: '' }
  // "City, ST" or "City, State"
  const m = text.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z .]{2,})$/)
  if (m) return { city: m[1].trim(), state: m[2].trim() }
  return { city: text, state: '' }
}

function yearFromText(text) {
  const years = String(text || '').match(/\b(19|20)\d{2}\b/g)
  if (!years?.length) return ''
  return years[years.length - 1]
}

function parseEduLine(line) {
  const text = String(line || '').trim()
  if (!text) {
    return { degree: '', major: '', school: '', location: '', graduationYear: '', gpa: '' }
  }

  const gpaMatch = text.match(/\bGPA[:\s]*([0-4](?:\.\d{1,2})?)\b/i)
  const uniMatch = text.match(/([^,|–—-]+(?:University|College|Institute|School|Academy)[^,|]*)/i)
  const degreeMatch = text.match(
    /\b(B\.?\s?S\.?|B\.?\s?A\.?|B\.?\s?E\.?|B\.?\s?Tech\.?|M\.?\s?S\.?|M\.?\s?A\.?|M\.?\s?Eng\.?|MBA|Ph\.?\s?D\.?|Bachelor(?:'s)?(?:\s+of\s+[A-Za-z &]+)?|Master(?:'s)?(?:\s+of\s+[A-Za-z &]+)?|Associate(?:'s)?)\b/i,
  )
  const majorMatch = text.match(
    /(?:in|of)\s+([A-Za-z][A-Za-z &/.-]{2,40})(?=\s*[,|–—-]|\s+at\s+|\s*$)/i,
  )
  const locMatch = text.match(/,\s*([A-Za-z .]+,\s*[A-Z]{2})\b/)
    || text.match(/\b([A-Za-z .]+,\s*[A-Z]{2})\b/)

  let school = (uniMatch?.[1] || '').trim()
  let degree = (degreeMatch?.[1] || '').trim()
  let major = (majorMatch?.[1] || '').trim()
  if (major && /university|college|institute|school/i.test(major)) major = ''

  // "Degree, Major – School" patterns without "in"
  if (!major && degree) {
    const afterDegree = text.slice(text.indexOf(degreeMatch[0]) + degreeMatch[0].length)
    const m = afterDegree.match(/^[,:\s]+([A-Za-z][A-Za-z &/.-]{2,40})(?=\s*[,|–—-]|\s+at\s+)/)
    if (m && !/university|college|institute|school/i.test(m[1])) major = m[1].trim()
  }

  if (!school && !degree) {
    // Fallback: treat whole line as school if it looks institutional
    if (/university|college|institute|school/i.test(text)) school = text.split(/[|–—]/)[0].trim()
  }

  return {
    degree,
    major,
    school,
    location: (locMatch?.[1] || '').trim(),
    graduationYear: yearFromText(text),
    gpa: gpaMatch?.[1] || '',
  }
}

function mapEducationEntries(edu) {
  if (!edu) return []

  if (!Array.isArray(edu) && typeof edu === 'object') {
    const dates = String(edu.dates || edu.date || edu.endDate || edu.graduationYear || '')
    return [{
      degree: String(edu.degree || edu.degreeName || '').trim(),
      major: String(edu.major || edu.course || edu.field || '').trim(),
      school: String(edu.school || edu.institution || edu.university || '').trim(),
      location: String(edu.location || '').trim(),
      graduationYear: yearFromText(dates) || String(edu.graduationYear || edu.endDate || '').trim(),
      gpa: String(edu.gpa || '').trim(),
    }].filter((e) => e.school || e.degree || e.major)
  }

  const lines = (Array.isArray(edu) ? edu : [edu])
    .map((l) => (typeof l === 'object' && l ? null : String(l || '').trim()))
    .filter(Boolean)

  const objectEntries = (Array.isArray(edu) ? edu : [])
    .filter((l) => l && typeof l === 'object')
    .flatMap((o) => mapEducationEntries(o))

  const fromLines = lines.map(parseEduLine).filter((e) => e.school || e.degree || e.major)
  const combined = [...objectEntries, ...fromLines]

  // Dedupe near-identical schools
  const seen = new Set()
  return combined.filter((e) => {
    const key = `${e.school}|${e.degree}|${e.major}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}

function extractLinkedIn(text) {
  const m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i)
  return m?.[0] || ''
}

/**
 * @param {object} resumeData
 * @param {string} [resumeText]
 */
export function mapJdBasicsFromResume(resumeData, resumeText = '') {
  const loc = splitCityState(resumeData?.location || '')
  const education = mapEducationEntries(resumeData?.education)

  return {
    fullName: String(resumeData?.name || '').trim(),
    email: String(resumeData?.email || '').trim(),
    phone: String(resumeData?.phone || '').trim(),
    linkedin: String(resumeData?.linkedin || resumeData?.linkedIn || '').trim()
      || extractLinkedIn(resumeText),
    city: loc.city,
    state: loc.state,
    education,
  }
}
