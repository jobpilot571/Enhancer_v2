import { useRef } from 'react'

export default function JobDescriptionStep({ project, onChange, onUploadJdFile }) {
  const fileRef = useRef(null)
  const t = project.targetRole || {}

  function patch(partial) {
    onChange({
      ...project,
      targetRole: { ...t, ...partial },
    })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Job Description</h4>
        <p className="jd-step__desc">
          Paste or upload the job description. We use it to tailor the resume — we never copy the JD text into your resume.
        </p>
      </header>

      <div className="form-field form-field--full">
        <label className="form-field__label">Job description</label>
        <div className="jd-input-area">
          <textarea
            className="form-field__input form-field__textarea jd-input-area__text"
            rows={14}
            placeholder="Paste the full job description here…"
            value={t.jobDescription || ''}
            onChange={(e) => patch({ jobDescription: e.target.value })}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (onUploadJdFile) {
                await onUploadJdFile(file)
              } else {
                try {
                  const text = await file.text()
                  patch({ jobDescription: text.slice(0, 50000), jdFileName: file.name })
                } catch {
                  // ignore
                }
              }
              e.target.value = ''
            }}
          />
          <button type="button" className="jd-input-area__upload" onClick={() => fileRef.current?.click()}>
            Upload JD (PDF / DOCX / TXT)
          </button>
        </div>
        {t.jdFileName && <p className="builder-hint">Last file: {t.jdFileName}</p>}
      </div>
    </div>
  )
}
