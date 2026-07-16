import FormField from '../../FormField'

export default function ProfessionalProfileStep({ project, onChange }) {
  const p = project.profile

  function patch(partial) {
    onChange({
      ...project,
      profile: { ...p, ...partial },
    })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Professional Details</h4>
        <p className="jd-step__desc">
          Describe the professional identity for the new resume. This is not copied from a reference resume.
        </p>
      </header>

      <div className="form-grid">
        <FormField
          label="Desired professional title"
          value={p.desiredTitle}
          onChange={(e) => patch({ desiredTitle: e.target.value })}
          placeholder="Usually matches target job title"
        />
        <FormField
          label="Total years of experience"
          type="number"
          min={0}
          max={50}
          value={p.totalYears}
          onChange={(e) => patch({ totalYears: e.target.value })}
          placeholder="e.g. 5"
        />
        <FormField
          label="Industry experience"
          value={p.industryExperience}
          onChange={(e) => patch({ industryExperience: e.target.value })}
          placeholder="e.g. Banking, SaaS, Healthcare"
          className="form-field--full"
        />
        <FormField
          label="Main technical skills"
          rows={3}
          value={p.mainSkills}
          onChange={(e) => patch({ mainSkills: e.target.value })}
          placeholder="Comma-separated or short list"
          className="form-field--full"
        />
        <FormField
          label="Tools and technologies"
          rows={3}
          value={p.toolsAndTechnologies}
          onChange={(e) => patch({ toolsAndTechnologies: e.target.value })}
          placeholder="e.g. SQL, Power BI, Python, Azure"
          className="form-field--full"
        />
        <FormField
          label="Certifications (notes)"
          rows={2}
          value={p.certificationsNotes}
          onChange={(e) => patch({ certificationsNotes: e.target.value })}
          placeholder="Optional notes — detail them in Skills & Certifications"
          className="form-field--full"
        />
        <FormField
          label="Preferred professional summary direction"
          rows={3}
          value={p.summaryDirection}
          onChange={(e) => patch({ summaryDirection: e.target.value })}
          placeholder="e.g. Emphasize analytics delivery and stakeholder storytelling"
          className="form-field--full"
        />
      </div>
    </div>
  )
}
