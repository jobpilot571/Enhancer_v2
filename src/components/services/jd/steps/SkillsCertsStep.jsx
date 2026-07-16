import FormField from '../../FormField'
import { emptyCertification, emptySkillCategories } from '../jdProjectModel'

function parseChipInput(raw) {
  return String(raw || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function SkillsCertsStep({ project, onChange }) {
  const skills = project.skills || emptySkillCategories()
  const certifications = project.certifications || []

  function setCategory(cat, raw) {
    onChange({
      ...project,
      skills: { ...skills, [cat]: parseChipInput(raw) },
    })
  }

  function patchCert(index, field, value) {
    onChange({
      ...project,
      certifications: certifications.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Skills & Certifications</h4>
        <p className="jd-step__desc">
          Organize skills by category. Final skills will also be refined from the JD and approved reference material.
        </p>
      </header>

      <div className="form-grid">
        {Object.keys(skills).map((cat) => (
          <FormField
            key={cat}
            label={cat}
            rows={1}
            value={(skills[cat] || []).join(', ')}
            onChange={(e) => setCategory(cat, e.target.value)}
            placeholder="Comma-separated"
            className="form-field--full"
          />
        ))}
      </div>

      <h5 className="jd-step__subtitle">Certifications</h5>
      {certifications.length === 0 && (
        <p className="builder-hint">No certifications added yet.</p>
      )}
      {certifications.map((cert, index) => (
        <div key={cert.id} className="builder-company">
          <div className="jd-step__row-head">
            <h4 className="builder-company__title">Certification {index + 1}</h4>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                onChange({
                  ...project,
                  certifications: certifications.filter((_, i) => i !== index),
                })
              }
            >
              Remove
            </button>
          </div>
          <div className="form-grid">
            <FormField label="Certification name" value={cert.name} onChange={(e) => patchCert(index, 'name', e.target.value)} />
            <FormField label="Issuing organization" value={cert.organization} onChange={(e) => patchCert(index, 'organization', e.target.value)} />
            <FormField label="Date" value={cert.date} onChange={(e) => patchCert(index, 'date', e.target.value)} placeholder="e.g. 2023" />
            <FormField label="Credential ID (optional)" value={cert.credentialId} onChange={(e) => patchCert(index, 'credentialId', e.target.value)} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--outline"
        onClick={() => onChange({ ...project, certifications: [...certifications, emptyCertification()] })}
      >
        Add certification
      </button>
    </div>
  )
}
