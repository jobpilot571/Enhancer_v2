import { useCallback, useEffect, useRef, useState } from 'react'
import DocumentPreview from './DocumentPreview'
import {
  uploadResume,
  startEnhance,
  waitForEnhance,
  getEnhanceStepLabel,
  fetchFileBlob,
  getDownloadUrl,
  checkApiHealth,
  setJD,
} from '../../api/enhancer'

function ScoreRing({ score, label = 'your score', gradId = 'scoreGrad' }) {
  const pct = Math.min(100, Math.max(0, Number(score) || 0))
  const circumference = 326.7
  const offset = circumference - (circumference * pct) / 100
  return (
    <div className="score-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        <circle
          cx="60" cy="60" r="52" fill="none" stroke={`url(#${gradId})`} strokeWidth="9"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 60 60)"
        />
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#16c784" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>
      <div className="score-ring__text">
        <span className="score-ring__value">{score ?? '—'}</span>
        <span className="score-ring__label">{label}</span>
      </div>
    </div>
  )
}

function ScoreDetailPanel({ breakdown, active }) {
  if (!breakdown || !active) return null
  const pillar = breakdown[active]
  const details = breakdown.details?.[active] || []
  if (!pillar) return null

  return (
    <div className="score-detail-panel">
      <div className="score-detail-panel__meta">
        {active === 'bullets'
          ? `Avg coverage ${pillar.pct}% · ${pillar.matched}/${pillar.total} responsibilities covered (≥35%)`
          : `${pillar.matched}/${pillar.total} matched · ${pillar.pct}% · contributes ~${pillar.score} pts`}
      </div>
      <ul className="score-detail-panel__list">
        {details.map((row) => (
          <li
            key={row.item}
            className={`score-detail-panel__item ${row.matched ? 'is-matched' : 'is-missing'}`}
          >
            <span className="score-detail-panel__status">
              {row.matched ? (row.strong ? 'strong' : active === 'bullets' ? `${row.coverage}%` : 'match') : 'missing'}
            </span>
            <span className="score-detail-panel__text">{row.item}</span>
          </li>
        ))}
        {!details.length && (
          <li className="score-detail-panel__item is-empty">No JD items in this category</li>
        )}
      </ul>
    </div>
  )
}

function AtsScoreCard({
  badge,
  title,
  desc,
  score,
  label,
  gradId,
  breakdown,
  delta,
  activeTab,
  onTabChange,
}) {
  const tabs = [
    { key: 'skills', label: 'Skills' },
    { key: 'keywords', label: 'Keywords' },
    { key: 'bullets', label: 'Bullets' },
  ]

  return (
    <article className="feature-result-card">
      <div className="feature-result-card__body">
        <span className="feature-result-card__badge">{badge}</span>
        <h3 className="feature-result-card__title">{title}</h3>
        <p className="feature-result-card__desc">{desc}</p>
        {typeof delta === 'number' && delta > 0 && (
          <div className="feature-result-card__stats">
            <span className="feature-result-card__pill">+{delta} pts</span>
          </div>
        )}
        <div className="score-tab-row" role="tablist" aria-label={`${title} sections`}>
          {tabs.map((tab) => {
            const p = breakdown?.[tab.key]
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`score-tab-btn ${activeTab === tab.key ? 'is-active' : ''}`}
                onClick={() => onTabChange(activeTab === tab.key ? null : tab.key)}
              >
                <span className="score-tab-btn__label">{tab.label}</span>
                <span className="score-tab-btn__meta">
                  {p ? `${p.matched}/${p.total || 0} · ${p.pct}%` : '—'}
                </span>
              </button>
            )
          })}
        </div>
        <ScoreDetailPanel breakdown={breakdown} active={activeTab} />
      </div>
      <div className="feature-result-card__visual">
        <ScoreRing score={score} label={label} gradId={gradId} />
      </div>
    </article>
  )
}

function UploadPanel({ label, sublabel, icon, children, onUpload, accept, uploading }) {
  const inputRef = useRef(null)
  return (
    <div className="upload-box">
      <div className="upload-box__header">
        <div className="upload-box__label-group">
          <span className="upload-box__icon">{icon}</span>
          <div>
            <h4 className="upload-box__label">{label}</h4>
            {sublabel && <p className="upload-box__sublabel">{sublabel}</p>}
          </div>
        </div>
        {onUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="upload-box__input-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUpload(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="upload-box__action"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
      </div>
      <div className="upload-box__content upload-box__content--docx">{children}</div>
    </div>
  )
}

export default function ResumeEnhancer() {
  const [sessionId, setSessionId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [fileType, setFileType] = useState(null)
  const [jdText, setJdText] = useState('')
  const [originalBlob, setOriginalBlob] = useState(null)
  const [enhancedBlob, setEnhancedBlob] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [comparisonBefore, setComparisonBefore] = useState(null)
  const [matchAnalysis, setMatchAnalysis] = useState(null)
  const [enhancementPlan, setEnhancementPlan] = useState(null)
  const [atsScore, setAtsScore] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [step, setStep] = useState('idle')
  const [enhanceStep, setEnhanceStep] = useState('')
  const [error, setError] = useState('')
  const [apiOnline, setApiOnline] = useState(null)
  const [jdPrepStatus, setJdPrepStatus] = useState('')
  const [beforeTab, setBeforeTab] = useState(null)
  const [afterTab, setAfterTab] = useState(null)
  const enhancingRef = useRef(false)
  const jdSaveTimerRef = useRef(null)
  const lastSavedJdRef = useRef('')

  useEffect(() => {
    checkApiHealth().then((result) => {
      setApiOnline(result.ok)
      if (!result.ok) {
        setError(result.error || 'Resume API is not reachable. Deploy the backend and set VITE_API_BASE in Vercel.')
      }
    })
  }, [])

  // Step 1 speed-up: save JD shortly after paste so server can parse it before Enhance
  useEffect(() => {
    if (!sessionId || !jdText.trim()) {
      setJdPrepStatus('')
      return undefined
    }
    if (jdText.trim() === lastSavedJdRef.current) return undefined

    setJdPrepStatus('Preparing job description…')
    clearTimeout(jdSaveTimerRef.current)
    jdSaveTimerRef.current = setTimeout(async () => {
      const text = jdText.trim()
      try {
        await setJD(sessionId, text)
        lastSavedJdRef.current = text
        setJdPrepStatus('Job description ready')
      } catch {
        setJdPrepStatus('')
        // Non-blocking — enhance still sends JD and will parse if needed
      }
    }, 800)

    return () => clearTimeout(jdSaveTimerRef.current)
  }, [sessionId, jdText])

  const handleUpload = useCallback(async (file) => {
    const lower = file.name.toLowerCase()
    const isDocx = lower.endsWith('.docx')
    const isPdf = lower.endsWith('.pdf')
    if (!isDocx && !isPdf) {
      setError('Please upload a .docx or .pdf resume.')
      return
    }

    setError('')
    setFileName(file.name)
    setFileType(isPdf ? 'pdf' : 'docx')
    setOriginalBlob(file)
    setEnhancedBlob(null)
    setComparison(null)
    setComparisonBefore(null)
    setMatchAnalysis(null)
    setEnhancementPlan(null)
    setAtsScore(null)
    setSessionId(null)
    lastSavedJdRef.current = ''
    setJdPrepStatus('')
    setUploading(true)
    setStep('uploading')

    try {
      const result = await uploadResume(file)
      setSessionId(result.sessionId)
      if (result.fileName) setFileName(result.fileName)
      if (result.fileType) setFileType(result.fileType)
      setStep('uploaded')
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }, [])

  const handleEnhance = async () => {
    if (enhancingRef.current) return
    if (!sessionId) {
      setError('Upload a resume first.')
      return
    }
    if (!jdText.trim()) {
      setError('Paste a job description first.')
      return
    }
    if (fileType === 'pdf') {
      setError('Enhancement and DOCX download require a DOCX upload. PDF preview is supported.')
      return
    }

    enhancingRef.current = true
    setError('')
    setEnhancing(true)
    setStep('enhancing')
    setEnhanceStep('analyzing_resume')

    try {
      // Flush pending JD save so enhance can reuse precomputed parse
      clearTimeout(jdSaveTimerRef.current)
      if (jdText.trim() && jdText.trim() !== lastSavedJdRef.current) {
        try {
          await setJD(sessionId, jdText.trim())
          lastSavedJdRef.current = jdText.trim()
        } catch {
          // enhance still carries jdText
        }
      }

      const { jobId } = await startEnhance(sessionId, jdText)
      const result = await waitForEnhance(jobId, (status) => {
        if (status.step) setEnhanceStep(status.step)
      })

      setComparison(result.comparison)
      setMatchAnalysis({
        ...(result.matchAnalysis || {}),
        beforeBreakdown: result.matchAnalysis?.beforeBreakdown
          || result.beforeBreakdown
          || result.comparisonBefore?.scoreBreakdown
          || null,
        afterBreakdown: result.matchAnalysis?.afterBreakdown
          || result.afterBreakdown
          || result.comparison?.scoreBreakdown
          || null,
      })
      setEnhancementPlan(result.enhancementPlan)
      setAtsScore(result.atsScore)
      if (result.comparisonBefore) {
        setComparisonBefore(result.comparisonBefore)
      }

      const enhanced = await fetchFileBlob(sessionId, 'enhanced')
      setEnhancedBlob(enhanced)
      setStep('done')
    } catch (err) {
      setError(err.message)
      setStep('uploaded')
    } finally {
      enhancingRef.current = false
      setEnhancing(false)
      setEnhanceStep('')
    }
  }

  const results = matchAnalysis || (comparison ? {
    beforeScore: comparisonBefore?.atsScore ?? null,
    afterScore: atsScore,
    scoreDelta: (atsScore ?? 0) - (comparisonBefore?.atsScore ?? 0),
    beforeBreakdown: comparisonBefore?.scoreBreakdown || null,
    afterBreakdown: comparison?.scoreBreakdown || null,
    keywordsMatched: comparison.present || [],
    keywordsStrong: comparison.strong || [],
    keywordsWeak: comparison.weak || [],
    keywordsStillMissing: comparison.missing || [],
    addedKeywords: [],
    addedBullets: [],
    addedToResume: { skills: [], summary: { added: [], rewritten: [] }, experience: {} },
  } : null)
  const addedFromResults = results?.addedToResume
  const addedSkills = addedFromResults?.skills || results?.skillsAdded || []
  const addedBullets = results?.addedBullets || []
  const addedKeywords = results?.addedKeywords || []
  // Prefer explicit breakdowns from matchAnalysis (production-safe)
  const beforeBreakdown = results?.beforeBreakdown
    || comparisonBefore?.scoreBreakdown
    || null
  const afterBreakdown = results?.afterBreakdown
    || comparison?.scoreBreakdown
    || null
  const showResults = step === 'done' && comparison && results

  useEffect(() => {
    if (showResults) {
      requestAnimationFrame(() => {
        document.getElementById('enhancement-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [showResults])

  const canEnhance = sessionId && jdText.trim() && fileType === 'docx'

  return (
    <div className="service-block service-block--workspace">
      <div className="service-block__header">
        <span className="service-block__num">01</span>
        <div>
          <h3 className="service-block__title">AI Resume Enhancer</h3>
          <p className="service-block__desc">
            Upload your resume (DOCX or PDF), paste a job description, and get an ATS-optimized DOCX that preserves your original formatting.
          </p>
        </div>
      </div>

      {error && <div className="enhancer-error">{error}</div>}

      {apiOnline === false && !error && (
        <div className="enhancer-notice enhancer-notice--warn">
          Resume API is offline. Deploy the backend (Render/Railway) and set <code>VITE_API_BASE</code> in Vercel.
        </div>
      )}

      {fileType === 'pdf' && sessionId && (
        <div className="enhancer-notice">
          PDF preview is supported. Upload a DOCX file to enable enhancement and DOCX download.
        </div>
      )}

      <div className="service-section">
        <div className="resume-enhancer-workspace">
          <UploadPanel
            label="Upload Resume"
            sublabel={fileName || 'DOCX or PDF'}
            uploading={uploading}
            accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
            onUpload={handleUpload}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            }
          >
            <DocumentPreview blob={originalBlob} fileType={fileType} />
          </UploadPanel>

          <div className="upload-box">
            <div className="upload-box__header">
              <div className="upload-box__label-group">
                <span className="upload-box__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="9" x2="15" y2="9" />
                    <line x1="9" y1="13" x2="15" y2="13" />
                    <line x1="9" y1="17" x2="12" y2="17" />
                  </svg>
                </span>
                <div>
                  <h4 className="upload-box__label">Paste Job Description</h4>
                  <p className="upload-box__sublabel">
                    {jdPrepStatus || 'JD preview shown below'}
                  </p>
                </div>
              </div>
            </div>
            <div className="upload-box__content upload-box__content--jd">
              <textarea
                className="jd-textarea"
                placeholder="Paste the full job description here…"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="service-cta-row">
          <button
            type="button"
            className="btn btn--primary btn--xl"
            disabled={uploading || enhancing || !canEnhance}
            onClick={handleEnhance}
          >
            {enhancing ? (
              <>
                <span className="btn-spinner" />
                {getEnhanceStepLabel(enhanceStep)}
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Enhance Resume
              </>
            )}
          </button>
        </div>

        {enhancing && (
          <p className="enhancer-progress">{getEnhanceStepLabel(enhanceStep)}</p>
        )}
      </div>

      {comparison && (
        <div className="service-section">
          <h4 className="comparison-title">Before & After Comparison</h4>
          <p className="comparison-legend">
            <span className="comparison-legend__item comparison-legend__item--green">Green = newly added</span>
            <span className="comparison-legend__item comparison-legend__item--yellow">Yellow = rewritten</span>
          </p>
          <div className="resume-enhancer-workspace">
            <div className="upload-box">
              <div className="upload-box__header">
                <div className="upload-box__label-group">
                  <span className="upload-box__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </span>
                  <div>
                    <h4 className="upload-box__label">Original Resume</h4>
                    <p className="upload-box__sublabel">Your uploaded document</p>
                  </div>
                </div>
              </div>
              <div className="upload-box__content upload-box__content--docx">
                <DocumentPreview blob={originalBlob} fileType={fileType} />
              </div>
            </div>

            <div className="upload-box">
              <div className="upload-box__header">
                <div className="upload-box__label-group">
                  <span className="upload-box__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </span>
                  <div>
                    <h4 className="upload-box__label">Enhanced Resume</h4>
                    <p className="upload-box__sublabel">Optimized content, same format</p>
                  </div>
                </div>
              </div>
              <div className="upload-box__content upload-box__content--docx">
                <DocumentPreview
                  blob={enhancedBlob}
                  fileType="docx"
                  emptyLabel="Enhanced resume will appear here"
                />
              </div>
            </div>
          </div>

          {enhancedBlob && sessionId && (
            <div className="service-cta-row">
              <a
                href={getDownloadUrl(sessionId)}
                className="btn btn--primary btn--xl"
                download
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Enhanced DOCX
              </a>
            </div>
          )}
        </div>
      )}

      {showResults && (
        <section id="enhancement-results" className="enhance-results" aria-label="Enhancement results">
          <div className="enhance-results__header">
            <h4 className="enhance-results__title">Enhancement Results</h4>
            <p className="enhance-results__subtitle">
              Verified changes applied to your enhanced resume
            </p>
          </div>

          <div className="enhance-results__stack">
            <AtsScoreCard
              badge="Before"
              title="Before score"
              desc="Original resume vs JD — Skills + Keywords + Bullets = 100. Click a section to see matches."
              score={results.beforeScore}
              label="before / 100"
              gradId="beforeScoreGrad"
              breakdown={beforeBreakdown}
              activeTab={beforeTab}
              onTabChange={setBeforeTab}
            />

            <AtsScoreCard
              badge="After"
              title="After score"
              desc="Enhanced resume vs JD — Skills + Keywords + Bullets = 100. Click a section to see matches."
              score={results.afterScore}
              label="after / 100"
              gradId="afterScoreGrad"
              breakdown={afterBreakdown}
              delta={results.scoreDelta}
              activeTab={afterTab}
              onTabChange={setAfterTab}
            />

            {/* Card 3 — Added to resume */}
            <article className="feature-result-card feature-result-card--wide">
              <div className="feature-result-card__body feature-result-card__body--scroll">
                <span className="feature-result-card__badge">Changes Applied</span>
                <h3 className="feature-result-card__title">Added to resume</h3>
                <p className="feature-result-card__desc">
                  Verified updates applied to your enhanced DOCX.
                </p>

                <div className="added-sections">
                  <div className="added-section">
                    <h6 className="added-section__heading">Added skills</h6>
                    {addedSkills.length > 0 ? (
                      <div className="added-skills-row">
                        {addedSkills.map(({ skill, category }) => (
                          <span key={`${category}-${skill}`} className="added-skill-chip" title={category}>
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="added-section__empty">No skills added</p>
                    )}
                  </div>

                  <div className="added-section">
                    <h6 className="added-section__heading">Added bullets</h6>
                    {addedBullets.length > 0 ? (
                      <ol className="added-bullets-steps">
                        {addedBullets.map((item, idx) => (
                          <li key={`${item.section}-${idx}`} className="added-bullets-steps__item">
                            <span className="added-bullets-steps__num">{idx + 1}</span>
                            <div className="added-bullets-steps__content">
                              <span className="added-bullets-steps__where">
                                {item.section}
                                {item.rewritten ? ' · rewritten' : ' · added'}
                              </span>
                              <p className="added-bullets-steps__text">{item.text}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="added-section__empty">No bullets added</p>
                    )}
                  </div>

                  <div className="added-section">
                    <h6 className="added-section__heading">Added keywords</h6>
                    {addedKeywords.length > 0 ? (
                      <div className="added-skills-row">
                        {addedKeywords.map((kw) => (
                          <span key={kw} className="added-skill-chip added-skill-chip--kw">{kw}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="added-section__empty">No new keywords matched</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="feature-result-card__visual feature-result-card__visual--stats">
                <div className="feature-result-card__count">
                  <span>{addedSkills.length + addedBullets.length + addedKeywords.length}</span>
                  <small>total changes</small>
                </div>
              </div>
            </article>
          </div>

          <div className="enhance-results__fade" aria-hidden="true" />
        </section>
      )}
    </div>
  )
}
