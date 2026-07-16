import DocumentPreview from '../../DocumentPreview'

export default function PreviewDownloadStep({
  previewBlob,
  builtRole,
  downloadUrl,
  building,
  buildStepLabel,
}) {
  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Preview</h4>
        <p className="jd-step__desc">
          {building
            ? (buildStepLabel || 'Building your resume…')
            : previewBlob
              ? `Generated resume${builtRole ? ` · ${builtRole}` : ''}`
              : 'Your generated resume will appear here after Build.'}
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

      {previewBlob && downloadUrl && (
        <div className="form-cta form-cta--nav" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <a href={downloadUrl} className="btn btn--primary btn--xl" download>
            Download DOCX
          </a>
        </div>
      )}
    </div>
  )
}
