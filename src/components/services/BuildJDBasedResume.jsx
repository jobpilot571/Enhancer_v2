import { useEffect, useRef, useState } from 'react'
import FormField from './FormField'
import DocumentPreview from './DocumentPreview'
import DocxViewer from './DocxViewer'
import { RESUME_TEMPLATES } from '../../data/resumeTemplates'
import TemplatePreview from './TemplatePreview'
import {
  checkApiHealth,
  startJdBuild,
  waitForJdBuild,
  getJdBuildStepLabel,
  fetchFileBlob,
  getDownloadUrl,
} from '../../api/jdBuilder'
import { fetchPublicTemplateSamples, getSampleFileUrl } from '../../api/admin'

const SECTIONS = [
  { id: 'basics', label: 'Basics' },
  { id: 'experience', label: 'Experience' },
  { id: 'jd', label: 'JD & Template' },
  { id: 'review', label: 'Build' },
]

const BULLET_OPTIONS = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 3),
  label: `${i + 3} points`,
}))

const COMPANY_COUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}))

function emptyCompany() {
  return {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    city: '',
    state: '',
    summary: '',
    bulletCount: '8',
  }
}

const initialForm = {
  name: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  role: '',
  yearsOfExperience: '',
  companyCount: '3',
  companies: [emptyCompany(), emptyCompany(), emptyCompany()],
  jdText: '',
  templateId: 'jd-classic',
}

function syncCompanies(companies, count) {
  const next = companies.slice(0, count)
  while (next.length < count) next.push(emptyCompany())
  return next
}

export function summaryBulletHint(years) {
  const y = Number(years)
  if (!Number.isFinite(y) || y < 0) return 'Enter years of experience to see summary length'
  if (y <= 4) return 'Summary: 5 bullets (1–4 years)'
  if (y <= 6) return 'Summary: 7 bullets (5–6 years)'
  if (y <= 10) return 'Summary: 10 bullets (7–10 years)'
  return 'Summary: 12+ bullets (10+ years)'
}

export default function BuildJDBasedResume() {
  const [activeSection, setActiveSection] = useState('basics')
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [apiOk, setApiOk] = useState(null)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [previewBlob, setPreviewBlob] = useState(null)
  const [builtRole, setBuiltRole] = useState('')
  const [templateSamples, setTemplateSamples] = useState({})
  const [sampleBlobs, setSampleBlobs] = useState({})
  const [samplePreview, setSamplePreview] = useState(null)
  const buildingRef = useRef(false)
  const jdFileRef = useRef(null)
  const sectionRefs = useRef({})

  useEffect(() => {
    let cancelled = false
    checkApiHealth().then((h) => {
      if (!cancelled) setApiOk(h.ok)
    })
    fetchPublicTemplateSamples()
      .then(async (data) => {
        const samples = data.samples || {}
        if (cancelled) return
        setTemplateSamples(samples)
        await Promise.all(
          Object.entries(samples).map(async ([id, info]) => {
            if (info?.fileType !== 'docx') return
            try {
              const res = await fetch(getSampleFileUrl(id))
              if (!res.ok) return
              const blob = await res.blob()
              if (!cancelled) {
                setSampleBlobs((prev) => ({ ...prev, [id]: blob }))
              }
            } catch {
              // CSS mockup fallback
            }
          }),
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const nodes = SECTIONS
      .map((s) => sectionRefs.current[s.id])
      .filter(Boolean)
    if (!nodes.length) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id.replace(/^jd-section-/, ''))
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.15, 0.35, 0.55] },
    )

    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  function scrollToSection(id) {
    setActiveSection(id)
    setError('')
    const el = sectionRefs.current[id]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  async function openSamplePreview(templateId, e) {
    e.stopPropagation()
    const info = templateSamples[templateId]
    if (!info) return
    setSamplePreview({ templateId, loading: true, blob: null, fileType: info.fileType, error: '' })
    try {
      const res = await fetch(getSampleFileUrl(templateId))
      if (!res.ok) throw new Error('Could not load sample')
      const blob = await res.blob()
      setSamplePreview({ templateId, loading: false, blob, fileType: info.fileType, error: '' })
    } catch (err) {
      setSamplePreview({
        templateId,
        loading: false,
        blob: null,
        fileType: info.fileType,
        error: err.message || 'Failed to load sample',
      })
    }
  }

  function updateField(e) {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    setError('')
  }

  function updateCompanyCount(e) {
    const count = Math.min(6, Math.max(1, Number(e.target.value) || 1))
    setForm((f) => ({
      ...f,
      companyCount: String(count),
      companies: syncCompanies(f.companies, count),
    }))
    setError('')
  }

  function updateCompany(index, field, value) {
    setForm((f) => {
      const companies = f.companies.map((c, i) =>
        i === index ? { ...c, [field]: value } : c,
      )
      return { ...f, companies }
    })
    setError('')
  }

  async function handleJdFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setForm((f) => ({ ...f, jdText: text.slice(0, 50000) }))
      setError('')
    } catch {
      setError('Could not read that file. Paste the JD instead.')
    }
    e.target.value = ''
  }

  function validateAll() {
    if (!form.name.trim()) return { msg: 'Please enter your name.', section: 'basics' }
    if (!form.email.trim()) return { msg: 'Please enter your email.', section: 'basics' }
    if (!form.phone.trim()) return { msg: 'Please enter your phone number.', section: 'basics' }
    if (!form.city.trim()) return { msg: 'Please enter your city.', section: 'basics' }
    if (!form.state.trim()) return { msg: 'Please enter your state.', section: 'basics' }
    if (!form.role.trim()) return { msg: 'Please enter the target role (should match the JD).', section: 'basics' }
    if (form.yearsOfExperience === '' || Number(form.yearsOfExperience) < 0) {
      return { msg: 'Please enter years of experience.', section: 'basics' }
    }
    if (!form.companyCount) return { msg: 'Select how many companies to include.', section: 'basics' }

    const count = Number(form.companyCount) || form.companies.length
    for (let i = 0; i < count; i++) {
      const c = form.companies[i] || {}
      if (!String(c.name || '').trim()) {
        return { msg: `Company ${i + 1}: enter the company name.`, section: 'experience' }
      }
      if (!String(c.role || '').trim()) {
        return { msg: `Company ${i + 1}: enter the role.`, section: 'experience' }
      }
      if (!String(c.startDate || '').trim()) {
        return { msg: `Company ${i + 1}: enter the start date.`, section: 'experience' }
      }
      if (!String(c.city || '').trim()) {
        return { msg: `Company ${i + 1}: enter the city.`, section: 'experience' }
      }
      if (!String(c.state || '').trim()) {
        return { msg: `Company ${i + 1}: enter the state.`, section: 'experience' }
      }
      const bullets = Number(c.bulletCount)
      if (!Number.isFinite(bullets) || bullets < 3 || bullets > 15) {
        return { msg: `Company ${i + 1}: select how many points you need (3–15).`, section: 'experience' }
      }
    }

    if (!form.jdText.trim() || form.jdText.trim().length < 80) {
      return { msg: 'Paste a full job description (at least a few sentences).', section: 'jd' }
    }
    if (!form.templateId) return { msg: 'Please select a resume template.', section: 'jd' }

    return null
  }

  function buildPayload() {
    const count = Number(form.companyCount) || form.companies.length
    return {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      role: form.role.trim(),
      yearsOfExperience: Number(form.yearsOfExperience) || 0,
      companyCount: count,
      templateId: form.templateId,
      jdText: form.jdText.trim(),
      companies: form.companies.slice(0, count).map((c) => ({
        name: c.name.trim(),
        role: c.role.trim(),
        startDate: c.startDate.trim(),
        endDate: c.endDate.trim(),
        city: c.city.trim(),
        state: c.state.trim(),
        summary: String(c.summary || '').trim(),
        bulletCount: Number(c.bulletCount) || 8,
      })),
    }
  }

  async function handleBuild() {
    const invalid = validateAll()
    if (invalid) {
      setError(invalid.msg)
      scrollToSection(invalid.section)
      return
    }

    if (buildingRef.current) return
    buildingRef.current = true
    setBuilding(true)
    setError('')
    setPreviewBlob(null)
    setBuiltRole('')
    setBuildStep('parsing_jd')
    scrollToSection('review')

    try {
      const payload = buildPayload()
      const { jobId, sessionId: sid } = await startJdBuild(payload)
      setSessionId(sid)

      const result = await waitForJdBuild(jobId, (status) => {
        setBuildStep(status.step || '')
      })

      const blob = await fetchFileBlob(result.sessionId || sid)
      setPreviewBlob(blob)
      setSessionId(result.sessionId || sid)
      setBuiltRole(result.roleTitle || payload.role)
      scrollToSection('review')
    } catch (err) {
      setError(err.message || 'Failed to build JD-tailored resume')
    } finally {
      setBuilding(false)
      buildingRef.current = false
    }
  }

  const companyCount = Number(form.companyCount) || form.companies.length
  const templatesOrdered = [
    ...RESUME_TEMPLATES.filter((t) => t.id === 'jd-classic'),
    ...RESUME_TEMPLATES.filter((t) => t.id !== 'jd-classic'),
  ]
  const activeIndex = SECTIONS.findIndex((s) => s.id === activeSection)

  function setSectionRef(id) {
    return (el) => {
      if (el) sectionRefs.current[id] = el
    }
  }

  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">03</span>
        <div>
          <h3 className="service-block__title">JD-Tailored Resume Builder</h3>
          <p className="service-block__desc">
            No resume yet? Paste a job description and your work history — we build a strongly JD-aligned DOCX from scratch.
          </p>
        </div>
      </div>

      {apiOk === false && (
        <div className="enhancer-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      <nav className="builder-steps builder-steps--sticky" aria-label="JD-tailored resume sections">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`builder-steps__item ${activeSection === s.id ? 'is-active' : ''} ${i < activeIndex ? 'is-done' : ''}`}
            onClick={() => scrollToSection(s.id)}
          >
            <span className="builder-steps__num">{i + 1}</span>
            <span className="builder-steps__label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="form-card form-card--one-page">
        <section
          id="jd-section-basics"
          ref={setSectionRef('basics')}
          className="jd-page-section"
        >
          <h4 className="jd-page-section__title">Basics</h4>
          <div className="form-grid">
            <FormField
              label="Name"
              name="name"
              placeholder="Full name"
              value={form.name}
              onChange={updateField}
              required
            />
            <FormField
              label="Role (should match JD)"
              name="role"
              placeholder="e.g. Sr. .NET Full Stack Developer"
              value={form.role}
              onChange={updateField}
              required
            />
            <FormField
              label="Email"
              name="email"
              type="email"
              placeholder="you@email.com"
              value={form.email}
              onChange={updateField}
              required
            />
            <FormField
              label="Phone"
              name="phone"
              type="tel"
              placeholder="e.g. 414-555-0123"
              value={form.phone}
              onChange={updateField}
              required
            />
            <FormField
              label="City"
              name="city"
              placeholder="City"
              value={form.city}
              onChange={updateField}
              required
            />
            <FormField
              label="State"
              name="state"
              placeholder="State"
              value={form.state}
              onChange={updateField}
              required
            />
            <FormField
              label="Years of experience"
              name="yearsOfExperience"
              type="number"
              min={0}
              max={50}
              placeholder="e.g. 7"
              value={form.yearsOfExperience}
              onChange={updateField}
              required
            />
            <FormField
              label="How many companies?"
              name="companyCount"
              options={COMPANY_COUNT_OPTIONS}
              placeholder="Select count"
              value={form.companyCount}
              onChange={updateCompanyCount}
              required
            />
            <p className="form-field form-field--full builder-hint">{summaryBulletHint(form.yearsOfExperience)}</p>
          </div>
        </section>

        <section
          id="jd-section-experience"
          ref={setSectionRef('experience')}
          className="jd-page-section"
        >
          <h4 className="jd-page-section__title">Experience</h4>
          <p className="builder-hint">
            Enter companies in any order — we sort present → past by dates on the resume.
          </p>
          <div className="builder-experience">
            {form.companies.slice(0, companyCount).map((company, index) => (
              <div key={index} className="builder-company">
                <h4 className="builder-company__title">Company {index + 1}</h4>
                <div className="form-grid">
                  <FormField
                    label="Company name"
                    placeholder="e.g. GEICO"
                    value={company.name}
                    onChange={(e) => updateCompany(index, 'name', e.target.value)}
                    required
                  />
                  <FormField
                    label="Role"
                    placeholder="e.g. Sr. .NET Full Stack Developer"
                    value={company.role}
                    onChange={(e) => updateCompany(index, 'role', e.target.value)}
                    required
                  />
                  <FormField
                    label="Start date"
                    placeholder="e.g. Nov 2024"
                    value={company.startDate}
                    onChange={(e) => updateCompany(index, 'startDate', e.target.value)}
                    required
                  />
                  <FormField
                    label="End date"
                    placeholder="e.g. Present"
                    value={company.endDate}
                    onChange={(e) => updateCompany(index, 'endDate', e.target.value)}
                  />
                  <FormField
                    label="City"
                    placeholder="City"
                    value={company.city}
                    onChange={(e) => updateCompany(index, 'city', e.target.value)}
                    required
                  />
                  <FormField
                    label="State"
                    placeholder="State / Remote"
                    value={company.state}
                    onChange={(e) => updateCompany(index, 'state', e.target.value)}
                    required
                  />
                  <FormField
                    label="How many points you need"
                    options={BULLET_OPTIONS}
                    placeholder="Select 3–15"
                    value={company.bulletCount}
                    onChange={(e) => updateCompany(index, 'bulletCount', e.target.value)}
                    required
                  />
                  <FormField
                    label="Summary (optional)"
                    rows={3}
                    placeholder="Optional guidance for this role’s bullets"
                    value={company.summary}
                    onChange={(e) => updateCompany(index, 'summary', e.target.value)}
                    className="form-field--full"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          id="jd-section-jd"
          ref={setSectionRef('jd')}
          className="jd-page-section"
        >
          <h4 className="jd-page-section__title">JD & Template</h4>
          <div className="jd-builder-jd-step">
            <div className="form-field form-field--full">
              <label className="form-field__label">Job description</label>
              <div className="jd-input-area">
                <textarea
                  className="form-field__input form-field__textarea jd-input-area__text"
                  name="jdText"
                  rows={8}
                  placeholder="Paste the full job description here…"
                  value={form.jdText}
                  onChange={updateField}
                />
                <input
                  ref={jdFileRef}
                  type="file"
                  accept=".txt,.md,text/plain"
                  className="sr-only"
                  onChange={handleJdFile}
                />
                <button
                  type="button"
                  className="jd-input-area__upload"
                  onClick={() => jdFileRef.current?.click()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Upload JD File
                </button>
              </div>
              <p className="builder-hint">
                The resume title will use the JD role. Skills and bullets are written to match this JD closely.
              </p>
            </div>

            <h4 className="builder-company__title">Template</h4>
            <div className="template-grid">
              {templatesOrdered.map((tpl) => {
                const sample = templateSamples[tpl.id]
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`template-card ${form.templateId === tpl.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      setForm((f) => ({ ...f, templateId: tpl.id }))
                      setError('')
                    }}
                  >
                    <div className="template-card__preview">
                      <TemplatePreview
                        template={tpl}
                        sampleBlob={sampleBlobs[tpl.id] || null}
                        sampleFileType={sample?.fileType || null}
                        sampleUrl={sample ? getSampleFileUrl(tpl.id) : null}
                      />
                      {sample && (
                        <span className="template-card__sample-badge">Sample ready</span>
                      )}
                    </div>
                    <div className="template-card__meta">
                      <span className="template-card__name">{tpl.name}</span>
                      <span className="template-card__desc">{tpl.description}</span>
                      {sample && (
                        <span
                          className="template-card__sample-link"
                          role="link"
                          tabIndex={0}
                          onClick={(e) => openSamplePreview(tpl.id, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') openSamplePreview(tpl.id, e)
                          }}
                        >
                          View sample doc
                        </span>
                      )}
                    </div>
                    {form.templateId === tpl.id && (
                      <span className="template-card__check" aria-hidden="true">✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {samplePreview && (
          <div
            className="sample-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Template sample preview"
            onClick={() => setSamplePreview(null)}
          >
            <div className="sample-modal__panel" onClick={(e) => e.stopPropagation()}>
              <div className="sample-modal__head">
                <h3>
                  {RESUME_TEMPLATES.find((t) => t.id === samplePreview.templateId)?.name || 'Template'}{' '}
                  sample
                </h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSamplePreview(null)}
                >
                  Close
                </button>
              </div>
              <div className="sample-modal__body">
                {samplePreview.loading && <p className="admin-muted">Loading sample…</p>}
                {samplePreview.error && <p className="builder-error">{samplePreview.error}</p>}
                {!samplePreview.loading && !samplePreview.error && samplePreview.fileType === 'pdf' && (
                  <iframe
                    title="Sample PDF"
                    className="sample-modal__pdf"
                    src={getSampleFileUrl(samplePreview.templateId)}
                  />
                )}
                {!samplePreview.loading && !samplePreview.error && samplePreview.fileType === 'docx' && (
                  <DocxViewer blob={samplePreview.blob} emptyLabel="Sample unavailable" />
                )}
              </div>
            </div>
          </div>
        )}

        <section
          id="jd-section-review"
          ref={setSectionRef('review')}
          className="jd-page-section"
        >
          <h4 className="jd-page-section__title">Build</h4>
          <div className="builder-review">
            {!previewBlob && !building && (
              <div className="builder-review__summary">
                <p>
                  Ready to build a JD-tailored resume for <strong>{form.name || '—'}</strong>
                  {' '}targeting <strong>{form.role || '—'}</strong> with {companyCount} compan
                  {companyCount === 1 ? 'y' : 'ies'}, using the{' '}
                  <strong>
                    {RESUME_TEMPLATES.find((t) => t.id === form.templateId)?.name || 'selected'}
                  </strong>{' '}
                  template. {summaryBulletHint(form.yearsOfExperience)}.
                </p>
              </div>
            )}

            {building && (
              <p className="enhancer-progress">{getJdBuildStepLabel(buildStep)}</p>
            )}

            {previewBlob && (
              <div className="builder-preview-panel">
                {builtRole && (
                  <p className="builder-hint">
                    Resume role from JD: <strong>{builtRole}</strong>
                  </p>
                )}
                <div className="upload-box">
                  <div className="upload-box__header">
                    <div className="upload-box__label-group">
                      <div>
                        <h4 className="upload-box__label">Your JD-Tailored Resume</h4>
                        <p className="upload-box__sublabel">Generated DOCX preview</p>
                      </div>
                    </div>
                  </div>
                  <div className="upload-box__content upload-box__content--docx">
                    <DocumentPreview
                      blob={previewBlob}
                      fileType="docx"
                      emptyLabel="Preview will appear here"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {error && <p className="builder-error" role="alert">{error}</p>}

        <div className="form-cta form-cta--nav">
          <button
            type="button"
            className="btn btn--primary btn--xl"
            onClick={handleBuild}
            disabled={building}
          >
            {building ? (
              <>
                <span className="btn-spinner" />
                {getJdBuildStepLabel(buildStep)}
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                {previewBlob ? 'Rebuild Resume' : 'Build JD-Based Resume'}
              </>
            )}
          </button>

          {previewBlob && sessionId && (
            <a href={getDownloadUrl(sessionId)} className="btn btn--outline btn--xl" download>
              Download DOCX
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
