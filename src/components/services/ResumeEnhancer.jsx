import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DocumentPreview from './DocumentPreview'
import {
  uploadResume,
  startEnhance,
  waitForEnhance,
  getEnhanceStepLabel,
  fetchFileBlob,
  getDownloadUrl,
  downloadScoreReportPdf,
  checkApiHealth,
  setJD,
} from '../../api/enhancer'
import { useAuth } from '../../context/AuthContext'

function ScoreRing({ score, label = '/ 100', gradId = 'scoreGrad', size = 'sm' }) {
  const pct = Math.min(100, Math.max(0, Number(score) || 0))
  const circumference = 326.7
  const offset = circumference - (circumference * pct) / 100
  return (
    <div className={`score-ring score-ring--${size}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(15, 23, 42, 0.08)" strokeWidth="9" />
        <circle
          cx="60" cy="60" r="52" fill="none" stroke={`url(#${gradId})`} strokeWidth="9"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 60 60)"
        />
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#16c784" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>
      </svg>
      <div className="score-ring__text">
        <span className="score-ring__value">{score ?? '-'}</span>
        <span className="score-ring__label">{label}</span>
      </div>
    </div>
  )
}

function ScoreDetailBox({ breakdown, active, title, onClose, boxRef }) {
  if (!breakdown || !active) return null
  const pillar = breakdown[active]
  const details = breakdown.details?.[active] || []
  if (!pillar) return null
  const labels = {
    skills: 'Hard Skills & Tools',
    keywords: 'Title & Domain Keywords',
    bullets: 'Experience & Impact',
  }

  return (
    <div className="score-detail-box" ref={boxRef} role="dialog" aria-label={`${title} ${labels[active]}`}>
      <div className="score-detail-box__head">
        <div>
          <strong>{labels[active]}</strong>
          <span>
            {active === 'bullets'
              ? `Coverage ${pillar.pct}%  |  ${pillar.matched}/${pillar.total} covered  |  ${pillar.score ?? 0}/${pillar.max ?? 40} pts`
              : `${pillar.matched}/${pillar.total} matched  |  ${pillar.pct}%  |  ${pillar.score ?? 0}/${pillar.max ?? (active === 'skills' ? 24 : 16)} pts`}
          </span>
        </div>
        <button type="button" className="score-detail-box__close" onClick={onClose} aria-label="Close">
          x
        </button>
      </div>
      <ul className="score-detail-box__list">
        {details.map((row, idx) => (
          <li
            key={`${row.item}-${idx}`}
            className={`score-detail-box__item ${row.matched ? 'is-matched' : 'is-missing'}`}
          >
            <span className="score-detail-box__status">
              {row.matched ? (row.strong ? 'strong' : active === 'bullets' ? `${row.coverage}%` : 'match') : 'missing'}
            </span>
            <span>{row.item}</span>
          </li>
        ))}
        {!details.length && (
          <li className="score-detail-box__item is-empty">No JD items in this category</li>
        )}
      </ul>
    </div>
  )
}

function CompactScoreCard({
  title,
  subtitle,
  score,
  gradId,
  breakdown,
  badge,
  activeTab,
  onTabChange,
  cardKey,
}) {
  const tabs = [
    { key: 'skills', label: 'Skills', maxDefault: 24 },
    { key: 'keywords', label: 'Keywords', maxDefault: 16 },
    { key: 'bullets', label: 'Experience', maxDefault: 40 },
  ]
  const cardRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!activeTab) return undefined
    const onPointerDown = (e) => {
      const t = e.target
      if (cardRef.current?.contains(t) || boxRef.current?.contains(t)) return
      onTabChange(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onTabChange(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [activeTab, onTabChange])

  return (
    <article className="ats-mini-card" ref={cardRef} data-card={cardKey}>
      <div className="ats-mini-card__top">
        <div className="ats-mini-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 3 5-7" />
          </svg>
        </div>
        <div className="ats-mini-card__titles">
          <h3 className="ats-mini-card__title">{title}</h3>
          <p className="ats-mini-card__subtitle">{subtitle}</p>
        </div>
        {badge != null && badge !== '' && (
          <span className="ats-mini-card__delta">{badge}</span>
        )}
      </div>

      <div className="ats-mini-card__ring-wrap">
        <ScoreRing score={score} label="/ 100" gradId={gradId} size="sm" />
        {breakdown?.format?.max != null && (
          <p className="ats-mini-card__format-meta">
            Format {breakdown.format.score ?? 0}/{breakdown.format.max} pts
          </p>
        )}
      </div>

      <div className="ats-mini-card__tabs" role="group" aria-label={`${title} breakdown`}>
        {tabs.map((tab) => {
          const p = breakdown?.[tab.key]
          const isOpen = activeTab === tab.key
          const matched = p?.matched ?? 0
          const total = p?.total ?? 0
          const pts = p?.score ?? 0
          const max = p?.max ?? tab.maxDefault
          return (
            <button
              key={tab.key}
              type="button"
              className={`ats-mini-tab ${isOpen ? 'is-open' : ''}`}
              aria-expanded={isOpen}
              onClick={() => onTabChange(isOpen ? null : tab.key)}
            >
              <span className="ats-mini-tab__label">{tab.label}</span>
              <span className="ats-mini-tab__meta">
                {p ? (
                  <>
                    <span className="ats-mini-tab__count">{matched}/{total}</span>
                    <span className="ats-mini-tab__pts">{pts}/{max} pts</span>
                  </>
                ) : (
                  '-'
                )}
              </span>
            </button>
          )
        })}
      </div>

      {activeTab && (
        <ScoreDetailBox
          breakdown={breakdown}
          active={activeTab}
          title={title}
          onClose={() => onTabChange(null)}
          boxRef={boxRef}
        />
      )}
    </article>
  )
}

function ChangesAppliedCard({ total, onViewChanges, sessionId, onDownloadReport }) {
  return (
    <article className="ats-mini-card ats-mini-card--changes">
      <div className="ats-mini-card__top">
        <div className="ats-mini-card__icon ats-mini-card__icon--blue" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M9 15l2 2 4-4" />
          </svg>
        </div>
        <div className="ats-mini-card__titles">
          <h3 className="ats-mini-card__title">Changes applied</h3>
          <p className="ats-mini-card__subtitle">Verified updates in your DOCX</p>
        </div>
      </div>
      <div className="ats-mini-card__count-block">
        <span className="ats-mini-card__count">{total}</span>
        <small>Total changes</small>
      </div>
      <div className="ats-mini-card__note">
        Verified updates applied to your enhanced DOCX.
      </div>
      <div className="ats-mini-card__actions">
        <button type="button" className="ats-mini-card__cta" onClick={onViewChanges}>
          View Changes
        </button>
        {sessionId && (
          <button
            type="button"
            className="ats-mini-card__cta ats-mini-card__cta--report"
            onClick={onDownloadReport}
          >
            Download Score Report (PDF)
          </button>
        )}
      </div>
    </article>
  )
}

function UploadPanel({ label, sublabel, icon, onUpload, accept, uploading, statusText }) {
  const inputRef = useRef(null)
  const hasFile = Boolean(statusText && statusText !== 'No file uploaded yet')

  return (
    <div className="upload-box upload-box--compact">
      <div className="upload-box__header">
        <div className="upload-box__label-group">
          <span className="upload-box__icon">{icon}</span>
          <div>
            <h4 className="upload-box__label">{label}</h4>
            {sublabel && <p className="upload-box__sublabel">{sublabel}</p>}
          </div>
        </div>
      </div>
      <div className="upload-box__content upload-box__content--compact">
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
          className="upload-box__center-btn"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        <p className={`upload-box__center-status ${hasFile ? 'is-ready' : ''}`}>
          {statusText}
        </p>
      </div>
    </div>
  )
}

function JdPanel({ jdText, jdPrepStatus, onOpen, boxRef }) {
  const hasJd = Boolean(jdText.trim())

  return (
    <div className="upload-box upload-box--compact upload-box--jd" ref={boxRef}>
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
              {hasJd ? (jdPrepStatus || 'Job description ready') : 'Click Upload to paste JD'}
            </p>
          </div>
        </div>
      </div>
      <div className="upload-box__content upload-box__content--compact">
        <button type="button" className="upload-box__center-btn" onClick={onOpen}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload
        </button>
        <p className={`upload-box__center-status ${hasJd ? 'is-ready' : ''}`}>
          {hasJd ? (jdPrepStatus || 'Job description ready.') : 'No job description yet'}
        </p>
      </div>
    </div>
  )
}

function JdModal({ jdText, setJdText, onDone, onCancel, anchorRef }) {
  const hasJd = Boolean(jdText.trim())
  const [panelStyle, setPanelStyle] = useState(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 900px)').matches
    // Mobile: let CSS center the panel. Do not re-anchor on scroll (iOS keyboard jumps feel like auto-scroll).
    if (isMobile) {
      setPanelStyle(null)
      return undefined
    }

    const place = () => {
      const el = anchorRef?.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const width = Math.min(Math.max(r.width * 1.2, 440), Math.min(window.innerWidth * 0.48, 580))
      const maxHeight = Math.min(window.innerHeight * 0.8, 680)

      let left = Math.max(12, r.right - width)
      let top = r.top

      if (top + Math.min(maxHeight, 320) > window.innerHeight - 12) {
        top = Math.min(r.bottom + 8, window.innerHeight - Math.min(maxHeight, 320) - 12)
      }

      left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
      top = Math.max(12, Math.min(top, window.innerHeight - Math.min(maxHeight, 280) - 12))

      setPanelStyle({
        position: 'fixed',
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        width: `${Math.round(width)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
      })
    }

    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  useEffect(() => {
    // Focus without scrolling the page underneath
    const t = window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="jd-modal" role="dialog" aria-modal="true" aria-label="Paste job description">
      <button type="button" className="jd-modal__backdrop" aria-label="Close" onClick={onCancel} />
      <div className="jd-modal__panel" style={panelStyle || undefined}>
        <div className="jd-modal__head">
          <div>
            <h3 className="jd-modal__title">Paste Job Description</h3>
            <p className="jd-modal__sub">Paste the full JD, then click Done (or it closes after paste)</p>
          </div>
          <button type="button" className="jd-modal__close" onClick={onCancel} aria-label="Close">
            x
          </button>
        </div>
        <div className="jd-modal__body">
          <textarea
            ref={textareaRef}
            className="jd-textarea jd-modal__textarea"
            placeholder="Paste the full job description here..."
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData('text') || ''
              if (!pasted.trim()) return
              window.setTimeout(() => {
                onDone({ fromPaste: true })
              }, 80)
            }}
          />
        </div>
        <div className="jd-modal__footer">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!hasJd}
            onClick={() => onDone({ allowEmpty: false })}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ResumeEnhancer() {
  const { user, isAuthenticated, refreshUser } = useAuth()
  const enhancerLeft = user?.usage?.remaining?.enhancer
  const enhancerLimit = user?.usage?.limits?.enhancer
  const enhancerUsed = user?.usage?.used?.enhancer
  const usageText =
    !isAuthenticated
      ? null
      : enhancerLeft == null || !Number.isFinite(enhancerLimit)
        ? 'Unlimited enhancements on your plan'
        : `${enhancerLeft} of ${enhancerLimit} enhancements left this month`
  const [sessionId, setSessionId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [fileType, setFileType] = useState(null)
  const [jdText, setJdText] = useState('')
  const [jdEditorOpen, setJdEditorOpen] = useState(false)
  const [originalBlob, setOriginalBlob] = useState(null)
  const [enhancedBlob, setEnhancedBlob] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [comparisonBefore, setComparisonBefore] = useState(null)
  const [matchAnalysis, setMatchAnalysis] = useState(null)
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
  const jdBoxRef = useRef(null)

  const openBeforeTab = useCallback((key) => {
    setAfterTab(null)
    setBeforeTab(key)
  }, [])
  const openAfterTab = useCallback((key) => {
    setBeforeTab(null)
    setAfterTab(key)
  }, [])
  const scrollToAdded = useCallback(() => {
    document.getElementById('added-to-resume')?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [])
  const handleDownloadScoreReport = useCallback(async () => {
    if (!sessionId) {
      setError('No session available for score report.')
      return
    }
    try {
      setError('')
      await downloadScoreReportPdf(sessionId)
    } catch (err) {
      setError(err.message || 'Failed to download score report PDF. Restart the API server and enhance again.')
    }
  }, [sessionId])
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

    setJdPrepStatus('Preparing job description...')
    clearTimeout(jdSaveTimerRef.current)
    jdSaveTimerRef.current = setTimeout(async () => {
      const text = jdText.trim()
      try {
        await setJD(sessionId, text)
        lastSavedJdRef.current = text
        setJdPrepStatus('Job description ready')
      } catch {
        setJdPrepStatus('')
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
    if (enhancingRef.current || uploading || enhancing) return

    if (!sessionId) {
      setError('Upload a resume first.')
      return
    }
    if (!jdText.trim()) {
      setError('Paste a job description first. Click Upload on the JD box.')
      setJdEditorOpen(true)
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
    setJdEditorOpen(false)

    try {
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
      try {
        await refreshUser?.()
      } catch {
        /* usage chip can refresh on next page load */
      }
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
      setAtsScore(result.atsScore)
      if (result.comparisonBefore) {
        setComparisonBefore(result.comparisonBefore)
      }

      const enhanced = await fetchFileBlob(sessionId, 'enhanced')
      setEnhancedBlob(enhanced)
      setStep('done')
    } catch (err) {
      setError(err.message || 'Enhancement failed. Please try again.')
      setStep('uploaded')
    } finally {
      enhancingRef.current = false
      setEnhancing(false)
      setEnhanceStep('')
    }
  }

  const closeJdEditor = (opts = {}) => {
    const fromPaste = Boolean(opts.fromPaste)
    // After paste, state may not have flushed yet — still close the modal
    if (!fromPaste && !jdText.trim()) {
      setError('Paste a job description before closing.')
      return
    }
    setError('')
    setJdEditorOpen(false)
  }

  const cancelJdEditor = () => {
    setJdEditorOpen(false)
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
  const beforeBreakdown = results?.beforeBreakdown
    || comparisonBefore?.scoreBreakdown
    || null
  const afterBreakdown = results?.afterBreakdown
    || comparison?.scoreBreakdown
    || null
  const showResults = step === 'done' && comparison && results

  // Do not auto-scroll when results appear — on mobile this feels like the screen moving by itself.
  // Users can jump via the explicit "View changes" control (scrollToAdded).

  return (
    <div className="service-block service-block--workspace service-block--enhancer">
      <div className="enhancer-topbar">
        <div className="service-block__header">
          <span className="service-block__num">01</span>
          <div>
            <h3 className="service-block__title">AI Resume Enhancer</h3>
            <p className="service-block__desc">Upload resume + JD, then enhance. Preview appears below.</p>
            {usageText && (
              <p className="enhancer-usage-chip">
                {user?.planLabel || 'Free plan'} · {usageText}
                {Number.isFinite(enhancerLimit) && enhancerLeft === 0 && (
                  <> · <Link to="/#pricing">Upgrade for more</Link></>
                )}
              </p>
            )}
            {!isAuthenticated && (
              <p className="enhancer-usage-chip">
                <Link to="/login">Sign in</Link> to use your free plan (10 enhancements / month).
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn btn--primary enhancer-topbar__cta"
          disabled={uploading || enhancing}
          onClick={handleEnhance}
        >
          {enhancing ? (
            <>
              <span className="btn-spinner" />
              {getEnhanceStepLabel(enhanceStep)}
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Enhance Resume
            </>
          )}
        </button>
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

      {enhancing && (
        <p className="enhancer-progress">{getEnhanceStepLabel(enhanceStep)}</p>
      )}

      <div className="service-section service-section--inputs">
        <div className="resume-enhancer-workspace resume-enhancer-workspace--inputs">
          <UploadPanel
            label="Upload Resume"
            sublabel={fileName || 'DOCX or PDF'}
            uploading={uploading}
            accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
            onUpload={handleUpload}
            statusText={fileName || 'No file uploaded yet'}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            }
          />

          <JdPanel
            jdText={jdText}
            jdPrepStatus={jdPrepStatus}
            boxRef={jdBoxRef}
            onOpen={() => {
              setError('')
              setJdEditorOpen(true)
            }}
          />
        </div>
      </div>

      {showResults && (
        <section id="enhancement-results" className="enhance-results enhance-results--v2" aria-label="Enhancement results">
          <div className="enhance-results__header">
            <h4 className="enhance-results__title">Enhancement Results</h4>
            <p className="enhance-results__subtitle">Score breakdown and verified changes</p>
          </div>

          <div className="ats-mini-grid" aria-label="Score cards">
            <CompactScoreCard
              cardKey="before"
              title="Before score"
              subtitle="Original resume vs JD"
              score={results.beforeScore}
              gradId="beforeScoreGrad"
              breakdown={beforeBreakdown}
              activeTab={beforeTab}
              onTabChange={openBeforeTab}
            />
            <CompactScoreCard
              cardKey="after"
              title="After score"
              subtitle="Enhanced resume vs JD"
              score={results.afterScore}
              gradId="afterScoreGrad"
              breakdown={afterBreakdown}
              badge={addedSkills.length > 0 ? `+${addedSkills.length} skills` : null}
              activeTab={afterTab}
              onTabChange={openAfterTab}
            />
            <ChangesAppliedCard
              total={addedSkills.length + addedBullets.length + addedKeywords.length}
              onViewChanges={scrollToAdded}
              sessionId={sessionId}
              onDownloadReport={handleDownloadScoreReport}
            />
          </div>

          {(results.atsMarks || comparison?.atsMarks) && (
            <div className="ats-marks-row" aria-label="ATS friendly marks">
              {[
                { key: 'atsFriendly', label: 'ATS Friendly' },
                { key: 'readability', label: 'Readability' },
                { key: 'attractiveness', label: 'Attractiveness' },
              ].map((item) => {
                const marks = results.atsMarks || comparison?.atsMarks || {}
                const val = marks[item.key]
                if (val == null) return null
                return (
                  <div key={item.key} className="ats-marks-row__item">
                    <span className="ats-marks-row__label">{item.label}</span>
                    <span className="ats-marks-row__value">{val}/100</span>
                  </div>
                )
              })}
              {(results.atsMarks?.jdMatchLabel || comparison?.atsMarks?.jdMatchLabel) && (
                <div className="ats-marks-row__item ats-marks-row__item--label">
                  <span className="ats-marks-row__label">JD Match</span>
                  <span className="ats-marks-row__value">
                    {results.atsMarks?.jdMatchLabel || comparison?.atsMarks?.jdMatchLabel}
                  </span>
                </div>
              )}
            </div>
          )}

          <article id="added-to-resume" className="added-panel">
            <div className="added-panel__head">
              <h3 className="added-panel__title">
                Added to resume
                <span className="added-panel__count">
                  {addedSkills.length + addedBullets.length + addedKeywords.length} changes
                </span>
              </h3>
            </div>

            <div className="added-sections">
              <div className="added-section">
                <h6 className="added-section__heading">Added skills</h6>
                {addedSkills.length > 0 ? (
                  <div className="added-skills-row">
                    {addedSkills.map(({ skill, category }) => (
                      <span key={category + '-' + skill} className="added-skill-chip" title={category}>
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
                      <li key={item.section + '-' + idx} className="added-bullets-steps__item">
                        <span className="added-bullets-steps__num">{idx + 1}</span>
                        <div className="added-bullets-steps__content">
                          <span className="added-bullets-steps__where">
                            {item.section}
                            {item.rewritten ? ' | rewritten' : ' | added'}
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
          </article>
        </section>
      )}

      <section
        id="resume-preview-compare"
        className={'enhance-preview-block enhance-preview-block--section' + (showResults ? ' is-after-results' : '')}
        aria-label="Resume preview comparison"
      >
        {enhancedBlob && (
          <p className="comparison-legend">
            <span className="comparison-legend__item comparison-legend__item--green">Green = new or replaced bullet</span>
            <span className="comparison-legend__item comparison-legend__item--yellow">Yellow = edited existing bullet</span>
          </p>
        )}

        <div className="resume-enhancer-workspace resume-enhancer-workspace--previews">
          <div className="upload-box">
            <div className="upload-box__header">
              <div className="upload-box__label-group">
                <div>
                  <h4 className="upload-box__label">Original Resume</h4>
                  <p className="upload-box__sublabel">Your uploaded document</p>
                </div>
              </div>
            </div>
            <div className="upload-box__content upload-box__content--docx">
              <DocumentPreview
                blob={originalBlob}
                fileType={fileType}
                emptyLabel="Upload a resume to preview it here"
              />
            </div>
          </div>

          <div className="upload-box">
            <div className="upload-box__header">
              <div className="upload-box__label-group">
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
                emptyLabel={enhancing ? 'Enhancing your resume...' : 'Enhanced resume will appear here after you click Enhance'}
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
      </section>

      {jdEditorOpen && (
        <JdModal
          jdText={jdText}
          setJdText={setJdText}
          anchorRef={jdBoxRef}
          onDone={closeJdEditor}
          onCancel={cancelJdEditor}
        />
      )}
    </div>
  )
}
