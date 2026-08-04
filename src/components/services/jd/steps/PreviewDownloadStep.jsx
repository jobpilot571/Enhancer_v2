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

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Preview</h4>
        <p className="jd-step__desc">
          {building
            ? (buildStepLabel || 'Building your resume…')
            : previewBlob
              ? `Generated resume${builtRole ? ` · ${builtRole}` : ''}. Use the sticky AI Assistant (bottom-right) if you need changes.`
              : 'Build a resume, then use the sticky AI Assistant anytime if you get stuck.'}
        </p>
      </header>

      {building && !previewBlob && (
        <p className="enhancer-progress">{buildStepLabel || 'Building resume…'}</p>
      )}

      {previewBlob ? (
        <div className="builder-preview-panel">
          <div className="upload-box">
            <div className="upload-box__content upload-box__content--docx">
              <DocumentPreview blob={previewBlob} fileType="docx" emptyLabel="Preview will appear here" />
            </div>
          </div>
        </div>
      ) : (
        !building && (
          <p className="builder-hint">
            No resume yet. Choose a template and click Build Resume.
          </p>
        )
      )}

      {saveNotice && <p className="builder-hint" role="status">{saveNotice}</p>}
      {saveError && <p className="builder-error" role="alert">{saveError}</p>}

      <div className="form-cta form-cta--nav" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn--outline btn--xl"
          onClick={onStartNew}
          disabled={building || saving}
        >
          Build new resume
        </button>
        {previewBlob && (
          <button
            type="button"
            className="btn btn--primary btn--xl"
            onClick={handleDownload}
            disabled={building || saving}
          >
            {saving ? 'Saving…' : 'Download DOCX'}
          </button>
        )}
      </div>
    </div>
  )
}
