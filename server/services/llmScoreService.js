import { structuredJSON } from './aiProvider.js'

/**
 * LLM JD-match scoring (Groq / Ollama preferred).
 * Complements the local 40/40/20 scorer for ATS-friendly / readability / attractiveness.
 */

const LLM_SCORE_SCHEMA = {
  type: 'object',
  properties: {
    atsScore: { type: 'number' },
    atsFriendly: { type: 'number' },
    readability: { type: 'number' },
    attractiveness: { type: 'number' },
    jdMatchLabel: { type: 'string' },
    rationale: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'atsScore',
    'atsFriendly',
    'readability',
    'attractiveness',
    'jdMatchLabel',
    'rationale',
    'strengths',
    'gaps',
  ],
  additionalProperties: false,
}

function clampScore(n, min = 0, max = 99) {
  const x = Number(n)
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, Math.round(x)))
}

function compactResume(resumeData) {
  return {
    summary: String(resumeData?.summary || '').slice(0, 500),
    summaryBullets: (resumeData?.summaryBullets || []).slice(0, 6),
    skills: [...new Set([
      ...(resumeData?.skills || []),
      ...(resumeData?.technicalSkills || []),
    ])].slice(0, 40),
    experience: (resumeData?.experience || []).slice(0, 6).map((e) => ({
      company: e.company,
      title: e.title,
      bullets: (e.bullets || []).slice(0, 8),
    })),
  }
}

function compactJd(jdData) {
  return {
    roleTitle: jdData?.roleTitle || '',
    requiredSkills: (jdData?.requiredSkills || []).slice(0, 20),
    preferredSkills: (jdData?.preferredSkills || []).slice(0, 10),
    tools: (jdData?.toolsTechnologies || []).slice(0, 20),
    domainKeywords: (jdData?.domainKeywords || []).slice(0, 15),
    responsibilities: (jdData?.responsibilities || []).slice(0, 12),
  }
}

/**
 * Score enhanced (or original) resume vs JD with Groq/Ollama-first LLM.
 * @returns {Promise<object|null>}
 */
export async function scoreResumeWithLlm({
  resumeData,
  jdData,
  localAtsScore = 0,
  phase = 'after',
} = {}) {
  const local = clampScore(localAtsScore, 0, 100)
  try {
    const { result, provider, model, promptTokens, completionTokens, durationMs, costUsd } =
      await structuredJSON(
        `You are an ATS + recruiter scoring engine for resume–JD fit.
Score the resume against the job description.

Return JSON only:
- atsScore: 0–99 overall ATS selection likelihood for THIS JD
- atsFriendly: 0–100 how well the resume parses for ATS (keywords, skills lists, clear sections, no fluff)
- readability: 0–100 clarity and scannability for humans
- attractiveness: 0–100 how compelling the experience story looks for this JD
- jdMatchLabel: one of "Excellent Match","Strong Match","Good Match","Fair Match","Needs Work"
- rationale: 1–2 short sentences
- strengths: up to 4 short bullets
- gaps: up to 3 short remaining gaps (empty array if none)

Scoring guidance for phase="${phase}":
- Before enhancement: be realistic; typical mid resumes land 55–75.
- After enhancement: if JD skills, tools, keywords, and responsibilities are substantially covered across experience + skills, score atsScore in 85–99.
- If coverage is still thin, score honestly below 85.
- Local deterministic score hint is ${local}/100 — you may go higher or lower based on qualitative JD fit, but stay consistent with coverage.
- Do not invent resume content; score only what is present.`,
        JSON.stringify({
          phase,
          localAtsScore: local,
          jd: compactJd(jdData),
          resume: compactResume(resumeData),
        }),
        'llm_ats_score',
        LLM_SCORE_SCHEMA,
        {
          maxTokens: 900,
          preferProviders: ['groq', 'ollama'],
        },
      )

    console.log(
      `[AI] llm_ats_score(${phase}) via ${provider}/${model} `
      + `in=${promptTokens} out=${completionTokens} ${durationMs}ms $${costUsd}`,
    )

    const atsScore = clampScore(result.atsScore, 0, 99)
    return {
      atsScore,
      atsFriendly: clampScore(result.atsFriendly, 0, 100),
      readability: clampScore(result.readability, 0, 100),
      attractiveness: clampScore(result.attractiveness, 0, 100),
      jdMatchLabel: String(result.jdMatchLabel || '').trim() || 'Good Match',
      rationale: String(result.rationale || '').trim(),
      strengths: (result.strengths || []).map(String).filter(Boolean).slice(0, 4),
      gaps: (result.gaps || []).map(String).filter(Boolean).slice(0, 3),
      provider,
      model,
      localAtsScore: local,
    }
  } catch (err) {
    console.warn(`[AI] llm_ats_score(${phase}) failed: ${err.message}`)
    return null
  }
}

/**
 * Merge local deterministic score with LLM score for the displayed ATS score.
 * Enhanced resumes bias toward strong JD selection when coverage improved.
 */
export function mergeAtsScores({
  localScore,
  llmScore,
  phase = 'after',
  coverageBoost = false,
} = {}) {
  const local = clampScore(localScore, 0, 100)
  if (!llmScore || !Number.isFinite(Number(llmScore.atsScore))) {
    if (phase === 'after' && coverageBoost) {
      // Soft floor when we aggressively added JD coverage but LLM unavailable
      return clampScore(Math.max(local, Math.min(88, local + 12)), 0, 99)
    }
    return clampScore(local, 0, 99)
  }

  const llm = clampScore(llmScore.atsScore, 0, 99)
  if (phase === 'before') {
    // Prefer local for before; blend lightly so UI stays stable
    return clampScore(Math.round(local * 0.7 + llm * 0.3), 0, 99)
  }

  // After: take the stronger of local vs LLM, with a selection-oriented floor when boosted
  let merged = Math.max(local, llm)
  if (coverageBoost && merged < 85) {
    merged = Math.max(merged, Math.min(90, Math.max(local, llm) + 8))
  }
  return clampScore(merged, 0, 99)
}
