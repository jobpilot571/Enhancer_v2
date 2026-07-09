import {
  getSession,
  updateSession,
  setEnhancedDocx,
  readFile,
} from '../store/sessionStore.js'
import { updateEnhanceJob } from '../store/enhanceJobStore.js'
import { extractResumeText } from './resumeExtract.js'
import { patchDocx, filterEnhancementPlan, buildMatchAnalysis, mergeExperienceAdditions } from './docxService.js'
import { compareResumeToJD } from './compareService.js'
import { parseResume, parseJD, createEnhancementPlan, createMissingExperienceBullets, createSummaryEnhancement } from './openaiService.js'

function log(jobId, message) {
  console.log(`[enhance:${jobId.slice(0, 8)}] ${message}`)
}

async function ensureResumeData(session) {
  if (session.resumeData) return session.resumeData
  const buffer = readFile(session.originalPath)
  const resumeText = session.resumeText || await extractResumeText(buffer, session.fileType)
  const resumeData = await parseResume(resumeText)
  updateSession(session.sessionId, { resumeText, resumeData })
  return resumeData
}

async function ensureJdData(session) {
  if (session.jdData) return session.jdData
  if (!session.jdText?.trim()) throw new Error('Job description not set')
  const jdData = await parseJD(session.jdText)
  updateSession(session.sessionId, { jdData })
  return jdData
}

export async function runEnhanceJob(jobId, sessionId, jdText) {
  try {
    const session = getSession(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.fileType !== 'docx') {
      throw new Error('Enhancement and DOCX download require a DOCX upload.')
    }

    if (jdText?.trim()) {
      updateSession(sessionId, { jdText: jdText.trim(), jdData: null })
    }

    updateEnhanceJob(jobId, { step: 'analyzing_resume', status: 'processing' })
    log(jobId, 'analyzing resume')
    const resumeData = await ensureResumeData(getSession(sessionId))

    updateEnhanceJob(jobId, { step: 'parsing_jd' })
    log(jobId, 'parsing job description')
    const jdData = await ensureJdData(getSession(sessionId))

    updateEnhanceJob(jobId, { step: 'comparing' })
    log(jobId, 'comparing skills')
    const comparison = compareResumeToJD(resumeData, jdData)

    updateEnhanceJob(jobId, { step: 'writing_plan' })
    log(jobId, 'writing enhancement plan')
    let enhancementPlan = filterEnhancementPlan(
      await createEnhancementPlan(resumeData, jdData, comparison),
      resumeData,
      comparison,
    )

    const companies = resumeData.experience || []
    const coveredCompanies = new Set([
      ...(enhancementPlan.experienceAdditions || []).map((e) => e.company?.toLowerCase()),
      ...(enhancementPlan.bulletRewrites || [])
        .filter((r) => r.company && !['summary', 'professional summary'].includes(r.company.toLowerCase()))
        .map((r) => r.company.toLowerCase()),
    ])
    const missingCompanies = companies.filter(
      (c) => c.company && !coveredCompanies.has(c.company.toLowerCase()),
    )

    if (missingCompanies.length) {
      log(jobId, `filling ${missingCompanies.length} companies missing bullets`)
      const fill = await createMissingExperienceBullets(missingCompanies, resumeData, jdData, comparison)
      enhancementPlan = filterEnhancementPlan({
        ...enhancementPlan,
        experienceAdditions: [
          ...(enhancementPlan.experienceAdditions || []),
          ...fill,
        ],
      }, resumeData, comparison)
    }

    enhancementPlan = mergeExperienceAdditions(enhancementPlan, resumeData)

    const stillMissingExp = companies.filter(
      (c) => !(enhancementPlan.experienceAdditions || []).some(
        (e) => e.company?.toLowerCase() === c.company?.toLowerCase() && e.bullets?.length,
      ),
    )
    if (stillMissingExp.length) {
      log(jobId, `retry fill for ${stillMissingExp.length} companies`)
      const retryFill = await createMissingExperienceBullets(stillMissingExp, resumeData, jdData, comparison)
      enhancementPlan = mergeExperienceAdditions(filterEnhancementPlan({
        ...enhancementPlan,
        experienceAdditions: [
          ...(enhancementPlan.experienceAdditions || []),
          ...retryFill,
        ],
      }, resumeData, comparison), resumeData)
    }

    enhancementPlan.summaryBullets = (enhancementPlan.summaryBullets || []).slice(0, 2)

    const hasSummaryAction = (enhancementPlan.summaryBullets?.length || 0) > 0
      || (enhancementPlan.bulletRewrites || []).some(
        (r) => !r.company || ['summary', 'professional summary'].includes(r.company.toLowerCase()),
      )

    if (!hasSummaryAction) {
      log(jobId, 'filling summary enhancement')
      const summaryFill = await createSummaryEnhancement(resumeData, jdData, comparison)
      enhancementPlan = filterEnhancementPlan({
        ...enhancementPlan,
        summaryBullets: [
          ...(enhancementPlan.summaryBullets || []),
          ...(summaryFill.summaryBullets || []),
        ],
        bulletRewrites: [
          ...(enhancementPlan.bulletRewrites || []),
          ...(summaryFill.bulletRewrites || []),
        ],
      }, resumeData, comparison)
    }

    updateEnhanceJob(jobId, { step: 'updating_resume' })
    log(jobId, `plan: ${enhancementPlan.summaryBullets?.length || 0} summary, ${enhancementPlan.experienceAdditions?.length || 0} companies with bullets`)
    log(jobId, 'patching DOCX')
    const originalBuffer = readFile(session.originalPath)
    const { buffer: previewBuffer, applied } = patchDocx(originalBuffer, enhancementPlan, {
      highlight: true,
      resumeData,
    })
    const { buffer: downloadBuffer } = patchDocx(originalBuffer, enhancementPlan, {
      highlight: false,
      resumeData,
    })
    setEnhancedDocx(sessionId, downloadBuffer, previewBuffer)

    log(jobId, `applied: ${applied.skills.length} skills, summary +${applied.summary.added.length}/~${applied.summary.rewritten.length}, exp additions ${Object.values(applied.experience).reduce((n, e) => n + e.added.length, 0)}`)

    updateEnhanceJob(jobId, { step: 'preparing_preview' })
    log(jobId, 'finalizing')

    const enhancedResumeData = {
      ...resumeData,
      skills: [...(resumeData.skills || []), ...applied.skills.map((s) => s.skill)],
      technicalSkills: [
        ...(resumeData.technicalSkills || []),
        ...applied.skills.map((s) => s.skill),
      ],
      summaryBullets: [
        ...(resumeData.summaryBullets || []),
        ...applied.summary.added,
      ],
    }

    const newComparison = compareResumeToJD(enhancedResumeData, jdData)
    const matchAnalysis = buildMatchAnalysis(comparison, newComparison, applied)

    updateSession(sessionId, {
      comparison: newComparison,
      comparisonBefore: comparison,
      matchAnalysis,
      enhancementPlan,
      atsScore: newComparison.atsScore,
    })

    updateEnhanceJob(jobId, {
      status: 'completed',
      step: 'preparing_preview',
      result: {
        sessionId,
        comparison: newComparison,
        comparisonBefore: comparison,
        matchAnalysis,
        enhancementPlan,
        atsScore: newComparison.atsScore,
        downloadUrl: `/api/enhancer/download/${sessionId}`,
        enhancedPreviewUrl: `/api/enhancer/file/${sessionId}/enhanced`,
      },
    })
    log(jobId, 'completed')
  } catch (err) {
    console.error(`[enhance:${jobId.slice(0, 8)}] failed:`, err.message)
    updateEnhanceJob(jobId, {
      status: 'failed',
      error: err.message || 'Enhancement failed',
    })
  }
}
