export function compareResumeToJD(resumeData, jdData) {
  const resumeSkills = new Set([
    ...(resumeData.skills || []),
    ...(resumeData.technicalSkills || []),
  ].map((s) => s.toLowerCase().trim()))

  const resumeText = JSON.stringify(resumeData).toLowerCase()

  const jdSkills = [
    ...(jdData.requiredSkills || []),
    ...(jdData.preferredSkills || []),
    ...(jdData.toolsTechnologies || []),
    ...(jdData.mustHaveKeywords || []),
    ...(jdData.domainKeywords || []),
  ]

  const present = []
  const missing = []
  const strong = []
  const weak = []
  const seen = new Set()

  for (const skill of jdSkills) {
    const lower = skill.toLowerCase().trim()
    if (!lower || seen.has(lower)) continue
    seen.add(lower)

    const inSkills = resumeSkills.has(lower)
      || [...resumeSkills].some((s) => s.includes(lower) || lower.includes(s))
    const inText = resumeText.includes(lower)
    const count = (resumeText.match(new RegExp(lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length

    if (inSkills || inText) {
      present.push(skill)
      if (count >= 2) strong.push(skill)
      else weak.push(skill)
    } else {
      missing.push(skill)
    }
  }

  const mustHave = jdData.mustHaveKeywords || []
  const missingMustHave = mustHave.filter((k) => !present.some((p) => p.toLowerCase().includes(k.toLowerCase())))

  const total = jdSkills.filter(Boolean).length || 1
  const score = Math.round(((present.length / total) * 70 + (strong.length / total) * 30))

  return {
    present,
    missing,
    strong,
    weak,
    missingMustHave,
    missingResponsibilities: (jdData.responsibilities || []).filter((r) => {
      const key = r.toLowerCase().slice(0, 40)
      return !resumeText.includes(key.slice(0, 20))
    }),
    atsScore: Math.min(score, 100),
  }
}
