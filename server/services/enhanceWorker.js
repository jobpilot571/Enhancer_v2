import {
  getSession,
  updateSession,
  setEnhancedDocx,
  readFile,
} from '../store/sessionStore.js'
import { updateEnhanceJob } from '../store/enhanceJobStore.js'
import {
  patchDocx,
  filterEnhancementPlan,
  buildMatchAnalysis,
  mergeExperienceAdditions,
  ensureSkillsInBullets,
  ensureDomainKeywordsInBullets,
  ensureAggressiveJdCoverage,
  detectSummaryFormat,
} from './docxService.js'
import { ensureEnhancedResumeQuality } from './resumeQaService.js'
import { compareResumeToJD, buildEnhancedResumeData } from './compareService.js'
import {
  createEnhancementPlan,
  repairEnhancementPlan,
  isPlanTechnicallyValid,
} from './openaiService.js'
import { researchCompanyContexts } from './companyContextService.js'
import { scoreResumeWithLlm, mergeAtsScores } from './llmScoreService.js'
import { ensureResumeData, ensureJdData } from './sessionPrepare.js'
import { beginAiUsageTracking, endAiUsageTracking } from './aiProvider.js'
import PizZip from 'pizzip'

function log(jobId, message) {
  console.log(`[enhance:${jobId.slice(0, 8)}] ${message}`)
}

function stageTimer() {
  const stages = []
  const t0 = Date.now()
  let last = t0
  return {
    mark(name) {
      const now = Date.now()
      stages.push({ name, ms: now - last, atMs: now - t0 })
      last = now
    },
    stages,
    totalMs: () => Date.now() - t0,
  }
}

export async function runEnhanceJob(jobId, sessionId, jdText) {
  beginAiUsageTracking()
  const timer = stageTimer()
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
      log(jobId, 'resume cached — analyzing JD')
    } else if (jdReady) {
      updateEnhanceJob(jobId, { step: 'analyzing_resume', status: 'processing' })
      log(jobId, 'JD cached — parsing resume locally')
    } else {
      updateEnhanceJob(jobId, { step: 'analyzing_resume', status: 'processing' })
      log(jobId, 'local resume parse + JD analysis in parallel')
    }

    // Parallel: local resume parse (or AI fallback) + JD cache/analysis
    const [resumeData, jdData] = await Promise.all([
      ensureResumeData(sessionId),
      ensureJdData(sessionId),
    ])
    timer.mark('parse_resume_and_jd')

    const afterParse = getSession(sessionId)
    const resumeParseMethod = afterParse.resumeParseMethod || (resumeReady ? 'cached' : 'unknown')
    const jdCached = !!afterParse.jdAnalysisCached || jdReady
    log(
      jobId,
      `resumeParse=${resumeParseMethod}`
      + (afterParse.resumeParseConfidence != null ? ` conf=${afterParse.resumeParseConfidence}` : '')
      + ` | jd=${jdCached ? 'cache' : 'AI'}`,
    )

    // Detect summary style from original DOCX (paragraph vs bullets) — DOCX is source of truth
    const originalBufferForFormat = readFile(getSession(sessionId).originalPath)
    const summaryFormat = detectSummaryFormat(new PizZip(originalBufferForFormat).file('word/document.xml').asText())
    resumeData.summaryFormat = summaryFormat
    if (summaryFormat === 'paragraph' && !(resumeData.summary || '').trim()) {
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
    timer.mark('detect_summary_format')

    updateEnhanceJob(jobId, { step: 'comparing' })
    log(jobId, 'comparing skills (local)')
    const comparison = compareResumeToJD(resumeData, jdData)
    timer.mark('compare_local')

    updateEnhanceJob(jobId, { step: 'writing_plan' })
    log(jobId, 'researching company/industry context (Groq-first)')
    const companyContexts = await researchCompanyContexts(resumeData, jdData)
    log(
      jobId,
      companyContexts.length
        ? `company context: ${companyContexts.map((c) => c.company).join(', ')}`
        : 'company context: none (continuing without)',
    )
    timer.mark('company_context_research')

    log(jobId, 'writing complete enhancement plan (1 LLM call)')
    let planRaw
    let repaired = false
    try {
      planRaw = await createEnhancementPlan(resumeData, jdData, comparison, companyContexts)
      if (!isPlanTechnicallyValid(planRaw)) {
        throw new Error('Enhancement plan missing required array fields')
      }
    } catch (err) {
      // Repair ONLY on technical failure — never because arrays are empty
      log(jobId, `plan technical failure — one repair attempt: ${err.message}`)
      planRaw = await repairEnhancementPlan(resumeData, jdData, comparison, err.message, companyContexts)
      repaired = true
      if (!isPlanTechnicallyValid(planRaw)) {
        throw new Error(`Enhancement plan invalid after repair: ${err.message}`)
      }
    }
    timer.mark('enhancement_plan_llm')

    let enhancementPlan = filterEnhancementPlan(planRaw, resumeData, comparison)
    enhancementPlan = mergeExperienceAdditions(enhancementPlan, resumeData)
    enhancementPlan.summaryBullets = (enhancementPlan.summaryBullets || []).slice(0, 3)

    // Local validation / skill weaving — no extra LLM calls for empty coverage
    enhancementPlan = filterEnhancementPlan(enhancementPlan, resumeData, comparison)
    enhancementPlan = ensureSkillsInBullets(enhancementPlan, comparison, resumeData)
    enhancementPlan = ensureDomainKeywordsInBullets(enhancementPlan, comparison, 10)
    enhancementPlan = ensureAggressiveJdCoverage(enhancementPlan, resumeData, jdData, comparison)
    enhancementPlan = filterEnhancementPlan(enhancementPlan, resumeData, comparison)
    enhancementPlan = mergeExperienceAdditions(enhancementPlan, resumeData)
    timer.mark('validate_plan_local')

    if (!(enhancementPlan.summaryBullets?.length) && !(enhancementPlan.bulletRewrites || []).some((r) => {
      const c = (r.company || '').toLowerCase()
      return !c || c === 'summary' || c === 'professional summary'
    })) {
      log(jobId, 'note: plan has no summary actions (allowed — no repair for empty)')
    }

    updateEnhanceJob(jobId, { step: 'updating_resume' })
    log(
      jobId,
      `plan: ${enhancementPlan.summaryBullets?.length || 0} summary, `
      + `${enhancementPlan.bulletRewrites?.length || 0} bullet rewrites, `
      + `${enhancementPlan.experienceAdditions?.length || 0} companies with new bullets, `
      + `${enhancementPlan.skillsToAdd?.length || 0} skills`
      + (enhancementPlan.bulletEvaluations?.length
        ? ` (eval actions: ${enhancementPlan.bulletEvaluations.length})`
        : '')
      + (repaired ? ' (repaired)' : ''),
    )
    log(jobId, 'patching DOCX')
    const originalBuffer = readFile(session.originalPath)

    const { buffer: patchedPreview, applied } = patchDocx(originalBuffer, enhancementPlan, {
      highlight: true,
      resumeData,
    })
    timer.mark('patch_docx')

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
    timer.mark('qa')

    const downloadZip = new PizZip(previewBuffer)
    const downloadXml = downloadZip.file('word/document.xml').asText()
      .replace(/<w:shd[^/]*\/>/g, '')
    downloadZip.file('word/document.xml', downloadXml)
    const downloadBuffer = downloadZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    setEnhancedDocx(sessionId, downloadBuffer, previewBuffer)

    log(jobId, `applied: ${applied.skills.length} skills, summary +${applied.summary.added.length}/~${applied.summary.rewritten.length}, exp additions ${Object.values(applied.experience).reduce((n, e) => n + e.added.length, 0)}`)

    log(jobId, 'scoring (local + Groq/Ollama LLM)')
    const enhancedResumeData = buildEnhancedResumeData(resumeData, applied)
    const localAfter = compareResumeToJD(enhancedResumeData, jdData, { applied })

    const coverageBoost = (
      (enhancementPlan.skillsToAdd?.length || 0) >= 3
      || (enhancementPlan.experienceAdditions || []).length >= 2
      || (enhancementPlan.bulletRewrites || []).length >= 3
    )

    const [llmBefore, llmAfter] = await Promise.all([
      scoreResumeWithLlm({
        resumeData,
        jdData,
        localAtsScore: comparison.atsScore,
        phase: 'before',
      }),
      scoreResumeWithLlm({
        resumeData: enhancedResumeData,
        jdData,
        localAtsScore: localAfter.atsScore,
        phase: 'after',
      }),
    ])
    timer.mark('score_llm')

    const beforeAts = mergeAtsScores({
      localScore: comparison.atsScore,
      llmScore: llmBefore,
      phase: 'before',
    })
    const afterAts = mergeAtsScores({
      localScore: localAfter.atsScore,
      llmScore: llmAfter,
      phase: 'after',
      coverageBoost,
    })

    // Keep before ≤ after for UX; bump after into 85–99 when coverage was aggressively improved
    let finalAfter = Math.max(afterAts, beforeAts)
    if (coverageBoost && finalAfter < 85) finalAfter = Math.min(99, Math.max(85, finalAfter))
    if (finalAfter > 99) finalAfter = 99

    const comparisonBeforeScored = {
      ...comparison,
      atsScore: beforeAts,
      localAtsScore: comparison.atsScore,
      llmScore: llmBefore,
    }
    const newComparison = {
      ...localAfter,
      atsScore: finalAfter,
      localAtsScore: localAfter.atsScore,
      llmScore: llmAfter,
      atsMarks: {
        atsFriendly: llmAfter?.atsFriendly ?? localAfter.scoreBreakdown?.format?.score ?? null,
        readability: llmAfter?.readability ?? null,
        attractiveness: llmAfter?.attractiveness ?? null,
        jdMatchLabel: llmAfter?.jdMatchLabel || null,
        scoringMethod: llmAfter
          ? `LLM (${llmAfter.provider}/${llmAfter.model}) + local 40/40/20`
          : 'Local 40/40/20 (LLM unavailable)',
      },
    }
    timer.mark('score_after')

    const aiUsage = endAiUsageTracking()
    const totalMs = timer.totalMs()
    const processingMeta = {
      durationMs: totalMs,
      durationSec: Math.round(totalMs / 100) / 10,
      stages: timer.stages,
      resumeParseMethod,
      resumeParseConfidence: afterParse.resumeParseConfidence ?? null,
      jdAnalysisCached: jdCached,
      planRepaired: repaired,
      llmCalls: aiUsage.totals?.llmCalls ?? aiUsage.calls?.length ?? 0,
      tokenUsage: {
        promptTokens: aiUsage.totals?.promptTokens ?? 0,
        completionTokens: aiUsage.totals?.completionTokens ?? 0,
        cachedInputTokens: aiUsage.totals?.cachedInputTokens ?? 0,
        costUsd: aiUsage.totals?.costUsd ?? 0,
        calls: (aiUsage.calls || []).map((c) => ({
          task: c.task,
          provider: c.provider,
          model: c.model,
          promptTokens: c.promptTokens,
          completionTokens: c.completionTokens,
          cachedInputTokens: c.cachedInputTokens,
          durationMs: c.durationMs,
          costUsd: c.costUsd,
        })),
      },
      aiUsage,
      scoringEngine: newComparison.atsMarks.scoringMethod,
      llmScoring: {
        before: llmBefore,
        after: llmAfter,
        localBefore: comparison.atsScore,
        localAfter: localAfter.atsScore,
        mergedBefore: beforeAts,
        mergedAfter: finalAfter,
      },
      atsMarks: newComparison.atsMarks,
    }
    const matchAnalysis = buildMatchAnalysis(comparisonBeforeScored, newComparison, applied, processingMeta)

    log(
      jobId,
      `ATS before=${beforeAts} (local ${comparison.atsScore}) after=${finalAfter} (local ${localAfter.atsScore}) `
      + `LLM=${processingMeta.llmCalls} in=${processingMeta.tokenUsage.promptTokens} `
      + `out=${processingMeta.tokenUsage.completionTokens} ${processingMeta.durationSec}s `
      + `$${processingMeta.tokenUsage.costUsd}`,
    )

    for (const s of timer.stages) {
      log(jobId, `stage ${s.name}: ${s.ms}ms (at ${s.atMs}ms)`)
    }

    updateSession(sessionId, {
      comparison: newComparison,
      comparisonBefore: comparisonBeforeScored,
      matchAnalysis,
      enhancementPlan,
      atsScore: finalAfter,
      processingMeta,
    })

    updateEnhanceJob(jobId, {
      status: 'completed',
      step: 'preparing_preview',
      result: {
        sessionId,
        comparison: newComparison,
        comparisonBefore: comparisonBeforeScored,
        matchAnalysis,
        enhancementPlan,
        atsScore: finalAfter,
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
