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
  const preparing = building && !previewBlob
  const stepText = buildStepLabel || 'Preparing your resume…'

  return (
    <div className="jd-step jd-step--preview">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Preview</h4>
        <p className="jd-step__desc">
          {preparing
            ? stepText
            : previewBlob
              ? `Generated resume${builtRole ? ` · ${builtRole}` : ''}. Preview it below, then download your DOCX.`
              : 'Build a resume, then preview and download it here.'}
        </p>
      </header>

      <section
        className="enhance-preview-block enhance-preview-block--section jd-preview-block"
        aria-label="Resume preview"
      >
        <div className="resume-enhancer-workspace resume-enhancer-workspace--previews jd-preview-workspace">
          <div className="upload-box">
            <div className="upload-box__header">
              <div className="upload-box__label-group">
                <div>
                  <h4 className="upload-box__label">Your Resume</h4>
                  <p className="upload-box__sublabel">
                    {preparing
                      ? 'Preparing preview…'
                      : builtRole
                        ? `JD-tailored · ${builtRole}`
                        : 'Optimized content, DOCX preview'}
                  </p>
                </div>
              </div>
            </div>
            <div className="upload-box__content upload-box__content--docx">
              {preparing ? (
                <div className="jd-preview-preparing" role="status" aria-live="polite" aria-busy="true">
                  <span className="btn-spinner jd-preview-preparing__spinner" aria-hidden="true" />
                  <strong className="jd-preview-preparing__title">Your resume is preparing</strong>
                  <span className="jd-preview-preparing__step">{stepText}</span>
                  <span className="jd-preview-preparing__hint">This usually takes about a minute. Please keep this tab open.</span>
                </div>
              ) : (
                <DocumentPreview
                  blob={previewBlob}
                  fileType="docx"
                  maxScale={0.87}
                  emptyLabel="Your resume will appear here after you click Build Resume"
                />
              )}
            </div>
          </div>
        </div>

        {(ready || preparing) && (
          <div className={`enhancer-ready ${ready ? 'enhancer-ready--ok' : 'enhancer-ready--pending'}`}>
            <div className="enhancer-ready__copy">
              <strong>
                {ready ? 'Your resume is ready' : 'Preparing your resume'}
              </strong>
              <span>
                {ready
                  ? 'Preview it above, then download your DOCX.'
                  : stepText}
              </span>
            </div>

            {ready ? (
              <button
                type="button"
                className="btn btn--primary btn--xl enhancer-download-btn"
                onClick={handleDownload}
                disabled={saving}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {saving ? 'Saving…' : 'Download DOCX'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--xl enhancer-download-btn enhancer-download-btn--busy"
                disabled
                aria-busy="true"
              >
                <span className="btn-spinner" />
                {stepText}
              </button>
            )}
          </div>
        )}

        {ready && (
          <p className="enhancer-assistant-hint">
            Need changes? Use the sticky <strong>AI Assistant</strong> (bottom-right) — attach a screenshot if helpful.
          </p>
        )}
      </section>

      {saveNotice && <p className="builder-hint" role="status">{saveNotice}</p>}
      {saveError && <p className="builder-error" role="alert">{saveError}</p>}

      <div className="form-cta form-cta--nav jd-preview-secondary-cta">
        <button
          type="button"
          className="btn btn--outline btn--xl"
          onClick={onStartNew}
          disabled={building || saving}
        >
          Build new resume
        </button>
      </div>
    </div>
  )
}
