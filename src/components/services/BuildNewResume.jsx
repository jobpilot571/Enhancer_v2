import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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

/** Only Basics + Education persist across visits. */
function stickyMemoryFromForm(form) {
  return {
    name: form.name || '',
    email: form.email || '',
    phone: form.phone || '',
    linkedin: form.linkedin || '',
    role: form.role || '',
    yearsOfExperience: form.yearsOfExperience ?? '',
    companyCount: form.companyCount || '1',
    education: {
      school: form.education?.school || '',
      course: form.education?.course || '',
      degree: form.education?.degree || '',
      startDate: form.education?.startDate || '',
      endDate: form.education?.endDate || '',
    },
  }
}

function writeLocalMemory(userId, formData) {
  try {
    localStorage.setItem(
      localMemoryKey(userId),
      JSON.stringify({ formData: stickyMemoryFromForm(formData), updatedAt: new Date().toISOString() }),
    )
  } catch {
    // quota / private mode — ignore
  }
}

function hydrateFormFromMemory(saved) {
  if (!saved || typeof saved !== 'object') return null
  const sticky = stickyMemoryFromForm(saved)
  const count = Math.min(6, Math.max(1, Number(sticky.companyCount) || 1))
  return {
    ...initialForm,
    ...sticky,
    companyCount: String(count),
    companies: syncCompanies([], count),
    education: { ...initialForm.education, ...sticky.education },
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
  { id: 'reference', label: 'Reference' },
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
  uploadedReferences: [],
}

function fillBlank(cur, next) {
  return String(cur || '').trim() ? cur : (next || '')
}

/** Merge material from multiple reference uploads into one AI-ready blob. */
function mergeReferenceMaterials(docs) {
  const list = Array.isArray(docs) ? docs : []
  if (!list.length) return null

  const experienceByCompany = new Map()
  const summaryBullets = []
  const skills = []
  const fileNames = []

  for (const doc of list) {
    const m = doc?.material
    if (!m) continue
    if (doc.fileName) fileNames.push(doc.fileName)
    for (const b of m.summaryBullets || []) {
      const t = String(b || '').trim()
      if (t) summaryBullets.push(t)
    }
    for (const s of m.skills || []) {
      const t = String(s || '').trim()
      if (t) skills.push(t)
    }
    for (const exp of m.experience || []) {
      const key = String(exp.company || '').trim().toLowerCase()
      if (!key) continue
      const existing = experienceByCompany.get(key)
      if (!existing) {
        experienceByCompany.set(key, {
          company: String(exp.company || '').trim(),
          title: String(exp.title || '').trim(),
          bullets: [...(exp.bullets || []).map((b) => String(b || '').trim()).filter(Boolean)],
        })
      } else {
        const seen = new Set(existing.bullets.map((b) => b.toLowerCase()))
        for (const b of exp.bullets || []) {
          const t = String(b || '').trim()
          if (t && !seen.has(t.toLowerCase())) {
            existing.bullets.push(t)
            seen.add(t.toLowerCase())
          }
        }
        if (!existing.title && exp.title) existing.title = String(exp.title).trim()
      }
    }
  }

  return {
    fileName: fileNames.join(' · ') || 'References',
    summaryBullets: [...new Set(summaryBullets)].slice(0, 24),
    experience: [...experienceByCompany.values()].map((e) => ({
      ...e,
      bullets: e.bullets.slice(0, 20),
    })),
    skills: [...new Set(skills)].slice(0, 60),
  }
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
  const [step, setStep] = useState(0)
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
  const [cacheReady, setCacheReady] = useState(false)
  const [cacheNotice, setCacheNotice] = useState('')
  const [uploadAuthPrompt, setUploadAuthPrompt] = useState(false)
  const refInputRef = useRef(null)
  const buildingRef = useRef(false)
  const cacheTimerRef = useRef(null)
  const signedIn = Boolean(getAuthToken() && getStoredUser())

  useEffect(() => {
    let cancelled = false
    const user = getStoredUser()
    const token = getAuthToken()

    async function hydrate() {
      // Instant restore from local cache
      const local = readLocalMemory(user?.id)
      if (local?.formData) {
        const hydrated = hydrateFormFromMemory(local.formData)
        if (hydrated) {
          setForm(hydrated)
          if (local.updatedAt) {
            setCacheNotice(`Restored Basics & Education (saved ${formatMemoryTime(local.updatedAt)}).`)
          }
        }
      }

      // Account cache wins if available
      if (token && user) {
        try {
          const data = await getBuilderMemory()
          if (cancelled) return
          if (data?.formData) {
            const hydrated = hydrateFormFromMemory(data.formData)
            if (hydrated) {
              setForm(hydrated)
              writeLocalMemory(user.id, data.formData)
              if (data.updatedAt) {
                setCacheNotice(`Restored Basics & Education (saved ${formatMemoryTime(data.updatedAt)}).`)
              }
            }
          }
        } catch {
          /* keep local restore */
        }
      }

      if (!cancelled) setCacheReady(true)
    }

    hydrate()

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

  // Auto-cache Basics + Education only (local + backend when signed in)
  useEffect(() => {
    if (!cacheReady || building) return undefined
    const user = getStoredUser()
    const payload = stickyMemoryFromForm(form)

    writeLocalMemory(user?.id, payload)

    if (!getAuthToken() || !user) return undefined

    clearTimeout(cacheTimerRef.current)
    cacheTimerRef.current = setTimeout(() => {
      saveBuilderMemory(payload)
        .then((result) => {
          if (result?.formData) writeLocalMemory(user.id, result.formData)
          setCacheNotice(
            result?.updatedAt
              ? `Auto-saved Basics & Education ${formatMemoryTime(result.updatedAt)}`
              : 'Auto-saved Basics & Education',
          )
        })
        .catch(() => {
          /* quiet — local cache still works */
        })
    }, 1500)

    return () => clearTimeout(cacheTimerRef.current)
  }, [
    form.name,
    form.email,
    form.phone,
    form.linkedin,
    form.role,
    form.yearsOfExperience,
    form.companyCount,
    form.education,
    cacheReady,
    building,
  ])

  function openUploadIfSignedIn(inputRef) {
    if (!signedIn) {
      setUploadAuthPrompt(true)
      setError('')
      return
    }
    setUploadAuthPrompt(false)
    inputRef.current?.click()
  }

  /** Free navigation — required fields checked only on Build. */
  function goToStep(index) {
    setError('')
    setUploadAuthPrompt(false)
    setStep(Math.max(0, Math.min(SECTIONS.length - 1, index)))
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function goNext() {
    goToStep(step + 1)
  }

  function goBack() {
    goToStep(step - 1)
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
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    if (!signedIn) {
      setUploadAuthPrompt(true)
      return
    }

    const existing = Array.isArray(form.uploadedReferences) ? form.uploadedReferences : []
    const remaining = Math.max(0, 10 - existing.length)
    if (remaining <= 0) {
      setError('You can upload up to 10 reference documents. Remove one to add another.')
      return
    }

    const batch = files.slice(0, remaining)
    const skipped = files.length - batch.length
    setRefUploading(true)
    setError('')
    setRefSuggestions(null)

    try {
      let nextDocs = [...existing]
      let lastSuggestions = null

      for (const file of batch) {
        const lower = file.name.toLowerCase()
        if (!lower.endsWith('.docx') && !lower.endsWith('.pdf')) {
          setError(`Skipped ${file.name} — only .docx or .pdf allowed.`)
          continue
        }
        const result = await uploadReferenceDocument(file)
        const suggestions = result.suggestions
        lastSuggestions = suggestions
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: suggestions?.fileName || file.name,
          stats: suggestions?.stats || {},
          uploadedAt: new Date().toISOString(),
          material: suggestions?.referenceMaterial || null,
        }
        nextDocs = [
          ...nextDocs.filter((d) => d.fileName?.toLowerCase() !== entry.fileName.toLowerCase()),
          entry,
        ].slice(0, 10)
      }

      const merged = mergeReferenceMaterials(nextDocs)
      setRefSuggestions(lastSuggestions)
      setForm((f) => {
        const patched = lastSuggestions
          ? applyReferenceSuggestions({ ...f, uploadedReferences: nextDocs }, lastSuggestions)
          : { ...f, uploadedReferences: nextDocs }
        return {
          ...patched,
          uploadedReferences: nextDocs,
          referenceMaterial: merged,
        }
      })

      if (skipped > 0) {
        setError(`Added ${batch.length} file(s). ${skipped} skipped (10-document limit).`)
      }
    } catch (err) {
      setError(err.message || 'Could not read that reference document.')
    } finally {
      setRefUploading(false)
    }
  }

  function clearReference() {
    setRefSuggestions(null)
    setForm((f) => ({ ...f, referenceMaterial: null, uploadedReferences: [] }))
    setError('')
  }

  function removeReferenceDoc(id) {
    setForm((f) => {
      const nextDocs = (f.uploadedReferences || []).filter((d) => d.id !== id)
      if (!nextDocs.length) {
        setRefSuggestions(null)
        return { ...f, uploadedReferences: [], referenceMaterial: null }
      }
      return {
        ...f,
        uploadedReferences: nextDocs,
        referenceMaterial: mergeReferenceMaterials(nextDocs),
      }
    })
  }

  function validateSection(index) {
    // Match SECTIONS order: basics, experience, summary, education, reference, templates, review
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

    if (index === 5) {
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
      uploadedReferences: Array.isArray(form.uploadedReferences) ? form.uploadedReferences : [],
    }
  }

  async function handleBuild() {
    for (let i = 0; i < SECTIONS.length - 1; i++) {
      const msg = validateSection(i)
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
    setStep(SECTIONS.length - 1)

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
      setStep(SECTIONS.length - 1)

      // Keep Basics + Education sticky after a successful build
      const user = getStoredUser()
      const sticky = stickyMemoryFromForm(payload)
      if (getAuthToken() && user) {
        saveBuilderMemory(sticky)
          .then((mem) => {
            writeLocalMemory(user.id, mem.formData || sticky)
            if (mem.updatedAt) {
              setCacheNotice(`Auto-saved Basics & Education ${formatMemoryTime(mem.updatedAt)}`)
            }
          })
          .catch(() => {
            writeLocalMemory(user.id, sticky)
          })
      } else {
        writeLocalMemory(user?.id, sticky)
      }
    } catch (err) {
      setError(err.message || 'Failed to build resume')
    } finally {
      setBuilding(false)
      buildingRef.current = false
    }
  }

  const companyCount = Number(form.companyCount) || form.companies.length
  const isLastStep = step === SECTIONS.length - 1

  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">02</span>
        <div>
          <h3 className="service-block__title">Professional Resume Builder</h3>
          <p className="service-block__desc">
            Enter your details step by step — optionally add reference docs for experience — and we&apos;ll generate a polished DOCX.
          </p>
          {!signedIn && (
            <p className="enhancer-usage-chip">
              <Link to="/login">Sign in</Link> required to build — free plan includes 5 resume builds / month.
              You can fill the form first; Build needs an account.
            </p>
          )}
        </div>
      </div>

      {apiOk === false && (
        <div className="enhancer-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      <nav className="builder-steps" aria-label="Resume builder steps">
        {SECTIONS.map((s, i) => (
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
        <section id="builder-basics" className="builder-section">
          <h4 className="builder-section__title">
            <span className="builder-section__num">1</span>
            Basics
          </h4>

          {cacheNotice && (
            <div className="builder-ref__hint" role="status">
              {cacheNotice}
              {!signedIn ? ' Sign in to sync across devices.' : ''}
            </div>
          )}

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
        )}

        {step === 1 && (
        <section id="builder-experience" className="builder-section">
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
        )}

        {step === 2 && (
        <section id="builder-summary" className="builder-section">
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
        )}

        {step === 3 && (
        <section id="builder-education" className="builder-section">
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
        )}

        {step === 4 && (
        <section id="builder-reference" className="builder-section">
          <h4 className="builder-section__title">
            <span className="builder-section__num">5</span>
            Reference
          </h4>
          <div className="builder-upload">
            <div className="builder-upload__copy">
              <strong>Optional: reference documents</strong>
              <p>
                Upload up to 10 old resumes or notes (DOCX/PDF). We&apos;ll merge real project
                involvement, summary lines, experience bullets, and skills into an ATS-friendly,
                professional resume.
                {!signedIn && (
                  <>
                    {' '}
                    <Link to="/login">Sign in</Link> or <Link to="/signup">sign up</Link> to upload.
                  </>
                )}
              </p>
            </div>
            <input
              ref={refInputRef}
              type="file"
              accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              multiple
              onChange={handleReferenceUpload}
            />
            <button
              type="button"
              className="builder-upload__btn"
              disabled={refUploading || building || (form.uploadedReferences?.length || 0) >= 10}
              onClick={() => openUploadIfSignedIn(refInputRef)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {refUploading
                ? 'Reading document…'
                : (form.uploadedReferences?.length || 0) >= 10
                  ? 'Limit reached (10)'
                  : 'Upload reference'}
            </button>
            {uploadAuthPrompt && !signedIn && (
              <p className="enhancer-usage-chip" role="status">
                Please <Link to="/login">sign in</Link> or <Link to="/signup">sign up</Link> to upload a reference document.
              </p>
            )}

            {(form.uploadedReferences?.length > 0) && (
              <>
                <div className="builder-doc-grid" aria-label="Uploaded reference documents">
                  {form.uploadedReferences.map((doc) => (
                    <div key={doc.id} className="builder-doc-box">
                      <div className="builder-doc-box__top">
                        <span className="builder-doc-box__ext">
                          {(doc.fileName || '').toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}
                        </span>
                        <button
                          type="button"
                          className="builder-doc-box__remove"
                          onClick={() => removeReferenceDoc(doc.id)}
                          aria-label={`Remove ${doc.fileName}`}
                        >
                          ×
                        </button>
                      </div>
                      <div className="builder-doc-box__icon" aria-hidden="true">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <strong className="builder-doc-box__name" title={doc.fileName}>
                        {doc.fileName}
                      </strong>
                      <small className="builder-doc-box__stats">
                        {doc.stats?.companies || 0} cos · {doc.stats?.bullets || 0} bullets
                      </small>
                    </div>
                  ))}
                </div>
                <p className="builder-ref__hint">
                  {form.uploadedReferences.length} of 10 documents
                  {form.referenceMaterial
                    ? ` · merged for summary, experience bullets & skills`
                    : ''}
                </p>
              </>
            )}

            {refSuggestions && (
              <div className="builder-ref__status" role="status">
                Latest file applied: <strong>{refSuggestions.fileName}</strong>
                {' — '}
                {refSuggestions.stats?.companies || 0} companies,{' '}
                {refSuggestions.stats?.bullets || 0} bullets,{' '}
                {refSuggestions.stats?.summaryLines || 0} summary lines.
              </div>
            )}

            {(form.uploadedReferences?.length > 0) && (
              <div className="builder-ref__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={refUploading || building}
                  onClick={clearReference}
                >
                  Clear all references
                </button>
              </div>
            )}
          </div>
        </section>
        )}

        {step === 5 && (
        <section id="builder-templates" className="builder-section">
          <h4 className="builder-section__title">
            <span className="builder-section__num">6</span>
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
        )}

        {step === 6 && (
        <section id="builder-review" className="builder-section">
          <h4 className="builder-section__title">
            <span className="builder-section__num">7</span>
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
        )}

        {error && <p className="builder-error" role="alert">{error}</p>}

        <div className="form-cta form-cta--nav">
          {step > 0 && (
            <button
              type="button"
              className="btn btn--outline btn--xl"
              onClick={goBack}
              disabled={building}
            >
              Back
            </button>
          )}

          {!isLastStep && (
            <button
              type="button"
              className="btn btn--primary btn--xl"
              onClick={goNext}
              disabled={building}
            >
              Next
            </button>
          )}

          {isLastStep && (
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
