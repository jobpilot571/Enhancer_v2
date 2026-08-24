import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const DEMO_STEPS = [
  { ms: 500, target: 'preview', tip: '', active: null },
  { ms: 1600, target: 'resume', tip: 'Upload a resume', active: 'resume' },
  { ms: 900, target: 'resume', tip: 'Upload a resume', active: 'resume', click: true },
  { ms: 1600, target: 'jd', tip: 'Upload a JD', active: 'jd' },
  { ms: 900, target: 'jd', tip: 'Upload a JD', active: 'jd', click: true },
  { ms: 1300, target: 'enhance', tip: 'Enhance resume', active: 'enhance' },
  { ms: 850, target: 'enhance', tip: 'Enhance resume', active: 'enhance', click: true },
  { ms: 1700, target: 'summary', tip: 'Rewriting weak bullets', active: 'preview', point: true },
  { ms: 1600, target: 'skills', tip: 'Adding JD-matched proof', active: 'preview', point: true },
  { ms: 2200, target: 'job', tip: 'Resume matched to the JD', active: 'preview', point: true },
]

function useHeroDemo() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setPhase(DEMO_STEPS.length - 1)
      return undefined
    }
    let idx = 0
    let timer
    const tick = () => {
      timer = window.setTimeout(() => {
        idx = (idx + 1) % DEMO_STEPS.length
        setPhase(idx)
        tick()
      }, DEMO_STEPS[idx].ms)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [])

  return phase
}

function HeroResume({ enhanced, summaryRef, skillsRef, jobRef }) {
  return (
    <article className={`hero-demo__page ${enhanced ? 'is-enhanced' : ''}`}>
      <header>
        <h4>Alex Rivera</h4>
        <p className="hero-demo__role">
          {enhanced ? 'DevOps Engineer | Kubernetes | CI/CD Automation' : 'DevOps Engineer'}
        </p>
        <p className="hero-demo__meta">Austin, TX · alex.rivera@email.com · linkedin.com/in/alexrivera</p>
      </header>

      <h5 ref={summaryRef}>Professional Summary</h5>
      <ul>
        {enhanced ? (
          <>
            <li>
              <span className="hero-hl hero-hl--rewrite">
                DevOps Engineer with 5+ years owning AWS platforms, Terraform IaC, and Kubernetes delivery.
              </span>
            </li>
            <li>
              <span className="hero-hl hero-hl--rewrite">
                Built Jenkins and GitHub Actions pipelines that raised successful releases to 99.9%.
              </span>
            </li>
            <li>
              <span className="hero-add">+ Added</span>
              <span className="hero-hl hero-hl--add">
                Partnered with developers to automate Kubernetes rollouts and cut release time 40%.
              </span>
            </li>
          </>
        ) : (
          <>
            <li>DevOps engineer with experience supporting cloud infrastructure and application deployments.</li>
            <li>Responsible for CI/CD pipelines, Docker containers, and helping the development team.</li>
            <li>Worked on AWS services and Linux servers for production environments.</li>
          </>
        )}
      </ul>

      <h5 ref={skillsRef}>Technical Skills</h5>
      <p className="hero-demo__skills">
        {enhanced ? (
          <>
            AWS · Docker · Jenkins · Linux · Python ·{' '}
            <span className="hero-hl hero-hl--add">Kubernetes</span> ·{' '}
            <span className="hero-hl hero-hl--add">Terraform</span>
          </>
        ) : (
          'AWS · Docker · Jenkins · Linux · Python'
        )}
      </p>

      <h5 ref={jobRef}>Experience</h5>
      <p className="hero-demo__job">
        <strong>CloudForge</strong> — DevOps Engineer · 2021–Present
      </p>
      <ul>
        {enhanced ? (
          <>
            <li>
              <span className="hero-hl hero-hl--rewrite">
                Designed AWS networking and IAM for EKS, EC2, and S3 serving 50k monthly users.
              </span>
            </li>
            <li>
              <span className="hero-hl hero-hl--rewrite">
                Instrumented Prometheus and Grafana, reducing mean incident time 35%.
              </span>
            </li>
            <li>
              <span className="hero-add">+ Added</span>
              <span className="hero-hl hero-hl--add">
                Standardized Terraform modules used by 4 squads for repeatable AWS environments.
              </span>
            </li>
          </>
        ) : (
          <>
            <li>Responsible for deploying applications to AWS.</li>
            <li>Worked on CI/CD pipelines and Docker containers.</li>
            <li>Involved in monitoring production systems.</li>
          </>
        )}
      </ul>
    </article>
  )
}

function pointOn(root, el, bias = { x: 0.58, y: 0.55 }) {
  if (!root) return { left: 40, top: 80 }
  if (!el) {
    return { left: root.clientWidth * 0.72, top: root.clientHeight * 0.48 }
  }
  const a = root.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  return {
    left: Math.round(b.left - a.left + b.width * bias.x),
    top: Math.round(b.top - a.top + b.height * bias.y),
  }
}

function HeroEnhancerDemo() {
  const phase = useHeroDemo()
  const step = DEMO_STEPS[phase] || DEMO_STEPS[0]
  const resumeReady = phase >= 3
  const jdReady = phase >= 5
  const compact = resumeReady && jdReady
  const enhanced = phase >= 7
  const score = enhanced ? 92 : resumeReady ? 65 : null

  const rootRef = useRef(null)
  const resumeRef = useRef(null)
  const jdRef = useRef(null)
  const enhanceRef = useRef(null)
  const previewRef = useRef(null)
  const summaryRef = useRef(null)
  const skillsRef = useRef(null)
  const jobRef = useRef(null)
  const [pos, setPos] = useState({ left: 220, top: 180 })

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const measure = () => {
      const targets = {
        resume: resumeRef.current,
        jd: jdRef.current,
        enhance: enhanceRef.current,
        preview: previewRef.current,
        summary: summaryRef.current,
        skills: skillsRef.current,
        job: jobRef.current,
      }
      const bias = step.target === 'enhance'
        ? { x: 0.72, y: 0.55 }
        : step.target === 'preview'
          ? { x: 0.52, y: 0.42 }
          : step.target === 'summary' || step.target === 'skills' || step.target === 'job'
            ? { x: 0.18, y: 0.75 }
            : { x: 0.38, y: 0.55 }
      setPos(pointOn(root, targets[step.target], bias))
    }

    measure()
    const frame = window.requestAnimationFrame(measure)
    const later = window.setTimeout(measure, 420)
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(later)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [phase, step.target, resumeReady, jdReady, enhanced, compact])

  const tipBelow = step.target === 'enhance'

  return (
    <div
      ref={rootRef}
      className={`hero__workspace ${compact ? 'is-compact' : ''}`}
    >
      <header className="hero__workspace-bar">
        <div>
          <span className="hero__workspace-kicker">Resume Enhancer</span>
          <strong>Score your resume against the job</strong>
        </div>
        <span
          ref={enhanceRef}
          className={`hero__workspace-cta ${step.active === 'enhance' ? 'is-active' : ''}`}
        >
          {enhanced ? 'Enhanced' : 'Enhance Resume'}
        </span>
      </header>
      <div className="hero__workspace-split">
        <aside className="hero__workspace-setup">
          <h3>Good afternoon.</h3>
          <p>Upload a resume, paste the JD, then enhance.</p>
          <div
            ref={resumeRef}
            className={`hero__workspace-tile ${step.active === 'resume' ? 'is-active' : ''} ${resumeReady ? 'is-ready' : ''}`}
          >
            <span>{resumeReady ? 'alex-rivera.pdf' : 'Upload Resume'}</span>
            <em>{resumeReady ? 'Original resume loaded' : 'English resumes in PDF or DOCX'}</em>
          </div>
          <div
            ref={jdRef}
            className={`hero__workspace-tile ${step.active === 'jd' ? 'is-active' : ''} ${jdReady ? 'is-ready' : ''}`}
          >
            <span>{jdReady ? 'Senior DevOps Engineer' : 'Paste Job Description'}</span>
            <em>{jdReady ? 'JD pasted · Kubernetes, Terraform, CI/CD' : 'Paste or type the job posting'}</em>
          </div>
        </aside>
        <section className="hero__workspace-preview">
          <div className="hero-demo__preview-bar">
            <span className="hero__workspace-kicker">Resume preview</span>
            <span className={`hero-demo__score ${score == null ? 'is-idle' : ''} ${enhanced ? 'is-up' : ''}`}>
              {score == null ? '— / 100' : `${score} / 100`}
            </span>
          </div>
          <div ref={previewRef} className="hero-demo__stage">
            <div className={`hero-demo__empty ${resumeReady ? 'is-off' : ''}`}>
              <strong>Your resume will appear here</strong>
              <span>Upload a PDF or DOCX to preview it beside your score.</span>
            </div>
            <div className={`hero-demo__sheet ${resumeReady ? 'is-on' : ''}`}>
              <HeroResume
                enhanced={enhanced}
                summaryRef={summaryRef}
                skillsRef={skillsRef}
                jobRef={jobRef}
              />
            </div>
          </div>
        </section>
      </div>

      <div
        className={`hero-demo__pointer ${step.tip ? '' : 'is-hidden'}`}
        style={{ left: pos.left, top: pos.top }}
        aria-hidden="true"
      >
        {step.tip ? (
          <div className={`hero-demo__tip ${tipBelow ? 'is-below' : ''} is-left`}>{step.tip}</div>
        ) : null}
        <div
          className={`enh-cursor hero-demo__cursor ${step.click ? 'enh-cursor--click' : ''} ${step.point ? 'enh-cursor--point' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 3l4.5 16 2.5-6.5L18.5 10 5 3z" fill="#0a0e0d" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default function Hero() {
  return (
    <section id="home" className="hero">
      <div className="hero__bg">
        <div className="hero__orb hero__orb--1" />
        <div className="hero__orb hero__orb--2" />
        <div className="hero__grid" />
      </div>

      <div className="container hero__inner">
        <div className="hero__content">
          <div className="hero__badge">
            <span className="hero__badge-dot" />
            AI-Powered Resume Platform
          </div>
          <h1 className="hero__title">
            Turn Any Resume Into a
            <span className="hero__title-accent"> Job-Matching Resume in Minutes</span>
          </h1>
          <p className="hero__subtitle">
            Upload your resume and paste any job description. Our AI identifies missing
            skills, ATS keywords, and weak experience bullets, then enhances your resume
            while preserving its original formatting.
          </p>
          <div className="hero__actions">
            <Link to="/services/resume-enhancer" className="btn btn--primary btn--lg">
              Enhance Your Resume Free
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link to="/#how-it-works" className="btn btn--ghost btn--lg">
              See How It Works
            </Link>
          </div>
          <div className="hero__stats">
            <div className="hero__stat">
              <strong>98%</strong>
              <span>ATS Pass Rate</span>
            </div>
            <div className="hero__stat-divider" />
            <div className="hero__stat">
              <strong>50K+</strong>
              <span>Resumes Enhanced</span>
            </div>
            <div className="hero__stat-divider" />
            <div className="hero__stat">
              <strong>4.9★</strong>
              <span>User Rating</span>
            </div>
          </div>
        </div>

        <div className="hero__visual">
          <HeroEnhancerDemo />
        </div>
      </div>
    </section>
  )
}
