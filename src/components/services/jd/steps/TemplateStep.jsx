import { useState } from 'react'
import { RESUME_TEMPLATES } from '../../../../data/resumeTemplates'
import TemplatePreview from '../../TemplatePreview'
import DocxViewer from '../../DocxViewer'
import {
  JD_FONT_OPTIONS,
  JD_FONT_SIZE_OPTIONS,
  JD_PRODUCT_TEMPLATES,
} from '../jdProjectModel'

function templateLabel(templateId) {
  return (
    JD_PRODUCT_TEMPLATES.find((p) => p.id === templateId)?.productName
    || RESUME_TEMPLATES.find((t) => t.id === templateId)?.name
    || templateId
  )
}

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
  const [samplePreview, setSamplePreview] = useState(null)

  function openSample(templateId, e) {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const sample = templateSamples[templateId]
    if (!sample) return
    setSamplePreview({
      templateId,
      name: templateLabel(templateId),
      fileType: sample.fileType,
      blob: sampleBlobs[templateId] || null,
      url: getSampleFileUrl ? getSampleFileUrl(templateId) : null,
    })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Templates</h4>
        <p className="jd-step__desc">
          Choose a layout, font, and optional keyword highlighting, then build your JD-tailored resume.
          Cards show the same readable design preview — scroll to compare fonts and spacing.
          Open “View full sample” when an admin sample is available.
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
        {RESUME_TEMPLATES.map((tpl) => {
          const sample = templateSamples[tpl.id]
          const product = JD_PRODUCT_TEMPLATES.find((p) => p.id === tpl.id)

          return (
            <div
              key={tpl.id}
              role="button"
              tabIndex={building ? -1 : 0}
              aria-pressed={project.selectedTemplateId === tpl.id}
              aria-disabled={building}
              className={`template-card ${project.selectedTemplateId === tpl.id ? 'is-selected' : ''} ${building ? 'is-disabled' : ''}`}
              onClick={() => {
                if (building) return
                onChange({ ...project, selectedTemplateId: tpl.id })
              }}
              onKeyDown={(e) => {
                if (building) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChange({ ...project, selectedTemplateId: tpl.id })
                }
              }}
            >
              <div className="template-card__preview">
                <TemplatePreview template={tpl} mode="card" />
                {sample && (
                  <span className="template-card__sample-badge">
                    {sample.demoGenerated ? 'Demo sample' : 'Sample ready'}
                  </span>
                )}
              </div>
              <div className="template-card__meta">
                <span className="template-card__name">
                  {product?.productName || tpl.name}
                </span>
                <span className="template-card__desc">
                  {product?.useCase || tpl.description}
                </span>
                {sample ? (
                  <span
                    className="template-card__sample-link"
                    role="link"
                    tabIndex={0}
                    onClick={(e) => openSample(tpl.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openSample(tpl.id, e)
                    }}
                  >
                    View full sample
                  </span>
                ) : (
                  <span className="builder-hint">No admin sample yet — layout mockup</span>
                )}
              </div>
              {project.selectedTemplateId === tpl.id && (
                <span className="template-card__check" aria-hidden="true">✓</span>
              )}
            </div>
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

      {samplePreview && (
        <div
          className="sample-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${samplePreview.name} sample`}
          onClick={() => setSamplePreview(null)}
        >
          <div className="sample-modal__panel" onClick={(e) => e.stopPropagation()}>
            <div className="sample-modal__head">
              <h3>{samplePreview.name} — sample</h3>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSamplePreview(null)}
              >
                Close
              </button>
            </div>
            <div className="sample-modal__body">
              {samplePreview.fileType === 'docx' && samplePreview.blob ? (
                <DocxViewer blob={samplePreview.blob} emptyLabel="Loading sample…" />
              ) : samplePreview.url ? (
                <iframe
                  title="Sample document"
                  className="sample-modal__pdf"
                  src={samplePreview.url}
                />
              ) : (
                <p className="builder-hint">Sample could not be loaded.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
