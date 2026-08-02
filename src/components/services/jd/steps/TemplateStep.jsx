import { RESUME_TEMPLATES } from '../../../../data/resumeTemplates'
import TemplatePreview from '../../TemplatePreview'
import {
  JD_FONT_OPTIONS,
  JD_FONT_SIZE_OPTIONS,
  JD_PRODUCT_TEMPLATES,
} from '../jdProjectModel'

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
          Choose a layout, font, and optional keyword highlighting, then build your JD-tailored resume.
        </p>
      </header>

      <section className="jd-panel-card jd-template-options" aria-label="Font and highlight options">
        <h5 className="jd-panel-card__title">Typography & highlights</h5>
        <div className="form-grid form-grid--2">
          <label className="form-field">
            <span className="form-field__label">Font style</span>
            <select
              className="form-field__input"
              value={project.fontFamily || 'Calibri'}
              disabled={building}
              onChange={(e) => onChange({ ...project, fontFamily: e.target.value })}
            >
              {JD_FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-field__label">Font size</span>
            <select
              className="form-field__input"
              value={String(project.fontSizePt || '12')}
              disabled={building}
              onChange={(e) => onChange({ ...project, fontSizePt: e.target.value })}
            >
              {JD_FONT_SIZE_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="jd-template-options__check">
          <input
            type="checkbox"
            checked={Boolean(project.keywordHighlight)}
            disabled={building}
            onChange={(e) => onChange({ ...project, keywordHighlight: e.target.checked })}
          />
          <span>Keyword highlight (bold JD/skills terms in bullets)</span>
        </label>
        <p className="builder-hint">Default is 12 pt with no keyword highlighting.</p>
      </section>

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
