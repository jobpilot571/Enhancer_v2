import { useRef, useState } from 'react'
import FormField from '../../FormField'
import { analyzeJdText, analyzeJdFile } from '../../../../api/jdBuilder'

export default function JobDescriptionStep({ project, onChange }) {
  const fileRef = useRef(null)
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
    const next = {
      ...(fileName ? { jdFileName: fileName } : {}),
      ...(result?.jdText ? { jobDescription: String(result.jdText).slice(0, 50000) } : {}),
    }
    if (roleTitle) next.jobTitle = roleTitle
    if (yearsRequired !== '') next.yearsRequired = yearsRequired

    // Prefill company role with target role when blank
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

    const bits = []
    if (roleTitle) bits.push(`role “${roleTitle}”`)
    if (yearsRequired !== '') bits.push(`${yearsRequired}+ years required`)
    setAnalyzeNotice(
      bits.length
        ? `Extracted ${bits.join(' · ')}. You can edit these below.`
        : 'JD saved. Enter the target role manually if it was not detected.',
    )
  }

  async function analyzeText(text, fileName = '') {
    const cleaned = String(text || '').trim()
    if (cleaned.length < 40) {
      setAnalyzeError('Paste a fuller job description first (at least a few sentences).')
      return
    }
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
          Paste or upload the JD. We extract the target role and required years of experience — both stay editable.
        </p>
      </header>

      <div className="form-field form-field--full">
        <label className="form-field__label">Job description</label>
        <div className="jd-input-area">
          <textarea
            className="form-field__input form-field__textarea jd-input-area__text"
            rows={12}
            placeholder="Paste the full job description here…"
            value={t.jobDescription || ''}
            disabled={analyzing}
            onChange={(e) => {
              setAnalyzeNotice('')
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
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={analyzing || String(t.jobDescription || '').trim().length < 40}
              onClick={() => analyzeText(t.jobDescription)}
            >
              {analyzing ? 'Extracting…' : 'Extract role & experience'}
            </button>
          </div>
        </div>
        {t.jdFileName && <p className="builder-hint">Last file: {t.jdFileName}</p>}
        {analyzeNotice && <p className="builder-hint" role="status">{analyzeNotice}</p>}
        {analyzeError && <p className="builder-error" role="alert">{analyzeError}</p>}
      </div>

      <h5 className="jd-step__subtitle">From the JD (editable)</h5>
      <div className="form-grid form-grid--2">
        <FormField
          label="Target role"
          value={t.jobTitle || ''}
          onChange={(e) => patch({ jobTitle: e.target.value })}
          placeholder="e.g. Senior Data Analyst"
          required
        />
        <FormField
          label="Required years of experience"
          type="number"
          min={0}
          max={50}
          value={t.yearsRequired ?? ''}
          onChange={(e) => patch({ yearsRequired: e.target.value })}
          placeholder="e.g. 5"
        />
      </div>
    </div>
  )
}
