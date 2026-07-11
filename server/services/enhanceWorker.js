import {
  getSession,
  updateSession,
  setEnhancedDocx,
  readFile,
} from '../store/sessionStore.js'
import { updateEnhanceJob } from '../store/enhanceJobStore.js'
import { patchDocx, filterEnhancementPlan, buildMatchAnalysis, mergeExperienceAdditions, keepSummaryBullets, ensureSkillsInBullets, detectSummaryFormat } from './docxService.js'
import { ensureEnhancedResumeQuality } from './resumeQaService.js'
import { compareResumeToJD, buildEnhancedResumeData } from './compareService.js'
import { createEnhancementPlan, createMissingExperienceBullets, createSummaryEnhancement } from './openaiService.js'
import { ensureResumeData, ensureJdData } from './sessionPrepare.js'
import { beginAiUsageTracking, endAiUsageTracking } from './aiProvider.js'
import PizZip from 'pizzip'

function log(jobId, message) {
  console.log(`[enhance:${jobId.slice(0, 8)}] ${message}`)
}

export async function runEnhanceJob(jobId, sessionId, jdText) {
  beginAiUsageTracking()
  const startedAt = Date.now()
  try {
    const session = getSession(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.fileType !== 'docx') {
      throw new Error('Enhancement and DOCX download require a DOCX upload.')
    }

    // Only invalidate JD cache when text actually changed
    if (jdText?.trim()) {
      const trimmed = jdText.trim()
      if (session.jdText?.trim() !== trimmed) {
        updateSession(sessionId, { jdText: trimmed, jdData: null, jdParseError: null })
      } else if (!session.jdText) {
        updateSession(sessionId, { jdText: trimmed })
      }
    }

    const fresh = getSession(sessionId)
    const resumeReady = !!fresh.resumeData
    const jdReady = !!fresh.jdData

    if (resumeReady && jdReady) {
      updateEnhanceJob(jobId, { step: 'comparing', status: 'processing' })
      log(jobId, 'using cached resume + JD parse')
    } else if (resumeReady) {
      updateEnhanceJob(jobId, { step: 'parsing_jd', status: 'processing' })
      log(jobId, 'resume cached — parsing JD')
    } else if (jdReady) {
      updateEnhanceJob(jobId, { step: 'analyzing_resume', status: 'processing' })
      log(jobId, 'JD cached — analyzing resume')
    } else {
      updateEnhanceJob(jobId, { step: 'analyzing_resume', status: 'processing' })
      log(jobId, 'analyzing resume + JD in parallel')
    }

    // Parallel when both needed; shared inflight promises if precompute already running
    const [resumeData, jdData] = await Promise.all([
      ensureResumeData(sessionId),
      ensureJdData(sessionId),
    ])

    // Detect summary style from original DOCX (paragraph vs bullets) — DOCX is source of truth
    const originalBufferForFormat = readFile(getSession(sessionId).originalPath)
    const summaryFormat = detectSummaryFormat(new PizZip(originalBufferForFormat).file('word/document.xml').asText())
    resumeData.summaryFormat = summaryFormat
    if (summaryFormat === 'paragraph' && !(resumeData.summary || '').trim()) {
      // Prefer prose field when parser put paragraph text into summaryBullets
      if ((resumeData.summaryBullets || []).length === 1) {
        resumeData.summary = resumeData.summaryBullets[0]
        resumeData.summaryBullets = []
      } else if ((resumeData.summaryBullets || []).length > 1) {
        resumeData.summary = resumeData.summaryBullets.join(' ')
        resumeData.summaryBullets = []
      }
    }
    updateSession(sessionId, { resumeData })
    log(jobId, `summary format: ${summaryFormat}`)

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

    enhancementPlan = mergeExperienceAdditions(enhancementPlan, resumeData)
    enhancementPlan.summaryBullets = (enhancementPlan.summaryBullets || []).slice(0, 2)

    const companies = resumeData.experience || []
    const missingCompanies = companies.filter(
      (c) => !(enhancementPlan.experienceAdditions || []).some(
        (e) => e.company?.toLowerCase() === c.company?.toLowerCase() && e.bullets?.length,
      ),
    )
    const hasSummaryAction = (enhancementPlan.summaryBullets?.length || 0) > 0
      || (enhancementPlan.bulletRewrites || []).some(
        (r) => !r.company || ['summary', 'professional summary'].includes(r.company.toLowerCase()),
      )

    // Repair only when coverage is incomplete — skip extra AI calls when plan is already good
    const needsRepair = missingCompanies.length > 0 || !hasSummaryAction
    if (needsRepair) {
      log(
        jobId,
        `repair pass: ${missingCompanies.length} companies, summary=${hasSummaryAction ? 'ok' : 'needed'}`,
      )

      const [companyFill, summaryFill] = await Promise.all([
        missingCompanies.length
          ? createMissingExperienceBullets(missingCompanies, resumeData, jdData, comparison)
          : Promise.resolve([]),
        hasSummaryAction
          ? Promise.resolve(null)
          : createSummaryEnhancement(resumeData, jdData, comparison),
      ])

      if (companyFill.length) {
        enhancementPlan = mergeExperienceAdditions(filterEnhancementPlan({
          ...enhancementPlan,
          experienceAdditions: [
            ...(enhancementPlan.experienceAdditions || []),
            ...companyFill,
          ],
        }, resumeData, comparison), resumeData)
      }

      if (summaryFill) {
        const mergedSummary = keepSummaryBullets([
          ...(enhancementPlan.summaryBullets || []),
          ...(summaryFill.summaryBullets || []),
        ], resumeData, 2)

        const rewriteCandidates = [
          ...(enhancementPlan.bulletRewrites || []),
          ...(summaryFill.bulletRewrites || []),
        ]

        let summaryBullets = mergedSummary
        if (!summaryBullets.length) {
          const fromRewrites = keepSummaryBullets(
            (summaryFill.bulletRewrites || [])
              .filter((r) => {
                const c = (r.company || '').toLowerCase()
                return !c || c === 'summary' || c === 'professional summary'
              })
              .map((r) => r.replacement)
              .filter(Boolean),
            resumeData,
            2,
          )
          summaryBullets = fromRewrites
        }

        enhancementPlan = filterEnhancementPlan({
          ...enhancementPlan,
          summaryBullets,
          bulletRewrites: rewriteCandidates,
        }, resumeData, comparison)

        if (!enhancementPlan.summaryBullets?.length && summaryBullets.length) {
          enhancementPlan.summaryBullets = summaryBullets
        }
      }
    } else {
      log(jobId, 'skipping repair pass — plan already covers summary + companies')
    }

    // Final safety: if summary still empty but plan had rewrite-only summary, leave as-is;
    // if we somehow lost summary after filter, log it clearly
    if (!(enhancementPlan.summaryBullets?.length) && !(enhancementPlan.bulletRewrites || []).some((r) => {
      const c = (r.company || '').toLowerCase()
      return !c || c === 'summary' || c === 'professional summary'
    })) {
      log(jobId, 'warning: no summary actions after plan/repair')
    }

    // Ensure missing JD skills are on the skills list AND mentioned in bullets
    enhancementPlan = filterEnhancementPlan(enhancementPlan, resumeData, comparison)
    enhancementPlan = ensureSkillsInBullets(enhancementPlan)

    updateEnhanceJob(jobId, { step: 'updating_resume' })
    log(jobId, `plan: ${enhancementPlan.summaryBullets?.length || 0} summary, ${enhancementPlan.experienceAdditions?.length || 0} companies with bullets, ${enhancementPlan.skillsToAdd?.length || 0} skills`)
    log(jobId, 'patching DOCX')
    const originalBuffer = readFile(session.originalPath)

    // One patch with highlights, then QA gate + auto-repair before download
    const { buffer: patchedPreview, applied } = patchDocx(originalBuffer, enhancementPlan, {
      highlight: true,
      resumeData,
    })

    updateEnhanceJob(jobId, { step: 'preparing_preview' })
    log(jobId, 'qa checking enhanced resume')
    const qaResult = ensureEnhancedResumeQuality(
      originalBuffer,
      patchedPreview,
      resumeData,
      {
        maxAttempts: 2,
        log: (msg) => log(jobId, msg),
      },
    )
    let previewBuffer = qaResult.buffer
    if (qaResult.repaired) {
      log(jobId, `qa auto-repaired: ${qaResult.history.slice(1).map((h) => (h.actions || []).join('+')).join(' | ')}`)
    }
    if (!qaResult.qa.ok) {
      log(jobId, `qa warning: remaining defects ${qaResult.qa.defects.map((d) => d.code).join(', ')}`)
    } else {
      log(jobId, 'qa: enhanced resume verified')
    }

    const downloadZip = new PizZip(previewBuffer)
    const downloadXml = downloadZip.file('word/document.xml').asText()
      .replace(/<w:shd[^/]*\/>/g, '')
    downloadZip.file('word/document.xml', downloadXml)
    const downloadBuffer = downloadZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    setEnhancedDocx(sessionId, downloadBuffer, previewBuffer)

    log(jobId, `applied: ${applied.skills.length} skills, summary +${applied.summary.added.length}/~${applied.summary.rewritten.length}, exp additions ${Object.values(applied.experience).reduce((n, e) => n + e.added.length, 0)}`)

    log(jobId, 'finalizing')

    const enhancedResumeData = buildEnhancedResumeData(resumeData, applied)

    const newComparison = compareResumeToJD(enhancedResumeData, jdData, { applied })
    const aiUsage = endAiUsageTracking()
    const processingMeta = {
      durationMs: Date.now() - startedAt,
      durationSec: Math.round((Date.now() - startedAt) / 100) / 10,
      aiUsage,
      scoringEngine: 'JoBPilot Deterministic Resume-to-JD Scorer v2.0',
    }
    const matchAnalysis = buildMatchAnalysis(comparison, newComparison, applied, processingMeta)

    log(
      jobId,
      `ATS before=${comparison.atsScore} after=${newComparison.atsScore} `
      + `(skills ${comparison.scoreBreakdown?.skills?.score ?? '?'}→${newComparison.scoreBreakdown?.skills?.score ?? '?'}, `
      + `exp ${comparison.scoreBreakdown?.bullets?.score ?? '?'}→${newComparison.scoreBreakdown?.bullets?.score ?? '?'}, `
      + `kw ${comparison.scoreBreakdown?.keywords?.score ?? '?'}→${newComparison.scoreBreakdown?.keywords?.score ?? '?'}) `
      + `AI=${aiUsage.primaryProvider || 'n/a'}`,
    )

    updateSession(sessionId, {
      comparison: newComparison,
      comparisonBefore: comparison,
      matchAnalysis,
      enhancementPlan,
      atsScore: newComparison.atsScore,
      processingMeta,
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
        processingMeta,
        downloadUrl: `/api/enhancer/download/${sessionId}`,
        scoreReportPdfUrl: `/api/enhancer/score-report/${sessionId}`,
        enhancedPreviewUrl: `/api/enhancer/file/${sessionId}/enhanced`,
      },
    })
    log(jobId, 'completed')
  } catch (err) {
    endAiUsageTracking()
    console.error(`[enhance:${jobId.slice(0, 8)}] failed:`, err.message)
    updateEnhanceJob(jobId, {
      status: 'failed',
      error: err.message || 'Enhancement failed',
    })
  }
}
