import { collectWarnings, JD_PRODUCT_TEMPLATES } from '../jdProjectModel'

export default function BuildReviewStep({ project, building, buildStepLabel }) {
  const b = project.basicInformation || {}
  const t = project.targetRole || {}
  const warnings = collectWarnings(project)
  const approved = (project.referenceItems || []).filter((i) => i.approved).length
  const tpl = JD_PRODUCT_TEMPLATES.find((x) => x.id === project.selectedTemplateId)

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Build</h4>
        <p className="jd-step__desc">
          Review your package before generation. Warnings do not block build unless a required field is missing.
        </p>
      </header>

      <div className="jd-build-summary">
        <div className="jd-build-summary__card">
          <h5>Contact</h5>
          <p>{b.fullName || '—'} · {b.email || '—'} · {b.phone || '—'}</p>
          <p>{[b.city, b.state].filter(Boolean).join(', ') || '—'}</p>
        </div>
        <div className="jd-build-summary__card">
          <h5>Target role</h5>
          <p>{t.jobTitle || '—'}</p>
          <p>{Number(t.yearsOfExperience) || '—'} years · JD {String(t.jobDescription || '').length} chars</p>
        </div>
        <div className="jd-build-summary__card">
          <h5>Experience</h5>
          <p>{(project.experiences || []).filter((e) => e.companyName).length} companies</p>
          <p>JD length: {String(t.jobDescription || '').length} characters</p>
        </div>
        <div className="jd-build-summary__card">
          <h5>References & template</h5>
          <p>{approved} approved reference items</p>
          <p>{tpl?.productName || project.selectedTemplateId || '—'}</p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="jd-warnings" role="status">
          <strong>Warnings</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {building && (
        <p className="enhancer-progress">{buildStepLabel || 'Building resume…'}</p>
      )}

      <p className="builder-hint">
        Phase 3 uses the existing JD-builder generation bridge. Full reference-aware generation arrives in Phase 6.
      </p>
    </div>
  )
}
