import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAuthToken, getStoredUser } from '../../../api/auth'
import {
  checkApiHealth,
  startJdBuild,
  waitForJdBuild,
  getJdBuildStepLabel,
  fetchFileBlob,
  getDownloadUrl,
  extractJdBasics,
  saveJdResumeToLibrary,
} from '../../../api/jdBuilder'
import { fetchPublicTemplateSamples, getSampleFileUrl } from '../../../api/admin'
import {
  JD_STEPS,
  createEmptyProject,
  resetProjectKeepingBasics,
  shouldOpenOnBasics,
  validateStep,
  toLegacyBuildPayload,
  emptyEducation,
  emptyExperience,
  computeYearsOfExperience,
  newId,
} from './jdProjectModel'
import { readJdDraft, writeJdDraft, clearJdDraft } from './jdDraftStorage'
import BasicResumeStep, { normalizeEducationFromExtract } from './steps/BasicResumeStep'
import TargetRoleStep from './steps/TargetRoleStep'
import JobDescriptionStep from './steps/JobDescriptionStep'
import ReferenceDocsStep from './steps/ReferenceDocsStep'
import TemplateStep from './steps/TemplateStep'
import PreviewDownloadStep from './steps/PreviewDownloadStep'
import SavedResumesStep from './steps/SavedResumesStep'
import { applyJdChatProjectUpdates } from './jdChatApply'
import { useAssistantWorkspace } from '../../../context/AssistantContext'
import ProLoadingScreen from '../pro/ProLoadingScreen'

const JD_LOAD_STEPS = [
  { key: 'parsing_jd', label: 'Analyzing the job description…' },
  { key: 'researching_companies', label: 'Researching company context…' },
  { key: 'project_memory', label: 'Building project context…' },
  { key: 'generating_content', label: 'Writing tailored resume content…' },
  { key: 'qa_experience', label: 'Checking experience bullets…' },
  { key: 'building_docx', label: 'Building your DOCX…' },
  { key: 'preparing_preview', label: 'Preparing preview…' },
]

const JD_STEP_COPY = {
  basic: {
    title: 'Enter contact & education',
    lede: 'Welcome back to your career toolkit. Upload a resume or type contact details, then continue.',
  },
  jd: {
    title: 'Paste the job description',
    lede: 'The JD drives keywords, bullets, and the match for this tailored resume.',
  },
  target: {
    title: 'Set target role & experience',
    lede: 'Confirm the role, years, and companies you want on this resume.',
  },
  references: {
    title: 'Optional references',
    lede: 'Upload old resumes or notes so we can reuse real project language.',
  },
  templates: {
    title: 'Choose a template',
    lede: 'Pick a layout, then build a JD-aligned DOCX.',
  },
  preview: {
    title: 'Preview and download',
    lede: 'Review the tailored resume beside this report, then download DOCX.',
  },
  saved: {
    title: 'Saved resumes',
    lede: 'Reopen a resume you already built for this account.',
  },
}

function greetingLine(user) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const raw = user?.name?.split(/\s+/)[0] || ''
  const name = !raw || raw === 'Local' ? '' : raw
  return name ? `${part}, ${name}.` : `${part}.`
}

function JdDraftPreview({ project }) {
  const b = project.basicInformation || {}
  const t = project.targetRole || {}
  const jobs = (project.experiences || []).filter((e) => e.companyName || e.jobTitle)
  const edu = (b.education || []).find((e) => e.school || e.degree)
  const hasDraft = Boolean(b.fullName || t.jobTitle || jobs.length || edu)

  return (
    <section className="pro-split__preview" aria-label="Resume preview">
      <div className="pro-preview__toolbar">
        <span className="pro-app__kicker">Resume preview</span>
      </div>
      {hasDraft ? (
        <div className="pro-preview__frame">
          <article className="builder-draft">
            <header className="builder-draft__head">
              <h2>{b.fullName || 'Your name'}</h2>
              {t.jobTitle ? <p className="builder-draft__role">{t.jobTitle}</p> : null}
              <p className="builder-draft__meta">
                {[b.email, b.phone, b.linkedin, [b.city, b.state].filter(Boolean).join(', ')]
                  .filter(Boolean)
                  .join(' · ') || 'Contact details appear here'}
              </p>
            </header>
            {jobs.length > 0 ? (
              <section>
                <h3>Experience</h3>
                {jobs.map((job) => (
                  <div key={job.id || `${job.companyName}-${job.jobTitle}`} className="builder-draft__job">
                    <strong>{job.jobTitle || 'Role'}</strong>
                    <span>{job.companyName}</span>
                  </div>
                ))}
              </section>
            ) : null}
            {edu ? (
              <section>
                <h3>Education</h3>
                <p>
                  <strong>{[edu.degree, edu.major].filter(Boolean).join(' · ') || 'Degree'}</strong>
                  {edu.school ? ` · ${edu.school}` : ''}
                </p>
              </section>
            ) : null}
          </article>
        </div>
      ) : (
        <div className="pro-preview__empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <strong>Your resume will appear here</strong>
          <span>Fill in the form on the left to preview a live outline beside your details.</span>
        </div>
      )}
    </section>
  )
}

export default function JdBuilderWizard() {
  const user = getStoredUser?.() || null
  const userId = user?.id || null
  const signedIn = Boolean(getAuthToken())
  const { setWorkspace, clearWorkspace } = useAssistantWorkspace()

  const [project, setProject] = useState(() => {
    const saved = readJdDraft(userId)
    if (!saved?.project) return createEmptyProject()
    const merged = { ...createEmptyProject(), ...saved.project }
    const filled = (merged.experiences || []).filter((e) => String(e?.companyName || '').trim())
    const count = Math.min(6, Math.max(1, filled.length || 1))
    merged.targetRole = {
      ...createEmptyProject().targetRole,
      ...merged.targetRole,
      companyCount: String(count),
      yearsRequired: merged.targetRole?.yearsRequired ?? '',
    }
    merged.experiences = filled.length
      ? filled.slice(0, 6)
      : [emptyExperience()]
    // Migrate away from removed "build" step index
    if (Number(merged.currentStep) >= JD_STEPS.length) {
      merged.currentStep = JD_STEPS.findIndex((s) => s.id === 'templates')
    }
    // After a finished build, return visitors should land on Basics — not empty Preview
    if (shouldOpenOnBasics(merged)) {
      merged.currentStep = 0
      merged.status = 'draft'
      merged.previewReady = false
      merged.sessionId = null
    }
    return merged
  })
  const [step, setStep] = useState(() => {
    const saved = readJdDraft(userId)
    if (!saved?.project) return 0
    if (shouldOpenOnBasics(saved.project)) return 0
    const s = Number(saved?.project?.currentStep)
    if (!Number.isFinite(s)) return 0
    return Math.min(JD_STEPS.length - 1, Math.max(0, s))
  })
  const [error, setError] = useState('')
  const [apiOk, setApiOk] = useState(null)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState('')
  const [previewBlob, setPreviewBlob] = useState(null)
  const [builtRole, setBuiltRole] = useState('')
  const [lastBuildMeta, setLastBuildMeta] = useState(null)
  const [basicUploading, setBasicUploading] = useState(false)
  const [templateSamples, setTemplateSamples] = useState({})
  const [sampleBlobs, setSampleBlobs] = useState({})
  const [savedRefreshKey, setSavedRefreshKey] = useState(0)
  const buildingRef = useRef(false)
  const saveTimer = useRef(null)
  const projectRef = useRef(project)
  projectRef.current = project

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
              if (!cancelled) setSampleBlobs((prev) => ({ ...prev, [id]: blob }))
            } catch {
              // mockup fallback
            }
          }),
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Rewrite stale post-build drafts so return visits stay on Basics
  useEffect(() => {
    const saved = readJdDraft(userId)
    if (!saved?.project || !shouldOpenOnBasics(saved.project)) return
    writeJdDraft(userId, {
      ...project,
      currentStep: 0,
      status: 'draft',
      previewReady: false,
      sessionId: null,
    })
    // only on mount / user change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const persist = useCallback((nextProject, nextStep = step) => {
    let withStep = { ...nextProject, currentStep: nextStep }
    // Don't leave return visitors stuck on empty Preview after a finished build
    if (shouldOpenOnBasics(withStep) && nextProject.status !== 'generating') {
      withStep = {
        ...withStep,
        currentStep: 0,
        status: 'draft',
        previewReady: false,
        sessionId: null,
      }
    }
    writeJdDraft(userId, withStep)
  }, [userId, step])

  function updateProject(nextOrFn) {
    setProject((prev) => {
      const next = typeof nextOrFn === 'function' ? nextOrFn(prev) : nextOrFn
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => persist(next, step), 400)
      return next
    })
    setError('')
  }

  function goToStep(index) {
    const clamped = Math.min(JD_STEPS.length - 1, Math.max(0, index))
    setStep(clamped)
    setProject((prev) => {
      const next = { ...prev, currentStep: clamped }
      persist(next, clamped)
      return next
    })
    setError('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function goNext() {
    const msg = validateStep(project, step)
    if (msg) {
      setError(msg)
      return
    }
    persist(project, step)
    if (step < JD_STEPS.length - 1) goToStep(step + 1)
  }

  async function handleBasicResumeUpload(file) {
    setBasicUploading(true)
    setError('')
    try {
      const lower = file.name.toLowerCase()
      let partial = {
        basicResumeFileName: file.name,
        basicResumeExtracted: false,
      }

      if (lower.endsWith('.txt') || lower.endsWith('.md')) {
        const text = await file.text()
        const sniffed = sniffContactFromText(text)
        partial = {
          ...partial,
          ...sniffed,
          basicResumeExtracted: Boolean(sniffed.fullName || sniffed.email || sniffed.phone),
        }
      } else if (lower.endsWith('.docx') || lower.endsWith('.pdf')) {
        const result = await extractJdBasics(file)
        if (!result?.ok && !result?.basics) {
          throw new Error(result?.error || 'Could not extract details from that resume.')
        }
        const basics = result?.basics || {}
        const normalizedEdu = normalizeEducationFromExtract(basics.education || [])
        const education = normalizedEdu.length
          ? normalizedEdu.map((e) => ({
              ...emptyEducation(),
              id: newId('edu'),
              degree: e.degree || '',
              major: e.major || '',
              school: e.school || '',
              location: e.location || '',
              graduationYear: e.graduationYear || '',
              gpa: e.gpa || '',
            }))
          : [emptyEducation()]

        partial = {
          ...partial,
          fullName: basics.fullName || '',
          email: basics.email || '',
          phone: basics.phone || '',
          linkedin: basics.linkedin || '',
          city: basics.city || '',
          state: basics.state || '',
          education,
          basicResumeExtracted: Boolean(
            basics.fullName || basics.email || basics.phone || normalizedEdu.length,
          ),
        }

        if (!partial.basicResumeExtracted) {
          setError('Could not find contact details in that file. Please fill them in manually.')
        }
      } else {
        setError('Please upload a .docx, .pdf, or .txt resume.')
      }

      const prev = projectRef.current.basicInformation || {}
      updateProject({
        ...projectRef.current,
        basicInformation: {
          ...prev,
          ...partial,
          // Prefer freshly extracted values; only keep prior typed value if extract left blank
          fullName: partial.fullName || prev.fullName || '',
          email: partial.email || prev.email || '',
          phone: partial.phone || prev.phone || '',
          linkedin: partial.linkedin || prev.linkedin || '',
          city: Object.prototype.hasOwnProperty.call(partial, 'city')
            ? (partial.city || '')
            : (prev.city || ''),
          state: Object.prototype.hasOwnProperty.call(partial, 'state')
            ? (partial.state || '')
            : (prev.state || ''),
          education: Array.isArray(partial.education) ? partial.education : (prev.education || [emptyEducation()]),
        },
      })
    } catch (err) {
      setError(err.message || 'Could not read that file.')
      updateProject({
        ...projectRef.current,
        basicInformation: {
          ...projectRef.current.basicInformation,
          basicResumeFileName: file.name,
          basicResumeExtracted: false,
        },
      })
    } finally {
      setBasicUploading(false)
    }
  }

  async function handleStartNewResume() {
    if (buildingRef.current) return
    const ok = window.confirm('Start a new resume? Current draft and preview will be cleared.')
    if (!ok) return
    clearJdDraft(userId)
    setPreviewBlob(null)
    setBuiltRole('')
    setLastBuildMeta(null)
    setBuildStep('')
    setError('')
    const fresh = createEmptyProject()
    setProject(fresh)
    setStep(0)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  async function handleDownloadAndSave() {
    if (!signedIn) {
      throw new Error('Please sign in to download and save resumes.')
    }
    const current = projectRef.current
    const blob = previewBlob
    if (!blob) throw new Error('No resume ready to download.')

    const role = builtRole || lastBuildMeta?.role || current.targetRole?.jobTitle || 'Resume'
    const years = lastBuildMeta?.yearsOfExperience
      ?? computeYearsOfExperience(current.experiences || [])
    const yearsRequired = lastBuildMeta?.yearsRequired ?? current.targetRole?.yearsRequired
    const jdText = lastBuildMeta?.jdText || current.targetRole?.jobDescription || ''
    const templateId = lastBuildMeta?.templateId || current.selectedTemplateId || ''
    const fileName = `${String(role).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'resume'}-jd-tailored.docx`

    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 2000)

    await saveJdResumeToLibrary({
      blob,
      role,
      yearsOfExperience: years || null,
      yearsRequired: yearsRequired || null,
      jdText,
      templateId,
      fileName,
    })
    setSavedRefreshKey((n) => n + 1)
    const savedIdx = JD_STEPS.findIndex((s) => s.id === 'saved')
    if (savedIdx >= 0) goToStep(savedIdx)
  }

  async function handleBuild() {
    if (!signedIn) {
      setError('Please sign in to build a JD-tailored resume. Use Sign in above, then try again.')
      window.scrollTo({ top: 0, behavior: 'auto' })
      return
    }

    const current = projectRef.current
    for (let i = 0; i < JD_STEPS.length; i++) {
      if (['preview', 'saved', 'references', 'templates'].includes(JD_STEPS[i].id)) continue
      const msg = validateStep(current, i)
      if (msg) {
        setError(msg)
        goToStep(i)
        return
      }
    }
    if (!current.selectedTemplateId) {
      setError('Please select a resume template.')
      return
    }

    if (buildingRef.current) return
    buildingRef.current = true
    setBuilding(true)
    setError('')
    setPreviewBlob(null)
    setBuiltRole('')
    setBuildStep('preparing_preview')

    const previewIndex = JD_STEPS.findIndex((s) => s.id === 'preview')
    // Jump to Preview immediately so the preparing state is visible
    setStep(previewIndex)
    setProject((prev) => {
      const next = { ...prev, status: 'generating', currentStep: previewIndex }
      persist(next, previewIndex)
      return next
    })
    window.scrollTo({ top: 0, behavior: 'auto' })

    try {
      const payload = toLegacyBuildPayload(current)
      console.log('[jd-builder] starting build', {
        templateId: payload.templateId,
        role: payload.role,
        companies: payload.companyCount,
      })
      const { jobId, sessionId: sid } = await startJdBuild(payload, current.sessionId || null)
      setProject((prev) => {
        const next = { ...prev, sessionId: sid, status: 'generating' }
        persist(next, previewIndex)
        return next
      })

      const result = await waitForJdBuild(jobId, (status) => {
        setBuildStep(status.step || '')
      })

      const blob = await fetchFileBlob(result.sessionId || sid)
      setPreviewBlob(blob)
      setBuiltRole(result.roleTitle || payload.role)
      setLastBuildMeta({
        role: result.roleTitle || payload.role || '',
        jdText: current.targetRole?.jobDescription || '',
        yearsOfExperience: computeYearsOfExperience(current.experiences || []),
        yearsRequired: current.targetRole?.yearsRequired || null,
        templateId: current.selectedTemplateId || '',
      })
      // Keep Basics only — clear JD, Target, References, Templates for the next build.
      // Stay on Preview in this session so they can download; draft is saved on Basics
      // so a later return visit does not open an empty Preview.
      setProject((prev) => {
        const cleared = resetProjectKeepingBasics(prev)
        persist(cleared, 0)
        return {
          ...cleared,
          currentStep: previewIndex,
          sessionId: result.sessionId || sid,
          previewReady: true,
          status: 'completed',
        }
      })
      setStep(previewIndex)
    } catch (err) {
      console.error('[jd-builder] build failed', err)
      const message = err.code === 'AUTH_REQUIRED'
        ? 'Please sign in to build a JD-tailored resume.'
        : (err.message || 'Failed to build resume')
      setError(message)
      setProject((prev) => ({ ...prev, status: 'failed' }))
      // Stay on preview so the error is visible next to the empty preview
    } finally {
      setBuilding(false)
      buildingRef.current = false
    }
  }

  const stepId = JD_STEPS[step]?.id
  const isTemplates = stepId === 'templates'
  const isPreview = stepId === 'preview'

  useEffect(() => {
    setWorkspace({
      service: 'jd',
      sessionId: project.sessionId || null,
      hasPreview: Boolean(previewBlob),
      label: 'JD-Tailored Resume Builder',
      meta: { stepId, project },
    })
    return () => clearWorkspace()
  }, [project, previewBlob, stepId, setWorkspace, clearWorkspace])

  useEffect(() => {
    function onProjectUpdate(e) {
      const detail = e.detail || {}
      if (detail.projectUpdates) {
        updateProject((prev) => applyJdChatProjectUpdates(prev, detail.projectUpdates))
      }
      if (detail.navigateToStep) {
        const idx = JD_STEPS.findIndex((s) => s.id === detail.navigateToStep)
        if (idx >= 0) goToStep(idx)
      }
    }
    async function onPreviewUpdated(e) {
      const detail = e.detail || {}
      const sid = detail.sessionId || projectRef.current.sessionId
      if (!sid || detail.service !== 'jd') return
      try {
        const blob = await fetchFileBlob(sid)
        setPreviewBlob(blob)
        if (detail.roleTitle) setBuiltRole(detail.roleTitle)
        const previewIdx = JD_STEPS.findIndex((s) => s.id === 'preview')
        if (previewIdx >= 0) goToStep(previewIdx)
      } catch { /* ignore */ }
    }
    window.addEventListener('jobpilot:assistant-project-update', onProjectUpdate)
    window.addEventListener('jobpilot:assistant-preview-updated', onPreviewUpdated)
    return () => {
      window.removeEventListener('jobpilot:assistant-project-update', onProjectUpdate)
      window.removeEventListener('jobpilot:assistant-preview-updated', onPreviewUpdated)
    }
  }, [])

  const stepCopy = JD_STEP_COPY[stepId] || JD_STEP_COPY.basic

  return (
    <div className="service-block service-block--jd-wizard pro-app pro-app--split">
      <header className="pro-app__bar">
        <div className="pro-app__identity">
          <Link to="/#services" className="pro-app__back" aria-label="Back to Services">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <span className="pro-app__kicker">JD-Tailored Resume</span>
            <h3 className="pro-app__title">{stepCopy.title}</h3>
          </div>
        </div>
        <div className="pro-app__actions">
          <p className="pro-app__usage">
            {signedIn ? (
              `${user?.planLabel || 'Member'} · JD-Tailored`
            ) : (
              <>
                <Link to="/login">Sign in</Link> required to build
              </>
            )}
          </p>
          {isTemplates ? (
            <button
              type="button"
              className="btn btn--primary enhancer-topbar__cta"
              onClick={handleBuild}
              disabled={building || !signedIn}
            >
              {building ? getJdBuildStepLabel(buildStep) : 'Build Resume'}
            </button>
          ) : isPreview ? (
            <button
              type="button"
              className="btn btn--primary enhancer-topbar__cta"
              onClick={handleBuild}
              disabled={building || !signedIn}
            >
              {building ? getJdBuildStepLabel(buildStep) : previewBlob ? 'Rebuild Resume' : 'Build Resume'}
            </button>
          ) : stepId !== 'saved' ? (
            <button
              type="button"
              className="btn btn--primary enhancer-topbar__cta"
              onClick={goNext}
              disabled={building}
            >
              Continue
            </button>
          ) : null}
        </div>
      </header>

      {building && (
        <ProLoadingScreen
          title="Please wait…"
          subtitle="We’re writing a resume that matches this job description."
          steps={JD_LOAD_STEPS}
          currentStep={buildStep}
        />
      )}

      {apiOk === false && (
        <div className="pro-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      <nav className="builder-steps builder-steps--pro" aria-label="JD-tailored resume builder steps">
        {JD_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`builder-steps__item ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}
            onClick={() => goToStep(i)}
          >
            <span className="builder-steps__num">{i + 1}</span>
            <span className="builder-steps__label">{s.short || s.label}</span>
          </button>
        ))}
      </nav>

      {isPreview ? (
      <div className="form-card form-card--jd-step form-card--pro-split">
        <PreviewDownloadStep
          previewBlob={previewBlob}
          builtRole={builtRole}
          downloadUrl={project.sessionId ? getDownloadUrl(project.sessionId) : null}
          building={building}
          buildStepLabel={getJdBuildStepLabel(buildStep)}
          onStartNew={handleStartNewResume}
          onDownloadAndSave={handleDownloadAndSave}
          onRebuild={handleBuild}
          onOpenSaved={() => goToStep(JD_STEPS.findIndex((s) => s.id === 'saved'))}
        />
        {error && <p className="builder-error" role="alert">{error}</p>}
      </div>
      ) : (
      <div className="pro-split">
        <aside className="pro-split__report pro-split__report--setup pro-setup">
          <h2 className="pro-setup__hello">{greetingLine(user)}</h2>
          <p className="pro-setup__lede">{stepCopy.lede}</p>
          <div className="builder-pro-card">
            {stepId === 'basic' && (
              <BasicResumeStep
                project={project}
                onChange={updateProject}
                onUploadBasicResume={handleBasicResumeUpload}
                uploading={basicUploading}
              />
            )}
            {stepId === 'jd' && (
              <JobDescriptionStep
                project={project}
                onChange={updateProject}
              />
            )}
            {stepId === 'target' && (
              <TargetRoleStep project={project} onChange={updateProject} />
            )}
            {stepId === 'references' && (
              <ReferenceDocsStep project={project} onChange={updateProject} />
            )}
            {stepId === 'templates' && (
              <TemplateStep
                project={project}
                onChange={updateProject}
                templateSamples={templateSamples}
                sampleBlobs={sampleBlobs}
                getSampleFileUrl={getSampleFileUrl}
                onBuild={handleBuild}
                building={building}
                buildStepLabel={getJdBuildStepLabel(buildStep)}
                signedIn={signedIn}
              />
            )}
            {stepId === 'saved' && (
              <SavedResumesStep refreshKey={savedRefreshKey} />
            )}
          </div>
          {error && <p className="builder-error" role="alert">{error}</p>}
          {!isTemplates && stepId !== 'saved' && (
            <div className="form-cta form-cta--nav">
              <button type="button" className="btn btn--primary btn--xl" onClick={goNext} disabled={building}>
                Continue
              </button>
            </div>
          )}
        </aside>
        <JdDraftPreview project={project} />
      </div>
      )}
    </div>
  )
}

function sniffContactFromText(text) {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/)
  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const fullName = lines[0] && lines[0].length < 60 && !emailMatch?.[0]?.includes(lines[0]) ? lines[0] : ''
  return {
    fullName: fullName || '',
    email: emailMatch?.[0] || '',
    phone: phoneMatch?.[0] || '',
    linkedin: linkedinMatch?.[0] || '',
  }
}
