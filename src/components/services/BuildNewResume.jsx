import { useEffect, useRef, useState } from 'react'
import FormField from './FormField'
import DocumentPreview from './DocumentPreview'
import DocxViewer from './DocxViewer'
import SkillsPicker from './SkillsPicker'
import { RESUME_TEMPLATES } from '../../data/resumeTemplates'
import TemplatePreview from './TemplatePreview'
import {
  checkApiHealth,
  startBuild,
  waitForBuild,
  getBuildStepLabel,
  fetchFileBlob,
  getDownloadUrl,
} from '../../api/builder'
import { fetchPublicTemplateSamples, getSampleFileUrl } from '../../api/admin'

const STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'experience', label: 'Experience' },
  { id: 'summary', label: 'Summary' },
  { id: 'education', label: 'Education' },
  { id: 'templates', label: 'Templates' },
  { id: 'review', label: 'Build' },
]

const BULLET_OPTIONS = Array.from({ length: 11 }, (_, i) => ({
  value: String(i + 5),
  label: `${i + 5} bullets`,
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
    skills: [],
  }
}

const initialForm = {
  name: '',
  email: '',
  phone: '',
  linkedin: '',
  role: '',
  yearsOfExperience: '',
  companyCount: '2',
  bulletsPerCompany: '8',
  companies: [emptyCompany(), emptyCompany()],
  summaryNotes: '',
  templateId: RESUME_TEMPLATES[0].id,
  education: {
    school: '',
    course: '',
    degree: '',
    startDate: '',
    endDate: '',
  },
}

function syncCompanies(companies, count) {
  const next = companies.slice(0, count)
  while (next.length < count) next.push(emptyCompany())
  return next
}

export default function BuildNewResume() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [apiOk, setApiOk] = useState(null)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [previewBlob, setPreviewBlob] = useState(null)
  const [templateSamples, setTemplateSamples] = useState({})
  const [samplePreview, setSamplePreview] = useState(null)
  const buildingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    checkApiHealth().then((h) => {
      if (!cancelled) setApiOk(h.ok)
    })
    fetchPublicTemplateSamples()
      .then((data) => {
        if (!cancelled) setTemplateSamples(data.samples || {})
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

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

  function updateCompanySkills(index, skills) {
    updateCompany(index, 'skills', skills)
  }

  function updateEducation(e) {
    const { name, value } = e.target
    setForm((f) => ({
      ...f,
      education: { ...f.education, [name]: value },
    }))
    setError('')
  }

  function validateStep(index) {
    if (index === 0) {
      if (!form.name.trim()) return 'Please enter your name.'
      if (!form.email.trim()) return 'Please enter your email.'
      if (!form.phone.trim()) return 'Please enter your phone number.'
      if (!form.role.trim()) return 'Please enter your target role.'
      if (form.yearsOfExperience === '' || Number(form.yearsOfExperience) < 0) {
        return 'Please enter years of experience.'
      }
      if (!form.companyCount) return 'Select how many companies to include.'
    }

    if (index === 1) {
      if (!form.bulletsPerCompany) return 'Select how many bullets per company.'
      const count = Number(form.companyCount) || form.companies.length
      for (let i = 0; i < count; i++) {
        const c = form.companies[i] || {}
        if (!String(c.name || '').trim()) return `Company ${i + 1}: enter the company name.`
        if (!String(c.role || '').trim()) return `Company ${i + 1}: enter the role name.`
        if (!String(c.startDate || '').trim()) return `Company ${i + 1}: enter the start date.`
        if (!String(c.city || '').trim()) return `Company ${i + 1}: enter the city.`
        if (!String(c.state || '').trim()) return `Company ${i + 1}: enter the state.`
      }
    }

    if (index === 3) {
      const edu = form.education
      if (!edu.school.trim()) return 'Enter your university or college name.'
      if (!edu.course.trim()) return 'Enter your course.'
      if (!edu.degree.trim()) return 'Enter your degree.'
      if (!edu.startDate.trim()) return 'Enter education start date.'
    }

    if (index === 4) {
      if (!form.templateId) return 'Please select a resume template.'
    }

    return ''
  }

  /** Steps are free to navigate; required fields are checked only on Build. */
  function goNext() {
    setError('')
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  function goBack() {
    setError('')
    setStep((s) => Math.max(0, s - 1))
  }

  function goToStep(index) {
    setError('')
    setStep(index)
  }

  function buildPayload() {
    const count = Number(form.companyCount) || form.companies.length
    return {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      linkedin: form.linkedin.trim(),
      role: form.role.trim(),
      yearsOfExperience: Number(form.yearsOfExperience) || 0,
      companyCount: count,
      bulletsPerCompany: Number(form.bulletsPerCompany) || 8,
      templateId: form.templateId,
      companies: form.companies.slice(0, count).map((c) => ({
        name: c.name.trim(),
        role: c.role.trim(),
        startDate: c.startDate.trim(),
        endDate: c.endDate.trim(),
        city: c.city.trim(),
        state: c.state.trim(),
        skills: Array.isArray(c.skills) ? c.skills : [],
      })),
      summaryNotes: form.summaryNotes.trim(),
      education: {
        school: form.education.school.trim(),
        course: form.education.course.trim(),
        degree: form.education.degree.trim(),
        startDate: form.education.startDate.trim(),
        endDate: form.education.endDate.trim(),
      },
    }
  }

  async function handleBuild() {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const msg = validateStep(i)
      if (msg) {
        setError(msg)
        setStep(i)
        return
      }
    }

    if (buildingRef.current) return
    buildingRef.current = true
    setBuilding(true)
    setError('')
    setPreviewBlob(null)
    setBuildStep('generating_content')

    try {
      const payload = buildPayload()
      const { jobId, sessionId: sid } = await startBuild(payload)
      setSessionId(sid)

      const result = await waitForBuild(jobId, (status) => {
        setBuildStep(status.step || '')
      })

      const blob = await fetchFileBlob(result.sessionId || sid)
      setPreviewBlob(blob)
      setSessionId(result.sessionId || sid)
      setStep(STEPS.length - 1)
    } catch (err) {
      setError(err.message || 'Failed to build resume')
    } finally {
      setBuilding(false)
      buildingRef.current = false
    }
  }

  const companyCount = Number(form.companyCount) || form.companies.length

  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">02</span>
        <div>
          <h3 className="service-block__title">Professional Resume Builder</h3>
          <p className="service-block__desc">
            No resume yet? Answer a few questions and we&apos;ll generate a polished DOCX for you.
          </p>
        </div>
      </div>

      {apiOk === false && (
        <div className="enhancer-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      <nav className="builder-steps" aria-label="Resume builder steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`builder-steps__item ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}
            onClick={() => goToStep(i)}
          >
            <span className="builder-steps__num">{i + 1}</span>
            <span className="builder-steps__label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="form-card">
        {step === 0 && (
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
              label="Role"
              name="role"
              placeholder="e.g. Software Engineer"
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
              label="Phone number"
              name="phone"
              type="tel"
              placeholder="e.g. 414-555-0123"
              value={form.phone}
              onChange={updateField}
              required
            />
            <FormField
              label="LinkedIn link"
              name="linkedin"
              placeholder="linkedin.com/in/your-profile"
              value={form.linkedin}
              onChange={updateField}
              className="form-field--full"
            />
            <FormField
              label="Years of Experience"
              name="yearsOfExperience"
              type="number"
              min={0}
              max={50}
              placeholder="e.g. 5"
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
          </div>
        )}

        {step === 1 && (
          <div className="builder-experience">
            <div className="form-grid">
              <FormField
                label="Bullets per company (same for all)"
                name="bulletsPerCompany"
                options={BULLET_OPTIONS}
                placeholder="Select 5–15"
                value={form.bulletsPerCompany}
                onChange={updateField}
                required
                className="form-field--full"
              />
            </div>

            {form.companies.slice(0, companyCount).map((company, index) => (
              <div key={index} className="builder-company">
                <h4 className="builder-company__title">Company {index + 1}</h4>
                <div className="form-grid">
                  <FormField
                    label="Company name"
                    placeholder="e.g. Acme Corp"
                    value={company.name}
                    onChange={(e) => updateCompany(index, 'name', e.target.value)}
                    required
                  />
                  <FormField
                    label="Role name"
                    placeholder="e.g. Software Engineer"
                    value={company.role}
                    onChange={(e) => updateCompany(index, 'role', e.target.value)}
                    required
                  />
                  <FormField
                    label="Start date"
                    placeholder="e.g. Jan 2020"
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
                    placeholder="State"
                    value={company.state}
                    onChange={(e) => updateCompany(index, 'state', e.target.value)}
                    required
                  />
                </div>

                <SkillsPicker
                  role={company.role}
                  selected={company.skills || []}
                  onChange={(skills) => updateCompanySkills(index, skills)}
                />
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <FormField
              label="Summary section"
              name="summaryNotes"
              rows={5}
              placeholder="Optional: themes, strengths, or industries to highlight. Leave blank and we will write a strong summary for your role."
              value={form.summaryNotes}
              onChange={updateField}
              className="form-field--full"
            />
          </div>
        )}

        {step === 3 && (
          <div className="form-grid">
            <FormField
              label="University or college name"
              name="school"
              placeholder="e.g. State University"
              value={form.education.school}
              onChange={updateEducation}
              required
              className="form-field--full"
            />
            <FormField
              label="Course"
              name="course"
              placeholder="e.g. Computer Science"
              value={form.education.course}
              onChange={updateEducation}
              required
            />
            <FormField
              label="Degree"
              name="degree"
              placeholder="e.g. Bachelor of Science"
              value={form.education.degree}
              onChange={updateEducation}
              required
            />
            <FormField
              label="Start date"
              name="startDate"
              placeholder="e.g. Aug 2016"
              value={form.education.startDate}
              onChange={updateEducation}
              required
            />
            <FormField
              label="End date"
              name="endDate"
              placeholder="e.g. May 2020"
              value={form.education.endDate}
              onChange={updateEducation}
            />
          </div>
        )}

        {step === 4 && (
          <div className="template-grid">
            {RESUME_TEMPLATES.map((tpl) => {
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
                    <TemplatePreview template={tpl} />
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
        )}

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

        {step === 5 && (
          <div className="builder-review">
            {!previewBlob && !building && (
              <div className="builder-review__summary">
                <p>
                  Ready to build a resume for <strong>{form.name || '—'}</strong> as{' '}
                  <strong>{form.role || '—'}</strong> with {companyCount} compan
                  {companyCount === 1 ? 'y' : 'ies'}, {form.bulletsPerCompany} bullets each, using the{' '}
                  <strong>
                    {RESUME_TEMPLATES.find((t) => t.id === form.templateId)?.name || 'selected'}
                  </strong>{' '}
                  template.
                </p>
              </div>
            )}

            {building && (
              <p className="enhancer-progress">{getBuildStepLabel(buildStep)}</p>
            )}

            {previewBlob && (
              <div className="builder-preview-panel">
                <div className="upload-box">
                  <div className="upload-box__header">
                    <div className="upload-box__label-group">
                      <div>
                        <h4 className="upload-box__label">Your Resume</h4>
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
        )}

        {error && <p className="builder-error" role="alert">{error}</p>}

        <div className="form-cta form-cta--nav">
          {step > 0 && (
            <button type="button" className="btn btn--outline btn--xl" onClick={goBack} disabled={building}>
              Back
            </button>
          )}

          {step < STEPS.length - 1 && (
            <button type="button" className="btn btn--primary btn--xl" onClick={goNext}>
              Next
            </button>
          )}

          {step === STEPS.length - 1 && (
            <>
              <button
                type="button"
                className="btn btn--primary btn--xl"
                onClick={handleBuild}
                disabled={building}
              >
                {building ? (
                  <>
                    <span className="btn-spinner" />
                    {getBuildStepLabel(buildStep)}
                  </>
                ) : (
                  <>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    {previewBlob ? 'Rebuild Resume' : 'Build Resume'}
                  </>
                )}
              </button>

              {previewBlob && sessionId && (
                <a href={getDownloadUrl(sessionId)} className="btn btn--outline btn--xl" download>
                  Download DOCX
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
