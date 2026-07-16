import { RESUME_TEMPLATES } from '../../../../data/resumeTemplates'
import TemplatePreview from '../../TemplatePreview'
import { JD_PRODUCT_TEMPLATES } from '../jdProjectModel'

export default function TemplateStep({
  project,
  onChange,
  templateSamples = {},
  sampleBlobs = {},
  getSampleFileUrl,
  onBuild,
  building = false,
  buildStepLabel = '',
  signedIn = true,
}) {
  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Templates</h4>
        <p className="jd-step__desc">
          Choose a layout, then build your JD-tailored resume.
        </p>
      </header>

      <div className="template-grid">
        {JD_PRODUCT_TEMPLATES.map((prod) => {
          const tpl = RESUME_TEMPLATES.find((t) => t.id === prod.id) || RESUME_TEMPLATES[0]
          const sample = templateSamples[tpl.id]
          return (
            <button
              key={prod.id}
              type="button"
              className={`template-card ${project.selectedTemplateId === prod.id ? 'is-selected' : ''}`}
              onClick={() => onChange({ ...project, selectedTemplateId: prod.id })}
              disabled={building}
            >
              <div className="template-card__preview">
                <TemplatePreview
                  template={tpl}
                  sampleBlob={sampleBlobs[tpl.id] || null}
                  sampleFileType={sample?.fileType || null}
                  sampleUrl={sample && getSampleFileUrl ? getSampleFileUrl(tpl.id) : null}
                />
              </div>
              <div className="template-card__meta">
                <span className="template-card__name">{prod.productName}</span>
                <span className="template-card__desc">{prod.useCase}</span>
                <span className="builder-hint">
                  {prod.columns} column · ~{prod.estimatedPages} pages
                </span>
              </div>
              {project.selectedTemplateId === prod.id && (
                <span className="template-card__check" aria-hidden="true">✓</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="form-cta form-cta--nav jd-templates-build">
        <button
          type="button"
          className="btn btn--primary btn--xl"
          onClick={onBuild}
          disabled={building || !project.selectedTemplateId}
        >
          {building ? (
            <>
              <span className="btn-spinner" />
              {buildStepLabel || 'Building…'}
            </>
          ) : (
            'Build Resume'
          )}
        </button>
        {!signedIn && (
          <p className="builder-hint" style={{ width: '100%', textAlign: 'right', marginTop: 8 }}>
            Sign in first, then click Build Resume.
          </p>
        )}
      </div>
    </div>
  )
}
