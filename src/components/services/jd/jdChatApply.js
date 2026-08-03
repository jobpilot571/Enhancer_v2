import { emptyEducation, emptyExperience, defaultBulletCountForCompanyIndex, newId } from './jdProjectModel'

/**
 * Merge assistant projectUpdates into the JD wizard project.
 */
export function applyJdChatProjectUpdates(project, updates) {
  if (!updates || typeof updates !== 'object') return project
  const next = { ...project }

  if (updates.basicInformation && typeof updates.basicInformation === 'object') {
    const b = { ...(next.basicInformation || {}), ...updates.basicInformation }
    if (!Array.isArray(b.education) || !b.education.length) {
      b.education = (next.basicInformation?.education?.length
        ? next.basicInformation.education
        : [emptyEducation()])
    }
    next.basicInformation = b
  }

  if (updates.targetRole && typeof updates.targetRole === 'object') {
    next.targetRole = { ...(next.targetRole || {}), ...updates.targetRole }
  }

  if (Array.isArray(updates.experiences)) {
    const list = updates.experiences.slice(0, 6).map((e, i) => {
      const prev = (next.experiences || [])[i]
      return {
        ...emptyExperience(i),
        ...(prev || {}),
        companyName: String(e.companyName ?? prev?.companyName ?? ''),
        jobTitle: String(e.jobTitle ?? prev?.jobTitle ?? ''),
        city: String(e.city ?? prev?.city ?? ''),
        state: String(e.state ?? prev?.state ?? ''),
        startDate: String(e.startDate ?? prev?.startDate ?? ''),
        endDate: String(e.endDate ?? prev?.endDate ?? ''),
        summary: String(e.summary ?? prev?.summary ?? ''),
        country: String(e.country ?? prev?.country ?? ''),
        bulletCount: String(
          e.bulletCount
          || prev?.bulletCount
          || defaultBulletCountForCompanyIndex(i),
        ),
        id: prev?.id || newId('exp'),
      }
    })
    next.experiences = list.length ? list : [emptyExperience(0)]
    next.targetRole = {
      ...(next.targetRole || {}),
      companyCount: String(next.experiences.length),
    }
  }

  if (updates.selectedTemplateId) {
    next.selectedTemplateId = String(updates.selectedTemplateId)
  }
  if (updates.fontFamily) next.fontFamily = String(updates.fontFamily)
  if (updates.fontSizePt != null && updates.fontSizePt !== '') {
    next.fontSizePt = String(updates.fontSizePt)
  }
  if (typeof updates.keywordHighlight === 'boolean') {
    next.keywordHighlight = updates.keywordHighlight
  }

  next.updatedAt = new Date().toISOString()
  return next
}
