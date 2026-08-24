import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DocumentPreview from './DocumentPreview'
import ProLoadingScreen from './pro/ProLoadingScreen'
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
import { useAssistantWorkspace } from '../../context/AssistantContext'

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
              {hasJd ? (jdPrepStatus || 'Job description ready') : 'Paste or type the job posting'}
            </p>
          </div>
        </div>
      </div>
      <div className="upload-box__content upload-box__content--compact">
        <button type="button" className="upload-box__center-btn" onClick={onOpen}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          {hasJd ? 'Edit JD' : 'Paste JD'}
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

const ENHANCE_LOAD_STEPS = [
  { key: 'analyzing_resume', label: 'Loading your resume…' },
  { key: 'parsing_jd', label: 'Parsing the job description…' },
  { key: 'comparing', label: 'Comparing skills and keywords…' },
  { key: 'writing_plan', label: 'Writing the enhancement plan…' },
  { key: 'updating_resume', label: 'Updating your resume…' },
  { key: 'preparing_preview', label: 'Verifying layout and pages…' },
]

function greetingLine(user) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const raw = user?.name?.split(/\s+/)[0] || ''
  const name = !raw || raw === 'Local' ? '' : raw
  return name ? `${part}, ${name}.` : `${part}.`
}

function asTextList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      return item?.item || item?.skill || item?.keyword || item?.text || ''
    })
    .filter(Boolean)
}

function scoreTone(score) {
  const n = Number(score) || 0
  if (n >= 80) return 'ok'
  if (n >= 55) return 'mid'
  return 'low'
}

function deriveWorkingItems(results, afterBreakdown, atsMarks) {
  const items = []
  const strong = asTextList(results?.keywordsStrong)
  const matched = asTextList(results?.keywordsMatched)
  if (strong.length) {
    items.push({
      title: 'Strong keyword matches',
      body: `Your resume now hits ${strong.length} high-value JD keywords${strong.length ? `, including ${strong.slice(0, 3).join(', ')}` : ''}.`,
    })
  } else if (matched.length) {
    items.push({
      title: 'JD keywords present',
      body: `${matched.length} job-description keywords appear in your enhanced resume.`,
    })
  }
  const format = afterBreakdown?.format
  if (format?.max && format.score / format.max >= 0.7) {
    items.push({
      title: 'ATS-friendly format',
      body: `Layout and structure scored ${format.score}/${format.max}. Parsers and recruiters can read this cleanly.`,
    })
  }
  const bullets = afterBreakdown?.bullets
  if (bullets && (bullets.pct >= 60 || (bullets.total && bullets.matched / bullets.total >= 0.55))) {
    items.push({
      title: 'Experience coverage',
      body: `${bullets.matched}/${bullets.total} JD experience themes are covered in your bullets.`,
    })
  }
  if ((atsMarks?.readability ?? 0) >= 70) {
    items.push({
      title: 'Readable for hiring managers',
      body: `Readability scored ${atsMarks.readability}/100 — scannable, not dense.`,
    })
  }
  if ((atsMarks?.atsFriendly ?? 0) >= 70) {
    items.push({
      title: 'ATS-friendly writing',
      body: `ATS friendliness scored ${atsMarks.atsFriendly}/100.`,
    })
  }
  return items.slice(0, 5)
}

function deriveFixItems(results, afterBreakdown, afterScore) {
  const items = []
  const missing = asTextList(results?.keywordsStillMissing)
  const weak = asTextList(results?.keywordsWeak)
  const unmatchedSkills = (afterBreakdown?.details?.skills || []).filter((row) => !row.matched)
  const remaining = Math.max(0, 100 - (Number(afterScore) || 0))

  if (missing.length) {
    items.push({
      title: 'Missing JD keywords',
      body: `${missing.length} important terms are still missing: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}.`,
      impact: remaining ? `+${Math.min(remaining, Math.max(3, missing.length))} pts` : null,
      scoreLabel: `${Math.max(1, 10 - Math.min(9, missing.length))}/10`,
    })
  }
  if (weak.length) {
    items.push({
      title: 'Weak keyword placement',
      body: `These appear, but not strongly enough: ${weak.slice(0, 6).join(', ')}.`,
      impact: remaining ? `+${Math.min(6, weak.length)} pts` : null,
      scoreLabel: '6/10',
    })
  }
  if (unmatchedSkills.length) {
    items.push({
      title: 'Skills still missing',
      body: unmatchedSkills.slice(0, 8).map((row) => row.item).filter(Boolean).join(', '),
      impact: remaining ? `+${Math.min(8, unmatchedSkills.length)} pts` : null,
      scoreLabel: `${Math.max(1, 10 - Math.min(9, unmatchedSkills.length))}/10`,
    })
  }
  const format = afterBreakdown?.format
  if (format?.max && format.score / format.max < 0.7) {
    items.push({
      title: 'Format & layout',
      body: `Format scored ${format.score}/${format.max}. Tighten spacing, headers, and page breaks.`,
      impact: `+${Math.max(1, format.max - (format.score || 0))} pts`,
      scoreLabel: `${Math.max(1, Math.round((format.score / format.max) * 10))}/10`,
    })
  }
  return items
}

export default function ResumeEnhancer() {
  const { user, isAuthenticated, refreshUser } = useAuth()
  const { setWorkspace, clearWorkspace } = useAssistantWorkspace()
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
  const [layoutQa, setLayoutQa] = useState(null)
  const [readyForDownload, setReadyForDownload] = useState(false)
  const [downloadPhase, setDownloadPhase] = useState('idle') // idle | polishing | ready
  const [polishLabel, setPolishLabel] = useState('Polishing page layout…')
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
  const [previewMode, setPreviewMode] = useState('original')
  const enhancingRef = useRef(false)
  const jdBoxRef = useRef(null)
  const resumeInputRef = useRef(null)

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

  useEffect(() => {
    setWorkspace({
      service: 'enhancer',
      sessionId: sessionId || null,
      hasPreview: Boolean(enhancedBlob),
      label: 'Resume Enhancer',
      meta: { step, fileName },
    })
    return () => clearWorkspace()
  }, [sessionId, enhancedBlob, step, fileName, setWorkspace, clearWorkspace])

  useEffect(() => {
    async function onPreviewUpdated(e) {
      const detail = e.detail || {}
      const sid = detail.sessionId || sessionId
      if (!sid || detail.service !== 'enhancer') return
      try {
        const blob = await fetchFileBlob(sid, 'enhanced')
        setEnhancedBlob(blob)
        setReadyForDownload(true)
        setDownloadPhase('ready')
        setError('')
      } catch { /* ignore */ }
    }
    window.addEventListener('jobpilot:assistant-preview-updated', onPreviewUpdated)
    return () => window.removeEventListener('jobpilot:assistant-preview-updated', onPreviewUpdated)
  }, [sessionId])

  // Failsafe: if the enhanced file is present, never leave Download locked
  useEffect(() => {
    if (!enhancedBlob || !sessionId || readyForDownload) return undefined
    const t = setTimeout(() => {
      setReadyForDownload(true)
      setDownloadPhase('ready')
    }, 2500)
    return () => clearTimeout(t)
  }, [enhancedBlob, sessionId, readyForDownload])

  useEffect(() => {
    if (downloadPhase !== 'polishing') {
      setPolishLabel('Polishing page layout…')
      return undefined
    }
    const labels = ['Loading…', 'Polishing…', 'Page layout…']
    let i = 0
    setPolishLabel(labels[0])
    const id = setInterval(() => {
      i = (i + 1) % labels.length
      setPolishLabel(labels[i])
    }, 700)
    return () => clearInterval(id)
  }, [downloadPhase])

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
    setLayoutQa(null)
    setReadyForDownload(false)
    setDownloadPhase('idle')
    setComparison(null)
    setComparisonBefore(null)
    setMatchAnalysis(null)
    setAtsScore(null)
    setSessionId(null)
    setPreviewMode('original')
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
      setError('Paste a job description first. Click Paste JD on the job description box.')
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
    window.scrollTo(0, 0)
    setStep('enhancing')
    setEnhanceStep('analyzing_resume')
    setReadyForDownload(false)
    setDownloadPhase('polishing')
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

      const qa = result.layoutQa || null
      setLayoutQa(qa)

      const enhanced = await fetchFileBlob(sessionId, 'enhanced')
      setEnhancedBlob(enhanced)
      setPreviewMode('enhanced')
      setStep('done')
      setError('')

      // Always unlock Download once the enhanced file exists.
      // Brief polishing copy on the same CTA, then flip to Download — never leave users stuck.
      setReadyForDownload(false)
      setDownloadPhase('polishing')
      window.setTimeout(() => {
        setReadyForDownload(true)
        setDownloadPhase('ready')
      }, 1600)
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
  const atsMarks = results?.atsMarks || comparison?.atsMarks || {}
  const workingItems = showResults ? deriveWorkingItems(results, afterBreakdown, atsMarks) : []
  const fixItems = showResults ? deriveFixItems(results, afterBreakdown, results.afterScore) : []
  const missingKeywords = asTextList(results?.keywordsStillMissing)
  const displayScore = showResults ? (results.afterScore ?? results.beforeScore) : null
  const beforeScore = results?.beforeScore
  const tone = scoreTone(displayScore)
  const headlineGood = Number(displayScore) >= 80
  const previewBlob = previewMode === 'enhanced' && enhancedBlob ? enhancedBlob : originalBlob
  const previewType = previewMode === 'enhanced' && enhancedBlob ? 'docx' : fileType
  const changeCount = addedSkills.length + addedBullets.length + addedKeywords.length

  return (
    <div className="service-block service-block--workspace service-block--enhancer pro-app">
      <header className="pro-app__bar">
        <div className="pro-app__identity">
          <Link to="/#services" className="pro-app__back" aria-label="Back to Services">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <span className="pro-app__kicker">Resume Enhancer</span>
            <h3 className="pro-app__title">Score your resume against the job</h3>
          </div>
        </div>
        {showResults && (
          <nav className="pro-app__tabs" aria-label="Report view">
            <span className="pro-app__tab is-active">Score</span>
          </nav>
        )}
        <div className="pro-app__actions">
          {usageText && <p className="pro-app__usage">{user?.planLabel || 'Free plan'} · {usageText}</p>}
          {originalBlob && (
            <button
              type="button"
              className="btn btn--ghost-navy"
              disabled={uploading || enhancing}
              onClick={() => resumeInputRef.current?.click()}
            >
              Re-upload resume
            </button>
          )}
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
              'Enhance Resume'
            )}
          </button>
          {showResults && sessionId && readyForDownload && (
            <a href={getDownloadUrl(sessionId)} className="btn btn--navy" download>
              Download DOCX
            </a>
          )}
        </div>
      </header>

      <input
        ref={resumeInputRef}
        type="file"
        accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleUpload(file)
          e.target.value = ''
        }}
      />

      {error && <div className="pro-error" role="alert">{error}</div>}
      {apiOnline === false && !error && (
        <div className="pro-notice">
          Resume API is offline. Deploy the backend and set <code>VITE_API_BASE</code>.
        </div>
      )}
      {fileType === 'pdf' && sessionId && (
        <div className="pro-notice">PDF preview is supported. Upload a DOCX file to enhance and download.</div>
      )}

      {enhancing && (
        <ProLoadingScreen
          title="Please wait…"
          subtitle="We’re scoring your resume against this job description."
          steps={ENHANCE_LOAD_STEPS}
          currentStep={enhanceStep}
        />
      )}

      <div className="pro-split">
        <aside className={`pro-split__report ${showResults ? '' : 'pro-split__report--setup pro-setup'}`}>
          {!showResults ? (
            <>
              <h2 className="pro-setup__hello">{greetingLine(user)}</h2>
              <p className="pro-setup__lede">Welcome back to your career toolkit. Upload a resume, paste the JD, then enhance.</p>
              <div className="pro-setup__tiles">
                <UploadPanel
                  label="Upload Resume"
                  sublabel={fileName || 'English resumes in PDF or DOCX'}
                  uploading={uploading}
                  accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                  onUpload={handleUpload}
                  statusText={fileName || 'Click Upload or drop your resume here'}
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
              <button
                type="button"
                className="btn btn--primary pro-setup__cta"
                disabled={uploading || enhancing}
                onClick={handleEnhance}
              >
                Enhance Resume
              </button>
              {!isAuthenticated && (
                <p className="pro-setup__hint">
                  <Link to="/login">Sign in</Link> to use your free plan (10 enhancements / month).
                </p>
              )}
              {isAuthenticated && Number.isFinite(enhancerLimit) && enhancerLeft === 0 && (
                <p className="pro-setup__hint">
                  You’re out of enhancements this month. <Link to="/#pricing">Upgrade for more</Link>.
                </p>
              )}
            </>
          ) : (
            <div id="enhancement-results">
              <h2 className="pro-report__headline">
                {headlineGood ? (
                  <>Your resume is <em className="is-good">in strong shape.</em></>
                ) : (
                  <>Here&apos;s where your resume stands{Number(displayScore) < 70 ? <> — it&apos;s <em>falling short.</em></> : '.'}</>
                )}
              </h2>
              <p className="pro-report__lede">
                {beforeScore != null && displayScore != null
                  ? `You moved from ${beforeScore} to ${displayScore}. Stronger resumes get more callbacks.`
                  : 'Based on recruiter and ATS screening checks against this job description.'}
              </p>

              <div className="pro-score">
                <div className="pro-score__row">
                  <div className={`pro-score__value pro-score__value--${tone}`}>
                    {displayScore ?? '—'} <span className="pro-score__denom">/ 100</span>
                  </div>
                  {beforeScore != null && (
                    <span className="pro-score__was">Was {beforeScore}</span>
                  )}
                </div>
                <div className="pro-score__bar" aria-hidden="true">
                  <span
                    className="pro-score__marker"
                    style={{ left: `${Math.min(100, Math.max(0, Number(displayScore) || 0))}%` }}
                  />
                  {beforeScore != null && Number(displayScore) > Number(beforeScore) && (
                    <span
                      className="pro-score__potential"
                      style={{ left: `${Math.min(100, Math.max(0, Number(displayScore) || 0))}%` }}
                    >
                      Enhanced {displayScore}
                    </span>
                  )}
                </div>
                <p className="pro-score__meta">
                  Based on skills, keywords, experience coverage, and ATS format checks.
                </p>
              </div>

              {(atsMarks.atsFriendly != null || atsMarks.readability != null || atsMarks.attractiveness != null) && (
                <div className="pro-marks">
                  {atsMarks.atsFriendly != null && (
                    <span className="pro-mark">ATS friendly <span>{atsMarks.atsFriendly}/100</span></span>
                  )}
                  {atsMarks.readability != null && (
                    <span className="pro-mark">Readability <span>{atsMarks.readability}/100</span></span>
                  )}
                  {atsMarks.attractiveness != null && (
                    <span className="pro-mark">Attractiveness <span>{atsMarks.attractiveness}/100</span></span>
                  )}
                  {atsMarks.jdMatchLabel && (
                    <span className="pro-mark">JD match <span>{atsMarks.jdMatchLabel}</span></span>
                  )}
                </div>
              )}

              <CompactScoreCard
                cardKey="after"
                title="After score breakdown"
                subtitle="Tap a category to see matched vs missing"
                score={results.afterScore}
                gradId="afterScoreGrad"
                breakdown={afterBreakdown}
                badge={addedSkills.length > 0 ? `+${addedSkills.length} skills` : null}
                activeTab={afterTab}
                onTabChange={openAfterTab}
              />
              {beforeBreakdown && (
                <div style={{ marginTop: 12 }}>
                  <CompactScoreCard
                    cardKey="before"
                    title="Before score breakdown"
                    subtitle="Original resume vs this JD"
                    score={results.beforeScore}
                    gradId="beforeScoreGrad"
                    breakdown={beforeBreakdown}
                    activeTab={beforeTab}
                    onTabChange={openBeforeTab}
                  />
                </div>
              )}

              {workingItems.length > 0 && (
                <section className="pro-section">
                  <h3 className="pro-section__title">What&apos;s working</h3>
                  <p className="pro-section__sub">Your resume passes these recruiter and ATS checks.</p>
                  {workingItems.map((item) => (
                    <article key={item.title} className="pro-issue pro-issue--ok">
                      <span className="pro-issue__icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                      <div className="pro-issue__body">
                        <h4 className="pro-issue__title">{item.title}</h4>
                        <p className="pro-issue__text">{item.body}</p>
                      </div>
                    </article>
                  ))}
                </section>
              )}

              <section className="pro-section">
                <h3 className="pro-section__title">What to fix</h3>
                <p className="pro-section__sub">Sorted by remaining gap — start at the top.</p>
                {fixItems.length > 0 ? fixItems.map((item) => (
                  <article key={item.title} className="pro-issue pro-issue--fix">
                    {item.scoreLabel && <span className="pro-issue__score">{item.scoreLabel}</span>}
                    <span className="pro-issue__icon" aria-hidden="true">!</span>
                    <div className="pro-issue__body">
                      <h4 className="pro-issue__title">{item.title}</h4>
                      <p className="pro-issue__text">{item.body}</p>
                    </div>
                    {item.impact && <span className="pro-issue__impact">{item.impact}</span>}
                  </article>
                )) : (
                  <article className="pro-issue pro-issue--ok">
                    <span className="pro-issue__icon" aria-hidden="true">✓</span>
                    <div className="pro-issue__body">
                      <h4 className="pro-issue__title">No major gaps left</h4>
                      <p className="pro-issue__text">Remaining edits are polish — download and apply if you want.</p>
                    </div>
                  </article>
                )}
                {missingKeywords.length > 0 && (
                  <div className="pro-chips" style={{ marginTop: 10 }}>
                    {missingKeywords.slice(0, 12).map((kw) => (
                      <span key={kw} className="pro-chip pro-chip--miss">{kw}</span>
                    ))}
                  </div>
                )}
              </section>

              <article id="added-to-resume" className="added-panel">
                <div className="added-panel__head">
                  <h3 className="added-panel__title">
                    Added to resume
                    <span className="added-panel__count">{changeCount} changes</span>
                  </h3>
                </div>
                <div className="added-sections">
                  <div className="added-section">
                    <h6 className="added-section__heading">Added skills</h6>
                    {addedSkills.length > 0 ? (
                      <div className="pro-chips">
                        {addedSkills.map(({ skill, category }) => (
                          <span key={category + '-' + skill} className="pro-chip" title={category}>{skill}</span>
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
                      <div className="pro-chips">
                        {addedKeywords.map((kw) => (
                          <span key={kw} className="pro-chip pro-chip--kw">{kw}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="added-section__empty">No new keywords matched</p>
                    )}
                  </div>
                </div>
              </article>

              {sessionId && (
                <button type="button" className="pro-report__link" onClick={handleDownloadScoreReport}>
                  Download score report (PDF)
                </button>
              )}
              {sessionId && enhancedBlob && (
                readyForDownload ? (
                  <a href={getDownloadUrl(sessionId)} className="btn btn--navy pro-report__cta" download>
                    Download Enhanced DOCX
                  </a>
                ) : (
                  <button type="button" className="btn btn--navy pro-report__cta" disabled>
                    <span className="btn-spinner" />
                    {polishLabel}
                  </button>
                )
              )}
              <p className="pro-section__sub" style={{ marginTop: 14, textAlign: 'center' }}>
                Need a layout fix? Use the sticky AI Assistant.
              </p>
            </div>
          )}
        </aside>

        <section className="pro-split__preview" aria-label="Resume preview">
          <div className="pro-preview__toolbar">
            {enhancedBlob ? (
              <div className="pro-toggle" role="group" aria-label="Resume version">
                <button
                  type="button"
                  className={`pro-toggle__btn ${previewMode === 'original' ? 'is-active' : ''}`}
                  onClick={() => setPreviewMode('original')}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={`pro-toggle__btn ${previewMode === 'enhanced' ? 'is-active' : ''}`}
                  onClick={() => setPreviewMode('enhanced')}
                >
                  Rewritten
                </button>
              </div>
            ) : (
              <span className="pro-app__kicker">Resume preview</span>
            )}
            {enhancedBlob && previewMode === 'enhanced' && (
              <div className="pro-preview__legend">
                <span><span className="pro-preview__swatch pro-preview__swatch--green" /> Added</span>
                <span><span className="pro-preview__swatch pro-preview__swatch--yellow" /> Rewritten</span>
              </div>
            )}
          </div>
          {previewBlob ? (
            <div className="pro-preview__frame">
              <DocumentPreview
                blob={previewBlob}
                fileType={previewType}
                emptyLabel="Upload a resume to preview it here"
              />
            </div>
          ) : (
            <div className="pro-preview__empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <strong>Your resume will appear here</strong>
              <span>Upload a PDF or DOCX on the left to preview it beside your score.</span>
            </div>
          )}
        </section>
      </div>

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
