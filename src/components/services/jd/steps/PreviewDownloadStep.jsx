import { useState } from 'react'
import DocumentPreview from '../../DocumentPreview'

export default function PreviewDownloadStep({
  previewBlob,
  builtRole,
  downloadUrl,
  building,
  buildStepLabel,
  onStartNew,
  onDownloadAndSave,
  onRebuild,
  onOpenSaved,
}) {
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [saveError, setSaveError] = useState('')

  async function handleDownload() {
    if (!previewBlob || saving) return
    setSaving(true)
    setSaveError('')
    setSaveNotice('')
    try {
      await onDownloadAndSave?.()
      setSaveNotice('Downloaded and saved to Saved Resumes.')
    } catch (err) {
      setSaveError(err.message || 'Download failed.')
      if (downloadUrl) {
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = ''
        a.click()
      }
    } finally {
      setSaving(false)
    }
  }

  const ready = Boolean(previewBlob) && !building
  const stepText = buildStepLabel || 'Preparing your resume…'

  return (
    <div className="jd-step jd-step--preview pro-split">
      <aside className="pro-split__report">
        <div className="pro-recap">
          <h2 className="pro-recap__title">
            {ready ? 'Your resume is ready.' : building ? 'Building your resume…' : 'Preview your JD-tailored resume'}
          </h2>
          <p className="pro-recap__lede">
            {ready
              ? `Generated${builtRole ? ` for ${builtRole}` : ''}. Review it on the right, then download your DOCX.`
              : building
                ? stepText
                : 'Build from the Templates step, then your resume appears beside this report.'}
          </p>
          <ul className="pro-recap__list">
            <li>
              <span className="pro-recap__dot" aria-hidden="true">1</span>
              Tailored to the job description you pasted
            </li>
            <li>
              <span className="pro-recap__dot" aria-hidden="true">2</span>
              ATS-friendly template and section order
            </li>
            <li>
              <span className="pro-recap__dot" aria-hidden="true">3</span>
              Download DOCX, or ask the AI Assistant for layout tweaks
            </li>
          </ul>
          {saveNotice && <p className="builder-hint" role="status">{saveNotice}</p>}
          {saveError && <p className="builder-error" role="alert">{saveError}</p>}
          <button
            type="button"
            className="btn btn--navy pro-report__cta"
            onClick={handleDownload}
            disabled={!ready || saving}
          >
            {saving ? 'Saving…' : 'Download DOCX'}
          </button>
          <button
            type="button"
            className="btn btn--ghost-navy pro-report__cta"
            onClick={onRebuild}
            disabled={building || saving}
          >
            {building ? stepText : previewBlob ? 'Rebuild Resume' : 'Build Resume'}
          </button>
          <button type="button" className="pro-report__link" onClick={onOpenSaved} disabled={building}>
            Saved Resumes
          </button>
          <button type="button" className="pro-report__link" onClick={onStartNew} disabled={building || saving}>
            Build a new resume
          </button>
        </div>
      </aside>
      <section className="pro-split__preview" aria-label="Resume preview">
        <div className="pro-preview__toolbar">
          <span className="pro-app__kicker">{builtRole ? `JD-tailored · ${builtRole}` : 'Resume preview'}</span>
        </div>
        {previewBlob ? (
          <div className="pro-preview__frame">
            <DocumentPreview
              blob={previewBlob}
              fileType="docx"
              maxScale={0.87}
              emptyLabel="Your resume will appear here after you click Build Resume"
            />
          </div>
        ) : (
          <div className="pro-preview__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <strong>{building ? 'Preparing your resume' : 'Your resume will appear here'}</strong>
            <span>{building ? stepText : 'Click Build Resume to generate a JD-tailored DOCX preview.'}</span>
          </div>
        )}
      </section>
    </div>
  )
}
