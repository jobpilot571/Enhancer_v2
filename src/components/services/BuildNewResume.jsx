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
  uploadReferenceDocument,
  getBuilderMemory,
  saveBuilderMemory,
  clearBuilderMemory,
} from '../../api/builder'
import { getAuthToken, getStoredUser } from '../../api/auth'
import { fetchPublicTemplateSamples, getSampleFileUrl } from '../../api/admin'

const LOCAL_MEMORY_KEY = 'jobpilot_builder_memory'

function localMemoryKey(userId) {
  return userId ? `${LOCAL_MEMORY_KEY}:${userId}` : LOCAL_MEMORY_KEY
}

function readLocalMemory(userId) {
  try {
    const raw = localStorage.getItem(localMemoryKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.formData) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocalMemory(userId, formData) {
  try {
    localStorage.setItem(
      localMemoryKey(userId),
      JSON.stringify({ formData, updatedAt: new Date().toISOString() }),
    )
  } catch {
    // quota / private mode — ignore
  }
}

function removeLocalMemory(userId) {
  try {
    localStorage.removeItem(localMemoryKey(userId))
  } catch {
    /* ignore */
  }
}

function hydrateFormFromMemory(saved) {
  if (!saved || typeof saved !== 'object') return null
  const count = Math.min(6, Math.max(1, Number(saved.companyCount) || (saved.companies || []).length || 1))
  return {
    ...initialForm,
    ...saved,
    companyCount: String(count),
    companies: syncCompanies(
      Array.isArray(saved.companies) ? saved.companies.map((c) => ({ ...emptyCompany(), ...c })) : [],
      count,
    ),
    education: { ...initialForm.education, ...(saved.education || {}) },
    referenceMaterial: saved.referenceMaterial || null,
  }
}

function formatMemoryTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const SECTIONS = [
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
  referenceMaterial: null,
}

function fillBlank(cur, next) {
  return String(cur || '').trim() ? cur : (next || '')
}

/** Merge extracted reference suggestions into the builder form. */
function applyReferenceSuggestions(form, suggestions, { overwriteCompanies = true } = {}) {
  const patch = suggestions?.formPatch || {}
  const companyCount = Math.min(
    6,
    Math.max(
      1,
      Number(patch.companyCount)
        || (patch.companies || []).length
        || Number(form.companyCount)
        || 1,
    ),
  )

  let companies = syncCompanies(form.companies || [], companyCount)
  if (patch.companies?.length && overwriteCompanies) {
    companies = syncCompanies(
      patch.companies.map((incoming, i) => {
        const existing = form.companies[i] || emptyCompany()
        return {
          name: fillBlank(existing.name, incoming.name),
          role: fillBlank(existing.role, incoming.role),
          startDate: fillBlank(existing.startDate, incoming.startDate),
          endDate: fillBlank(existing.endDate, incoming.endDate),
          city: fillBlank(existing.city, incoming.city),
          state: fillBlank(existing.state, incoming.state),
          skills: (existing.skills?.length ? existing.skills : (incoming.skills || [])),
        }
      }),
      companyCount,
    )
  }

  const edu = form.education || {}
  const pedu = patch.education || {}
  const incomingNotes = String(patch.summaryNotes || '').trim()
  const existingNotes = String(form.summaryNotes || '').trim()

  return {
    ...form,
    name: fillBlank(form.name, patch.name),
    email: fillBlank(form.email, patch.email),
    phone: fillBlank(form.phone, patch.phone),
    linkedin: fillBlank(form.linkedin, patch.linkedin),
    role: fillBlank(form.role, patch.role),
    yearsOfExperience: fillBlank(form.yearsOfExperience, patch.yearsOfExperience),
    companyCount: String(companyCount),
    companies,
    summaryNotes: !incomingNotes
      ? form.summaryNotes
      : (!existingNotes ? incomingNotes : `${existingNotes}\n\n${incomingNotes}`),
    education: {
      school: fillBlank(edu.school, pedu.school),
      course: fillBlank(edu.course, pedu.course),
      degree: fillBlank(edu.degree, pedu.degree),
      startDate: fillBlank(edu.startDate, pedu.startDate),
      endDate: fillBlank(edu.endDate, pedu.endDate),
    },
    referenceMaterial: suggestions.referenceMaterial || form.referenceMaterial || null,
  }
}

function syncCompanies(companies, count) {
  const next = companies.slice(0, count)
  while (next.length < count) next.push(emptyCompany())
  return next
}

export default function BuildNewResume() {
  const [activeSection, setActiveSection] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [apiOk, setApiOk] = useState(null)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [previewBlob, setPreviewBlob] = useState(null)
  const [templateSamples, setTemplateSamples] = useState({})
  const [sampleBlobs, setSampleBlobs] = useState({})
  const [samplePreview, setSamplePreview] = useState(null)
  const [refUploading, setRefUploading] = useState(false)
  const [refSuggestions, setRefSuggestions] = useState(null)
  const [memoryInfo, setMemoryInfo] = useState({ hasMemory: false, updatedAt: null })
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryNotice, setMemoryNotice] = useState('')
  const refInputRef = useRef(null)
  const buildingRef = useRef(false)
  const scrollingRef = useRef(false)
  const sectionRefs = useRef({})
  const signedIn = Boolean(getAuthToken() && getStoredUser())

  useEffect(() => {
    let cancelled = false
    const user = getStoredUser()
    const token = getAuthToken()

    // Instant restore from local backup
    const local = readLocalMemory(user?.id)
    if (local?.formData) {
      const hydrated = hydrateFormFromMemory(local.formData)
      if (hydrated) {
        setForm(hydrated)
        setRefSuggestions(hydrated.referenceMaterial
          ? {
            fileName: hydrated.referenceMaterial.fileName || 'Saved reference',
            stats: {
              companies: hydrated.referenceMaterial.experience?.length || 0,
              bullets: (hydrated.referenceMaterial.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0),
              summaryLines: hydrated.referenceMaterial.summaryBullets?.length || 0,
            },
          }
          : null)
        setMemoryInfo({ hasMemory: true, updatedAt: local.updatedAt || null })
        setMemoryNotice('Restored your saved details from this device.')
      }
    }

    // Account memory wins if available
    if (token && user) {
      getBuilderMemory()
        .then((data) => {
          if (cancelled || !data?.formData) {
            if (!cancelled && data) {
              setMemoryInfo({ hasMemory: Boolean(data.hasMemory), updatedAt: data.updatedAt })
            }
            return
          }
          const hydrated = hydrateFormFromMemory(data.formData)
          if (!hydrated) return
          setForm(hydrated)
          writeLocalMemory(user.id, data.formData)
          setMemoryInfo({ hasMemory: true, updatedAt: data.updatedAt })
          setRefSuggestions(hydrated.referenceMaterial
            ? {
              fileName: hydrated.referenceMaterial.fileName || 'Saved reference',
              stats: {
                companies: hydrated.referenceMaterial.experience?.length || 0,
                bullets: (hydrated.referenceMaterial.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0),
                summaryLines: hydrated.referenceMaterial.summaryBullets?.length || 0,
              },
            }
            : null)
          setMemoryNotice('Loaded your saved memory from your account.')
        })
        .catch(() => {
          /* keep local restore */
        })
    }

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
              // keep CSS mockup fallback
            }
          }),
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Highlight nav item based on which section is in view
  useEffect(() => {
    const observers = []
    SECTIONS.forEach((section, index) => {
      const el = sectionRefs.current[section.id]
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (scrollingRef.current) return
          if (entry.isIntersecting) setActiveSection(index)
        },
        { rootMargin: '-20% 0px -55% 0px', threshold: 0.1 },
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach((o) => o.disconnect())
  }, [])

  function scrollToSection(index) {
    const id = SECTIONS[index]?.id
    const el = sectionRefs.current[id]
    if (!el) return
    scrollingRef.current = true
    setActiveSection(index)
    setError('')
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      scrollingRef.current = false
    }, 600)
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

  async function handleReferenceUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.docx') && !lower.endsWith('.pdf')) {
      setError('Reference document must be a .docx or .pdf file.')
      return
    }

    setRefUploading(true)
    setError('')
    try {
      const result = await uploadReferenceDocument(file)
      setRefSuggestions(result.suggestions)
      setForm((f) => applyReferenceSuggestions(f, result.suggestions))
    } catch (err) {
      setError(err.message || 'Could not read that reference document.')
    } finally {
      setRefUploading(false)
    }
  }

  function clearReference() {
    setRefSuggestions(null)
    setForm((f) => ({ ...f, referenceMaterial: null }))
    setError('')
  }

  async function handleSaveMemory() {
    const user = getStoredUser()
    if (!getAuthToken() || !user) {
      setError('Sign in to save your details for next time.')
      return
    }
    setMemoryBusy(true)
    setError('')
    setMemoryNotice('')
    try {
      const payload = buildPayload()
      const result = await saveBuilderMemory(payload)
      writeLocalMemory(user.id, result.formData || payload)
      setMemoryInfo({ hasMemory: true, updatedAt: result.updatedAt || new Date().toISOString() })
      setMemoryNotice('Saved. Next visit, these details will load automatically.')
    } catch (err) {
      setError(err.message || 'Could not save memory.')
    } finally {
      setMemoryBusy(false)
    }
  }

  async function handleLoadMemory() {
    const user = getStoredUser()
    setMemoryBusy(true)
    setError('')
    setMemoryNotice('')
    try {
      let formData = null
      let updatedAt = null
      if (getAuthToken() && user) {
        const data = await getBuilderMemory()
        formData = data.formData
        updatedAt = data.updatedAt
      }
      if (!formData) {
        const local = readLocalMemory(user?.id)
        formData = local?.formData || null
        updatedAt = local?.updatedAt || null
      }
      if (!formData) {
        setError('No saved memory yet. Fill the form and click Save my details.')
        return
      }
      const hydrated = hydrateFormFromMemory(formData)
      setForm(hydrated)
      setMemoryInfo({ hasMemory: true, updatedAt })
      setMemoryNotice('Loaded your saved details.')
    } catch (err) {
      setError(err.message || 'Could not load saved memory.')
    } finally {
      setMemoryBusy(false)
    }
  }

  async function handleClearMemory() {
    const user = getStoredUser()
    setMemoryBusy(true)
    setError('')
    setMemoryNotice('')
    try {
      if (getAuthToken() && user) {
        await clearBuilderMemory()
      }
      removeLocalMemory(user?.id)
      setMemoryInfo({ hasMemory: false, updatedAt: null })
      setMemoryNotice('Saved memory cleared.')
    } catch (err) {
      setError(err.message || 'Could not clear saved memory.')
    } finally {
      setMemoryBusy(false)
    }
  }

  function validateSection(index) {
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
      referenceMaterial: form.referenceMaterial || null,
    }
  }

  async function handleBuild() {
    for (let i = 0; i < SECTIONS.length - 1; i++) {
      const msg = validateSection(i)
      if (msg) {
        setError(msg)
        scrollToSection(i)
        return
      }
    }

    if (buildingRef.current) return
    buildingRef.current = true
    setBuilding(true)
    setError('')
    setPreviewBlob(null)
    setBuildStep('generating_content')
    scrollToSection(SECTIONS.length - 1)

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
      scrollToSection(SECTIONS.length - 1)

      // Quietly keep account memory fresh after a successful build
      const user = getStoredUser()
      if (getAuthToken() && user) {
        saveBuilderMemory(payload)
          .then((mem) => {
            writeLocalMemory(user.id, mem.formData || payload)
            setMemoryInfo({ hasMemory: true, updatedAt: mem.updatedAt || new Date().toISOString() })
          })
          .catch(() => {
            writeLocalMemory(user.id, payload)
          })
      } else {
        writeLocalMemory(user?.id, payload)
      }
    } catch (err) {
      setError(err.message || 'Failed to build resume')
    } finally {
      setBuilding(false)
      buildingRef.current = false
    }
  }

  const companyCount = Number(form.companyCount) || form.companies.length

  function setSectionRef(id) {
    return (el) => {
      if (el) sectionRefs.current[id] = el
    }
  }

  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">02</span>
        <div>
          <h3 className="service-block__title">Professional Resume Builder</h3>
          <p className="service-block__desc">
            Answer a few questions — or upload a reference document — and we&apos;ll generate a polished DOCX for you.
          </p>
        </div>
      </div>

      {apiOk === false && (
        <div className="enhancer-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      <nav className="builder-steps builder-steps--sticky" aria-label="Resume builder sections">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`builder-steps__item ${i === activeSection ? 'is-active' : ''} ${i < activeSection ? 'is-done' : ''}`}
            onClick={() => scrollToSection(i)}
          >
            <span className="builder-steps__num">{i + 1}</span>
            <span className="builder-steps__label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="form-card form-card--single">
        <section
          id="builder-basics"
          ref={setSectionRef('basics')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">1</span>
            Basics
          </h4>

          <div className="builder-ref builder-ref--memory">
            <div className="builder-ref__copy">
              <strong>Saved memory</strong>
              <p>
                Save your basics, experience, education, and summary once — we&apos;ll restore them
                next time so you don&apos;t retype everything.
                {!signedIn ? ' Sign in to keep this on your account across devices.' : ''}
              </p>
            </div>
            <div className="builder-ref__actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={memoryBusy || building}
                onClick={handleSaveMemory}
              >
                {memoryBusy ? 'Saving…' : 'Save my details'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={memoryBusy || building}
                onClick={handleLoadMemory}
              >
                Load saved
              </button>
              {memoryInfo.hasMemory && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={memoryBusy || building}
                  onClick={handleClearMemory}
                >
                  Clear memory
                </button>
              )}
            </div>
            {(memoryNotice || memoryInfo.updatedAt) && (
              <div className="builder-ref__status" role="status">
                {memoryNotice || 'Saved memory ready.'}
                {memoryInfo.updatedAt
                  ? ` Last saved ${formatMemoryTime(memoryInfo.updatedAt)}.`
                  : ''}
              </div>
            )}
          </div>

          <div className="builder-ref">
            <div className="builder-ref__copy">
              <strong>Optional: reference document</strong>
              <p>
                Upload an old resume or notes (DOCX/PDF). We&apos;ll pull companies, summary lines,
                and bullets so the generated resume can reuse your real achievements.
              </p>
            </div>
            <input
              ref={refInputRef}
              type="file"
              accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              onChange={handleReferenceUpload}
            />
            <div className="builder-ref__actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={refUploading || building}
                onClick={() => refInputRef.current?.click()}
              >
                {refUploading ? 'Reading document…' : (refSuggestions ? 'Replace document' : 'Upload reference')}
              </button>
              {(refSuggestions || form.referenceMaterial) && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={refUploading || building}
                  onClick={clearReference}
                >
                  Clear
                </button>
              )}
            </div>
            {refSuggestions && (
              <div className="builder-ref__status" role="status">
                Applied from <strong>{refSuggestions.fileName}</strong>
                {' — '}
                {refSuggestions.stats?.companies || 0} companies,{' '}
                {refSuggestions.stats?.bullets || 0} bullets,{' '}
                {refSuggestions.stats?.summaryLines || 0} summary lines.
                Review Experience and Summary next, then Build.
              </div>
            )}
          </div>

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
        </section>

        <section
          id="builder-experience"
          ref={setSectionRef('experience')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">2</span>
            Experience
          </h4>
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
        </section>

        <section
          id="builder-summary"
          ref={setSectionRef('summary')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">3</span>
            Summary
          </h4>
          <div className="form-grid">
            <FormField
              label="Summary section"
              name="summaryNotes"
              rows={5}
              placeholder={
                form.referenceMaterial
                  ? 'Filled from your reference document — edit freely. These lines guide the summary bullets we generate.'
                  : 'Optional: themes, strengths, or industries to highlight. Leave blank and we will write a strong summary for your role.'
              }
              value={form.summaryNotes}
              onChange={updateField}
              className="form-field--full"
            />
            {form.referenceMaterial?.experience?.length > 0 && (
              <p className="builder-ref__hint form-field--full">
                Reference bullets for{' '}
                {form.referenceMaterial.experience.filter((e) => e.bullets?.length).length}{' '}
                job(s) will be woven into Experience when you Build.
              </p>
            )}
          </div>
        </section>

        <section
          id="builder-education"
          ref={setSectionRef('education')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">4</span>
            Education
          </h4>
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
        </section>

        <section
          id="builder-templates"
          ref={setSectionRef('templates')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">5</span>
            Templates
          </h4>
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
        </section>

        <section
          id="builder-review"
          ref={setSectionRef('review')}
          className="builder-section"
        >
          <h4 className="builder-section__title">
            <span className="builder-section__num">6</span>
            Build
          </h4>
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
        </div>
      </div>

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
    </div>
  )
}
