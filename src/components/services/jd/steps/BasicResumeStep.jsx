import FormField from '../../FormField'
import { emptyEducation } from '../jdProjectModel'

export default function BasicResumeStep({ project, onChange, onUploadBasicResume, uploading }) {
  const b = project.basicInformation

  function patch(partial) {
    onChange({
      ...project,
      basicInformation: { ...b, ...partial },
    })
  }

  function patchEdu(index, field, value) {
    const education = (b.education || []).map((e, i) =>
      i === index ? { ...e, [field]: value } : e,
    )
    patch({ education })
  }

  function addEducation() {
    patch({ education: [...(b.education || []), emptyEducation()] })
  }

  function removeEducation(index) {
    const education = (b.education || []).filter((_, i) => i !== index)
    patch({ education: education.length ? education : [emptyEducation()] })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Basic Information</h4>
        <p className="jd-step__desc">
          Upload an existing resume (any role) to auto-fill contact and education only.
          Work history, skills, and summary from that file are ignored.
        </p>
      </header>

      <div className="jd-upload-panel">
        <div className="jd-upload-panel__row">
          <div>
            <strong>Basic resume upload</strong>
            <p className="builder-hint">DOCX or PDF. Extraction is contact + education only.</p>
            {b.basicResumeFileName && (
              <p className="jd-upload-panel__file">
                Loaded: {b.basicResumeFileName}
                {b.basicResumeExtracted ? ' · fields updated — review below' : ''}
              </p>
            )}
          </div>
          <label className={`btn btn--outline ${uploading ? 'is-disabled' : ''}`}>
            {uploading ? 'Extracting…' : 'Upload resume'}
            <input
              type="file"
              accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadBasicResume?.(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>

      <div className="form-grid">
        <FormField
          label="Full name"
          value={b.fullName}
          onChange={(e) => patch({ fullName: e.target.value })}
          placeholder="Full name"
          required
        />
        <FormField
          label="Email"
          type="email"
          value={b.email}
          onChange={(e) => patch({ email: e.target.value })}
          placeholder="you@email.com"
          required
        />
        <FormField
          label="Phone"
          value={b.phone}
          onChange={(e) => patch({ phone: e.target.value })}
          placeholder="e.g. 414-555-0123"
          required
        />
        <FormField
          label="LinkedIn"
          value={b.linkedin}
          onChange={(e) => patch({ linkedin: e.target.value })}
          placeholder="linkedin.com/in/…"
        />
        <FormField
          label="City"
          value={b.city}
          onChange={(e) => patch({ city: e.target.value })}
          placeholder="City"
        />
        <FormField
          label="State"
          value={b.state}
          onChange={(e) => patch({ state: e.target.value })}
          placeholder="State"
        />
      </div>

      <h5 className="jd-step__subtitle">Education</h5>
      {(b.education || []).map((edu, index) => (
        <div key={edu.id || index} className="builder-company">
          <div className="jd-step__row-head">
            <h4 className="builder-company__title">Education {index + 1}</h4>
            {(b.education || []).length > 1 && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeEducation(index)}>
                Remove
              </button>
            )}
          </div>
          <div className="form-grid">
            <FormField label="Degree" value={edu.degree} onChange={(e) => patchEdu(index, 'degree', e.target.value)} placeholder="e.g. B.S." />
            <FormField label="Major" value={edu.major} onChange={(e) => patchEdu(index, 'major', e.target.value)} placeholder="e.g. Computer Science" />
            <FormField label="University / college" value={edu.school} onChange={(e) => patchEdu(index, 'school', e.target.value)} placeholder="School name" className="form-field--full" />
            <FormField label="Location" value={edu.location} onChange={(e) => patchEdu(index, 'location', e.target.value)} placeholder="City, State" />
            <FormField label="Graduation year" value={edu.graduationYear} onChange={(e) => patchEdu(index, 'graduationYear', e.target.value)} placeholder="e.g. 2020" />
            <FormField label="GPA (optional)" value={edu.gpa} onChange={(e) => patchEdu(index, 'gpa', e.target.value)} placeholder="Only if on resume" />
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--outline" onClick={addEducation}>
        Add education
      </button>
    </div>
  )
}
