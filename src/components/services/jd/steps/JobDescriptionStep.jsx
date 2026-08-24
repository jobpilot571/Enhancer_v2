import { useEffect, useRef, useState } from 'react'
import { analyzeJdText, analyzeJdFile } from '../../../../api/jdBuilder'

const AUTO_ANALYZE_MIN_CHARS = 80
const AUTO_ANALYZE_DEBOUNCE_MS = 1200

export default function JobDescriptionStep({ project, onChange }) {
  const fileRef = useRef(null)
  const analyzeTimer = useRef(null)
  const lastAnalyzedText = useRef('')
  const t = project.targetRole || {}
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeNotice, setAnalyzeNotice] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')

  function patch(partial) {
    onChange({
      ...project,
      targetRole: { ...t, ...partial },
    })
  }

  async function applyAnalysis(result, fileName = '') {
    const roleTitle = String(result?.roleTitle || '').trim()
    const yearsRequired = result?.yearsRequired != null && result.yearsRequired !== ''
      ? String(result.yearsRequired)
      : ''
    const jdText = result?.jdText
      ? String(result.jdText).slice(0, 50000)
      : String(t.jobDescription || '')
    const next = {
      ...(fileName ? { jdFileName: fileName } : {}),
      ...(jdText ? { jobDescription: jdText } : {}),
    }
    if (roleTitle) next.jobTitle = roleTitle
    if (yearsRequired !== '') next.yearsRequired = yearsRequired

    // Prefill first company role with target role when blank
    let experiences = project.experiences || []
    if (roleTitle && experiences.length) {
      experiences = experiences.map((e, i) => (
        i === 0 && !String(e.jobTitle || '').trim()
          ? { ...e, jobTitle: roleTitle }
          : e
      ))
    }

    onChange({
      ...project,
      experiences,
      targetRole: { ...t, ...next },
    })

    lastAnalyzedText.current = String(next.jobDescription || jdText || '').trim()

    const bits = []
    if (roleTitle) bits.push(`role “${roleTitle}”`)
    if (yearsRequired !== '') bits.push(`${yearsRequired}+ years required`)
    setAnalyzeNotice(
      bits.length
        ? `Detected ${bits.join(' · ')} — saved to Target Role for review.`
        : 'Job description saved. You can set the target role on the next step if needed.',
    )
  }

  async function analyzeText(text, fileName = '') {
    const cleaned = String(text || '').trim()
    if (cleaned.length < AUTO_ANALYZE_MIN_CHARS) {
      setAnalyzeError('Paste a fuller job description first (at least a few sentences).')
      return
    }
    if (analyzing) return
    if (cleaned === lastAnalyzedText.current && !fileName) return

    setAnalyzing(true)
    setAnalyzeError('')
    setAnalyzeNotice('')
    try {
      const result = await analyzeJdText(cleaned)
      await applyAnalysis({ ...result, jdText: cleaned }, fileName)
    } catch (err) {
      setAnalyzeError(err.message || 'Could not analyze that job description.')
      patch({ jobDescription: cleaned, ...(fileName ? { jdFileName: fileName } : {}) })
    } finally {
      setAnalyzing(false)
    }
  }

  // Auto-extract role + years after the user finishes pasting/typing a JD
  useEffect(() => {
    const text = String(t.jobDescription || '').trim()
    clearTimeout(analyzeTimer.current)
    if (text.length < AUTO_ANALYZE_MIN_CHARS) return undefined
    if (text === lastAnalyzedText.current) return undefined
    analyzeTimer.current = setTimeout(() => {
      analyzeText(text)
    }, AUTO_ANALYZE_DEBOUNCE_MS)
    return () => clearTimeout(analyzeTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.jobDescription])

  async function handleUpload(file) {
    if (!file) return
    const lower = file.name.toLowerCase()
    setAnalyzing(true)
    setAnalyzeError('')
    setAnalyzeNotice('')
    try {
      if (lower.endsWith('.txt') || lower.endsWith('.md')) {
        const text = await file.text()
        await analyzeText(text, file.name)
        return
      }
      if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
        const result = await analyzeJdFile(file)
        await applyAnalysis(result, file.name)
        return
      }
      setAnalyzeError('Please upload a .txt, .md, .pdf, or .docx file.')
    } catch (err) {
      setAnalyzeError(err.message || 'Could not read that JD file.')
      patch({ jdFileName: file.name })
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Job Description</h4>
        <p className="jd-step__desc">
          Paste or upload the job description. Target role and required experience are detected automatically and filled on the Target step.
        </p>
      </header>

      <div className="form-field form-field--full">
        <label className="form-field__label">Paste job description</label>
        <div className="jd-input-area">
          <textarea
            className="form-field__input form-field__textarea jd-input-area__text"
            rows={14}
            placeholder="Paste the full job description here…"
            value={t.jobDescription || ''}
            disabled={analyzing}
            onChange={(e) => {
              setAnalyzeNotice('')
              setAnalyzeError('')
              patch({ jobDescription: e.target.value })
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) await handleUpload(file)
            }}
          />
          <div className="jd-input-area__actions">
            <button
              type="button"
              className="jd-input-area__upload"
              disabled={analyzing}
              onClick={() => fileRef.current?.click()}
            >
              {analyzing ? 'Analyzing…' : 'Upload JD (PDF / DOCX / TXT)'}
            </button>
            {analyzing && (
              <span className="builder-hint" role="status">Detecting role and experience…</span>
            )}
          </div>
        </div>
        {t.jdFileName && <p className="builder-hint">Last file: {t.jdFileName}</p>}
        {analyzeNotice && <p className="builder-hint" role="status">{analyzeNotice}</p>}
        {analyzeError && <p className="builder-error" role="alert">{analyzeError}</p>}
      </div>
    </div>
  )
}
