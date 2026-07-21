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
} from '../../../api/jdBuilder'
import { fetchPublicTemplateSamples, getSampleFileUrl } from '../../../api/admin'
import {
  JD_STEPS,
  createEmptyProject,
  validateStep,
  toLegacyBuildPayload,
  syncExperiences,
  emptyEducation,
  newId,
} from './jdProjectModel'
import { readJdDraft, writeJdDraft, clearJdDraft } from './jdDraftStorage'
import BasicResumeStep, { normalizeEducationFromExtract } from './steps/BasicResumeStep'
import TargetRoleStep from './steps/TargetRoleStep'
import JobDescriptionStep from './steps/JobDescriptionStep'
import ReferenceDocsStep from './steps/ReferenceDocsStep'
import TemplateStep from './steps/TemplateStep'
import PreviewDownloadStep from './steps/PreviewDownloadStep'

export default function JdBuilderWizard() {
  const user = getStoredUser?.() || null
  const userId = user?.id || null
  const signedIn = Boolean(getAuthToken())

  const [project, setProject] = useState(() => {
    const saved = readJdDraft(userId)
    if (!saved?.project) return createEmptyProject()
    const merged = { ...createEmptyProject(), ...saved.project }
    const count = Number(merged.targetRole?.companyCount) || 3
    merged.targetRole = {
      ...createEmptyProject().targetRole,
      ...merged.targetRole,
      companyCount: String(count),
    }
    merged.experiences = syncExperiences(merged.experiences || [], count)
    // Migrate away from removed "build" step index
    if (Number(merged.currentStep) >= JD_STEPS.length) {
      merged.currentStep = JD_STEPS.findIndex((s) => s.id === 'templates')
    }
    return merged
  })
  const [step, setStep] = useState(() => {
    const saved = readJdDraft(userId)
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
  const [basicUploading, setBasicUploading] = useState(false)
  const [templateSamples, setTemplateSamples] = useState({})
  const [sampleBlobs, setSampleBlobs] = useState({})
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

  const persist = useCallback((nextProject, nextStep = step) => {
    const withStep = { ...nextProject, currentStep: nextStep }
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

  async function handleJdFile(file) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      const text = await file.text()
      updateProject({
        ...projectRef.current,
        targetRole: {
          ...projectRef.current.targetRole,
          jobDescription: text.slice(0, 50000),
          jdFileName: file.name,
        },
      })
      return
    }
    setError('PDF/DOCX JD upload lands in Phase 4. Paste the JD or upload a .txt file for now.')
    updateProject({
      ...projectRef.current,
      targetRole: { ...projectRef.current.targetRole, jdFileName: file.name },
    })
  }

  async function handleStartNewResume() {
    if (buildingRef.current) return
    const ok = window.confirm('Start a new resume? Current draft and preview will be cleared.')
    if (!ok) return
    clearJdDraft(userId)
    setPreviewBlob(null)
    setBuiltRole('')
    setBuildStep('')
    setError('')
    const fresh = createEmptyProject()
    setProject(fresh)
    setStep(0)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  async function handleBuild() {
    if (!signedIn) {
      setError('Please sign in to build a JD-tailored resume. Use Sign in above, then try again.')
      window.scrollTo({ top: 0, behavior: 'auto' })
      return
    }

    const current = projectRef.current
    for (let i = 0; i < JD_STEPS.length; i++) {
      if (['preview', 'references', 'templates'].includes(JD_STEPS[i].id)) continue
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
    setBuildStep('parsing_jd')

    const previewIndex = JD_STEPS.findIndex((s) => s.id === 'preview')
    // Jump to Preview immediately so progress is visible
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
      setProject((prev) => {
        const next = {
          ...prev,
          sessionId: result.sessionId || sid,
          status: 'completed',
          previewReady: true,
          currentStep: previewIndex,
        }
        persist(next, previewIndex)
        return next
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

  return (
    <div className="service-block service-block--jd-wizard">
      <div className="service-block__header">
        <span className="service-block__num">03</span>
        <div>
          <h3 className="service-block__title">JD-Tailored Resume Builder</h3>
          <p className="service-block__desc">
            Guided steps to build a JD-aligned resume from scratch.
          </p>
        </div>
      </div>

      {apiOk === false && (
        <div className="enhancer-notice">
          Backend API is unreachable. Start the server locally or set VITE_API_BASE.
        </div>
      )}

      {!signedIn && (
        <div className="enhancer-notice enhancer-notice--warn">
          Sign in required to build. <Link to="/login">Sign in</Link> or <Link to="/signup">Sign up</Link>, then click Build Resume.
        </div>
      )}

      <nav className="builder-steps" aria-label="JD-tailored resume builder steps">
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

      <div className="form-card form-card--jd-step">
        {stepId === 'basic' && (
          <BasicResumeStep
            project={project}
            onChange={updateProject}
            onUploadBasicResume={handleBasicResumeUpload}
            uploading={basicUploading}
          />
        )}
        {stepId === 'target' && (
          <TargetRoleStep project={project} onChange={updateProject} />
        )}
        {stepId === 'jd' && (
          <JobDescriptionStep
            project={project}
            onChange={updateProject}
            onUploadJdFile={handleJdFile}
          />
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
        {stepId === 'preview' && (
          <PreviewDownloadStep
            previewBlob={previewBlob}
            builtRole={builtRole}
            downloadUrl={project.sessionId ? getDownloadUrl(project.sessionId) : null}
            building={building}
            buildStepLabel={getJdBuildStepLabel(buildStep)}
            onStartNew={handleStartNewResume}
          />
        )}

        {error && <p className="builder-error" role="alert">{error}</p>}

        {(!isTemplates || isPreview) && (
          <div className="form-cta form-cta--nav">
            {!isTemplates && !isPreview && (
              <button type="button" className="btn btn--primary btn--xl" onClick={goNext} disabled={building}>
                Next
              </button>
            )}
            {isPreview && (
              <button
                type="button"
                className="btn btn--outline btn--xl"
                onClick={handleBuild}
                disabled={building}
              >
                {building ? getJdBuildStepLabel(buildStep) : previewBlob ? 'Rebuild Resume' : 'Build Resume'}
              </button>
            )}
          </div>
        )}
      </div>
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
