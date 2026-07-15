/**
 * Map extracted resumeData into Resume Builder form suggestions +
 * reference bullets the AI can weave into the generated DOCX.
 */

function splitDates(raw) {
  const text = String(raw || '').trim()
  if (!text) return { startDate: '', endDate: '' }
  const parts = text.split(/\s*[–—−‒-]\s*|\s+to\s+/i).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { startDate: parts[0], endDate: /present|current|now/i.test(parts[1]) ? '' : parts[1] }
  }
  return { startDate: text, endDate: '' }
}

function splitCityState(loc) {
  const text = String(loc || '').trim()
  if (!text) return { city: '', state: '' }
  const m = text.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z .]+)$/)
  if (m) return { city: m[1].trim(), state: m[2].trim() }
  return { city: text, state: '' }
}

function parseEducation(resumeData) {
  const edu = resumeData?.education
  const empty = { school: '', course: '', degree: '', startDate: '', endDate: '' }
  if (!edu) return empty

  // AI / structured object
  if (!Array.isArray(edu) && typeof edu === 'object') {
    const dates = splitDates(edu.dates || edu.date || '')
    return {
      school: String(edu.school || edu.institution || edu.university || '').trim(),
      course: String(edu.course || edu.field || edu.major || '').trim(),
      degree: String(edu.degree || edu.degreeName || '').trim(),
      startDate: String(edu.startDate || dates.startDate || '').trim(),
      endDate: String(edu.endDate || dates.endDate || '').trim(),
    }
  }

  // Local parser often returns string lines
  const lines = (Array.isArray(edu) ? edu : [edu])
    .map((l) => String(l || '').trim())
    .filter(Boolean)
  if (!lines.length) return empty

  const first = lines[0]
  // e.g. "B.S. Computer Science – State University, 2016 – 2020"
  const uniMatch = first.match(/([^,|–—-]+(?:University|College|Institute|School)[^,|]*)/i)
  const degreeMatch = first.match(/\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|MBA|Ph\.?D\.?|Bachelor[^,|]*|Master[^,|]*)\b/i)
  const dates = splitDates(first)

  return {
    school: (uniMatch?.[1] || '').trim(),
    course: '',
    degree: (degreeMatch?.[1] || '').trim(),
    startDate: dates.startDate,
    endDate: dates.endDate,
  }
}

function guessYears(experience) {
  if (!experience?.length) return ''
  // Prefer explicit "X+ years" from summary elsewhere; leave blank unless obvious
  return ''
}

/**
 * @param {object} resumeData
 * @param {{ fileName?: string }} [meta]
 */
export function mapResumeToBuilderSuggestions(resumeData, meta = {}) {
  const experience = Array.isArray(resumeData?.experience) ? resumeData.experience : []
  const companies = experience.slice(0, 6).map((exp) => {
    const dates = splitDates(exp.dates || exp.date || '')
    const loc = splitCityState(exp.location || exp.city || '')
    return {
      name: String(exp.company || '').trim(),
      role: String(exp.title || exp.role || '').trim(),
      startDate: dates.startDate,
      endDate: dates.endDate,
      city: loc.city,
      state: loc.state,
      skills: [],
      referenceBullets: (exp.bullets || [])
        .map((b) => String(b || '').trim())
        .filter(Boolean)
        .slice(0, 15),
    }
  })

  const summaryBullets = [
    ...(resumeData?.summaryBullets || []),
    ...(resumeData?.summary
      ? String(resumeData.summary).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 40)
      : []),
  ]
    .map((b) => String(b || '').trim())
    .filter(Boolean)
    .slice(0, 12)

  const skills = [...new Set([
    ...(resumeData?.skills || []),
    ...(resumeData?.technicalSkills || []),
    ...((resumeData?.skillCategories || []).flatMap((c) => c.skills || [])),
  ].map((s) => String(s || '').trim()).filter(Boolean))]

  // Spread top skills across companies as a starting point
  if (skills.length && companies.length) {
    const per = Math.max(3, Math.ceil(skills.length / companies.length))
    companies.forEach((c, i) => {
      c.skills = skills.slice(i * per, i * per + per).slice(0, 10)
    })
  }

  const education = parseEducation(resumeData)
  const bulletCount = companies.reduce((n, c) => n + (c.referenceBullets?.length || 0), 0)

  return {
    fileName: meta.fileName || 'reference.docx',
    stats: {
      companies: companies.length,
      bullets: bulletCount,
      summaryLines: summaryBullets.length,
      skills: skills.length,
    },
    formPatch: {
      name: String(resumeData?.name || '').trim(),
      email: String(resumeData?.email || '').trim(),
      phone: String(resumeData?.phone || '').trim(),
      linkedin: String(resumeData?.linkedin || resumeData?.linkedIn || '').trim(),
      role: String(resumeData?.title || resumeData?.role || experience[0]?.title || '').trim(),
      yearsOfExperience: guessYears(experience),
      companyCount: String(Math.max(1, companies.length) || 1),
      companies: companies.map(({ referenceBullets, ...rest }) => rest),
      education,
      summaryNotes: summaryBullets.join('\n'),
    },
    referenceMaterial: {
      fileName: meta.fileName || 'reference.docx',
      summaryBullets,
      experience: companies.map((c) => ({
        company: c.name,
        title: c.role,
        bullets: c.referenceBullets || [],
      })),
      skills,
    },
  }
}
