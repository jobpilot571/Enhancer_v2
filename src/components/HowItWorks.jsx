import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const SERVICES = [
  {
    id: 'enhancer',
    title: 'Resume Enhancer',
    desc: 'Upload your current resume and the job description. We keep your layout, score it against the JD, rewrite weak bullets, and add missing proof from the same jobs — then show Original vs Rewritten beside a live preview.',
    path: '/services/resume-enhancer',
    cta: 'Enhance a resume',
    caption: 'Watch each change: yellow text is a rewrite typing over a weak line. Green “+ Added” lines are new bullets inserted from your experience.',
    tint: 'enhancer',
    topics: [
      {
        id: 'summary',
        label: 'Summary',
        headline: 'How we write the Professional Summary',
        facts: [
          { label: 'What we write', text: 'Five to six short bullets a recruiter can scan in seconds — not a long paragraph. Each bullet is about 12–22 words.' },
          { label: 'On what basis', text: 'Your existing summary, years and target title, plus the job description’s required skills and responsibilities.' },
          { label: 'What we add', text: 'Missing JD-aligned strengths that your experience already supports: core tools, domain, delivery, and one clear impact line.' },
          { label: 'How we add', text: 'Weak generic lines are rewritten in yellow. If the JD still needs a point your jobs can support, we insert a new green “+ Added” bullet.' },
          { label: 'Why we add', text: 'ATS and recruiters decide from the top of the page. A complete 5–6 bullet summary maps you to the role without stuffing keywords.' },
        ],
      },
      {
        id: 'skills',
        label: 'Skills',
        headline: 'How we update Technical Skills',
        facts: [
          { label: 'What we write', text: 'Your same skill categories and format — Cloud, CI/CD, tools — kept as a clean ATS list, not a paragraph of soft skills.' },
          { label: 'On what basis', text: 'Skills already on the resume, tools named in your experience, and concrete tools required by the job description.' },
          { label: 'What we add', text: 'Only real tools and platforms (Kubernetes, Terraform, Jira). We never add fluff like “communication” or “team player.”' },
          { label: 'How we add', text: 'Missing tools are appended in the matching category and highlighted green so you can see exactly what was introduced.' },
          { label: 'Why we add', text: 'ATS scans the skills section. If the JD asks for a tool you used on the job but did not list, your score drops even when the experience is there.' },
        ],
      },
      {
        id: 'experience',
        label: 'Experience',
        headline: 'How we rewrite Professional Experience',
        facts: [
          { label: 'What we write', text: 'Each existing bullet is scored against the JD. Strong lines stay. Weak “responsible for…” lines become specific actions, tools, and results.' },
          { label: 'On what basis', text: 'That company’s real project story, the JD’s responsibilities, and believable impact (time, reliability, users) — not copied JD sentences.' },
          { label: 'What we add', text: 'One to three new bullets per company when JD gaps remain, framed as work in that same role — never a fake employer or title.' },
          { label: 'How we add', text: 'Rewrites replace the old line in yellow. New proof slides in as a green “+ Added” bullet so you can tell rewrite vs insert.' },
          { label: 'Why we add', text: 'Experience is where hiring teams look for proof. Covering JD responsibilities here matters more than packing extra words into Skills.' },
        ],
      },
    ],
  },
  {
    id: 'builder',
    title: 'Resume Builder',
    desc: 'Start from your name, target role, and work history. We write a full ATS resume from scratch: a 5–6 bullet summary, categorized skills, and project-based experience you can download as DOCX.',
    path: '/services/resume-builder',
    cta: 'Build a resume',
    caption: 'A blank page becomes a full resume — summary, skills, and quantified experience — in the same ATS layout you download.',
    tint: 'builder',
    topics: [
      {
        id: 'summary',
        label: 'Summary',
        headline: 'How we generate the Professional Summary',
        facts: [
          { label: 'What we write', text: 'Five to six humanized bullets covering years, core stack, domain, how you deliver work, collaboration, and one achievement.' },
          { label: 'On what basis', text: 'The role you chose, years of experience, companies you enter, and any notes you add — not a copied job posting.' },
          { label: 'What we add', text: 'A complete summary even if you only typed a title. We fill the six beats recruiters expect so the page does not look unfinished.' },
          { label: 'How we add', text: 'Lines appear as the resume is generated, in the same order they will have in your downloaded file.' },
          { label: 'Why we add', text: 'A builder resume still needs a scannable top section. Six tight bullets beat one generic “results-driven professional” sentence.' },
        ],
      },
      {
        id: 'skills',
        label: 'Skills',
        headline: 'How we build the Skills section',
        facts: [
          { label: 'What we write', text: 'Grouped technical skills for that role — languages, stack, cloud, tools — short names an ATS can parse.' },
          { label: 'On what basis', text: 'Your target role plus the technologies used in the experience and projects we write for you.' },
          { label: 'What we add', text: 'Role-standard tools that belong on that resume (for example React, AWS, CI/CD for a software engineer), not unrelated buzzwords.' },
          { label: 'How we add', text: 'Categories are filled as the document is generated so Skills matches Summary and Experience instead of contradicting them.' },
          { label: 'Why we add', text: 'ATS keyword screens often start in Skills. An empty or mismatched list will tank a otherwise strong builder resume.' },
        ],
      },
      {
        id: 'experience',
        label: 'Experience',
        headline: 'How we write Professional Experience',
        facts: [
          { label: 'What we write', text: 'Project-based bullets for each job you enter: what you owned, the system, the tools, and a clear outcome.' },
          { label: 'On what basis', text: 'Company, title, dates, and the story you give us. We humanize and quantify — we do not invent employers.' },
          { label: 'What we add', text: 'Missing impact and technical depth on thin bullets (team size, uptime, load time, release count) when they fit the role.' },
          { label: 'How we add', text: 'Each job block is written in order, bullet by bullet, in the same ATS layout you download.' },
          { label: 'Why we add', text: 'Builders fail when they only list duties. Recruiters hire from proof of delivery, not from a task list.' },
        ],
      },
    ],
  },
  {
    id: 'jd',
    title: 'JD-Tailored Resume Builder',
    desc: 'Have a job description but no resume yet? We build one that matches the role: six summary bullets, JD skills, and experience language ATS and recruiters expect — without copying the posting.',
    path: '/services/jd-tailored-resume',
    cta: 'Build from a JD',
    caption: 'The job description drives the resume. Yellow = rewritten to match the role. Green = added JD keywords and proof.',
    tint: 'jd',
    topics: [
      {
        id: 'summary',
        label: 'Summary',
        headline: 'How we write a JD-matched summary',
        facts: [
          { label: 'What we write', text: 'Exactly six bullets, in order: years and target role, core skills, domain, delivery, collaboration, and one believable impact.' },
          { label: 'On what basis', text: 'The pasted job description plus the career level and companies generated for this resume.' },
          { label: 'What we add', text: 'JD keywords placed naturally across the six bullets — never one bullet stuffed with every tool, and never copied JD sentences.' },
          { label: 'How we add', text: 'The six-beat summary is generated as a set so each bullet has a job, then shown in the live preview.' },
          { label: 'Why we add', text: 'With no prior resume, the summary is how a recruiter maps you to this JD in a few seconds. Six complete beats prevent gaps.' },
        ],
      },
      {
        id: 'skills',
        label: 'Skills',
        headline: 'How we match Skills to the JD',
        facts: [
          { label: 'What we write', text: 'A technical skills list indexed from Summary, Experience, and Projects, plus important tools the JD requires.' },
          { label: 'On what basis', text: 'Every concrete tool that appears in the generated resume and every hard skill the posting asks for.' },
          { label: 'What we add', text: 'JD tools such as OKRs, SQL, or go-to-market systems when they fit the role — never soft skills.' },
          { label: 'How we add', text: 'Missing JD skills are highlighted green in the preview so you see what was introduced for ATS coverage.' },
          { label: 'Why we add', text: 'A JD-tailored resume must be selectable by keyword screens. Skills is the checklist ATS uses first.' },
        ],
      },
      {
        id: 'experience',
        label: 'Experience',
        headline: 'How we tailor Professional Experience',
        facts: [
          { label: 'What we write', text: 'Company-specific stories that cover the JD’s responsibilities: two-line professional bullets with tools, stakeholders, and outcomes.' },
          { label: 'On what basis', text: 'The job description’s duties and the companies/roles created for this build — not generic templates.' },
          { label: 'What we add', text: 'Extra bullets where the JD still has uncovered responsibilities, written as work at that same company.' },
          { label: 'How we add', text: 'Role language is rewritten in yellow to match the posting. New JD-proof bullets insert in green.' },
          { label: 'Why we add', text: 'Matching a JD only in Skills is not enough. Experience must show you have done the work the posting describes.' },
        ],
      },
    ],
  },
]

function useLoop(durations, resetKey) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    setPhase(0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setPhase(durations.length - 1)
      return undefined
    }
    let idx = 0
    let timer
    const tick = () => {
      timer = window.setTimeout(() => {
        idx = (idx + 1) % durations.length
        setPhase(idx)
        tick()
      }, durations[idx])
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [resetKey, durations])
  return phase
}

function Cursor({ left, top, clicking, pointing }) {
  return (
    <div
      className={`enh-cursor hw-cursor ${clicking ? 'enh-cursor--click' : ''} ${pointing ? 'enh-cursor--point' : ''}`}
      style={{ left, top }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 3l4.5 16 2.5-6.5L18.5 10 5 3z" fill="#0a0e0d" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function VersionToggle({ mode, onChange, showLegend }) {
  return (
    <div className="hw-demo__bar">
      <div className="pro-toggle" role="group" aria-label="Resume version">
        <button
          type="button"
          className={`pro-toggle__btn ${mode === 'original' ? 'is-active' : ''}`}
          onClick={() => onChange('original')}
        >
          Original
        </button>
        <button
          type="button"
          className={`pro-toggle__btn ${mode === 'rewritten' ? 'is-active' : ''}`}
          onClick={() => onChange('rewritten')}
        >
          Rewritten
        </button>
      </div>
      {showLegend && (
        <div className="pro-preview__legend">
          <span><span className="pro-preview__swatch pro-preview__swatch--yellow" /> Rewritten</span>
          <span><span className="pro-preview__swatch pro-preview__swatch--green" /> Added</span>
        </div>
      )}
    </div>
  )
}

function Typed({ text, play, instant }) {
  const [n, setN] = useState(() => (instant ? text.length : 0))

  useEffect(() => {
    if (instant) {
      setN(text.length)
      return undefined
    }
    if (!play) {
      setN(0)
      return undefined
    }
    setN(0)
    const step = Math.max(2, Math.ceil(text.length / 38))
    const id = window.setInterval(() => {
      setN((prev) => {
        const next = Math.min(text.length, prev + step)
        if (next >= text.length) window.clearInterval(id)
        return next
      })
    }, 28)
    return () => window.clearInterval(id)
  }, [text, play, instant])

  const shown = text.slice(0, n)
  const typing = play && !instant && n < text.length
  return (
    <>
      {shown}
      {typing && <span className="hw-caret" aria-hidden="true" />}
    </>
  )
}

function RewriteLine({ original, rewritten, state, instant }) {
  const [phase, setPhase] = useState('wait')

  useEffect(() => {
    if (instant && (state === 'typing' || state === 'done')) {
      setPhase('type')
      return undefined
    }
    if (state === 'idle') {
      setPhase('wait')
      return undefined
    }
    if (state === 'done') {
      setPhase('type')
      return undefined
    }
    setPhase('strike')
    const timer = window.setTimeout(() => setPhase('type'), 420)
    return () => window.clearTimeout(timer)
  }, [state, instant])

  if (state === 'idle') return <li>{original}</li>
  if (phase === 'strike') {
    return (
      <li data-hw-active="true">
        <span className="hw-old">{original}</span>
      </li>
    )
  }
  return (
    <li data-hw-active={state === 'typing' ? 'true' : undefined}>
      <span className="hw-hl hw-hl--rewrite">
        <Typed text={rewritten} play={phase === 'type'} instant={instant || state === 'done'} />
      </span>
    </li>
  )
}

function AddLine({ text, state, instant }) {
  if (state === 'idle') return null
  return (
    <li className="hw-bullet--insert" data-hw-active={state === 'typing' ? 'true' : undefined}>
      <span className="hw-add-tag">+ Added</span>
      <span className="hw-hl hw-hl--add">
        <Typed text={text} play={state === 'typing'} instant={instant || state === 'done'} />
      </span>
    </li>
  )
}

function AddSkill({ text, state, instant }) {
  if (state === 'idle') return null
  return (
    <span className="hw-hl hw-hl--add hw-skill-add">
      <Typed text={text} play={state === 'typing'} instant={instant || state === 'done'} />
    </span>
  )
}

function lineState(idx, itemIdx, switched) {
  if (!switched) return 'idle'
  if (idx > itemIdx) return 'done'
  if (idx === itemIdx) return 'typing'
  return 'idle'
}

const SUMMARY_LINES = [
  {
    kind: 'rewrite',
    original: 'DevOps engineer with experience supporting cloud infrastructure and application deployments.',
    rewritten: 'DevOps Engineer with 5+ years owning AWS platforms, Terraform IaC, and Kubernetes delivery for production workloads.',
  },
  {
    kind: 'rewrite',
    original: 'Responsible for CI/CD pipelines, Docker containers, and helping the development team.',
    rewritten: 'Built Jenkins and GitHub Actions pipelines that raised successful releases to 99.9% across 12 services.',
  },
  {
    kind: 'rewrite',
    original: 'Worked on AWS services and Linux servers for production environments.',
    rewritten: 'Designed AWS networking and IAM for EKS, EC2, and S3 serving 50k monthly users.',
  },
  {
    kind: 'rewrite',
    original: 'Involved in monitoring, incident response, and on-call support.',
    rewritten: 'Instrumented Prometheus and Grafana, reducing mean incident time 35% on a 24/7 on-call rotation.',
  },
  {
    kind: 'rewrite',
    original: 'Helped the team with infrastructure tasks and documentation.',
    rewritten: 'Standardized Terraform modules used by 4 squads for repeatable AWS environments.',
  },
  {
    kind: 'add',
    rewritten: 'Partnered with developers to automate Kubernetes rollouts and cut release time 40%.',
  },
]

const SKILL_ROWS = [
  { label: 'Cloud Platforms', base: 'AWS (EC2, S3, IAM, VPC)', adds: ['EKS'] },
  { label: 'Containers', base: 'Docker', adds: ['Kubernetes', 'Helm'] },
  { label: 'CI/CD', base: 'Jenkins, Git', adds: ['GitHub Actions'] },
  { label: 'Infrastructure as Code', base: 'Linux, Bash', adds: ['Terraform', 'Ansible'] },
  { label: 'Observability', base: 'CloudWatch', adds: ['Prometheus', 'Grafana'] },
  { label: 'Languages', base: 'Python, Bash, YAML', adds: [] },
]

const SKILL_ADDS = SKILL_ROWS.flatMap((row, rowIdx) =>
  row.adds.map((text, addIdx) => ({ rowIdx, addIdx, text })),
)

const EXPERIENCE = [
  {
    title: 'DevOps Engineer',
    company: 'Northline Tech — Austin, TX',
    dates: 'Jan 2021 – Present',
    bullets: [
      {
        kind: 'rewrite',
        original: 'Responsible for deploying applications to AWS.',
        rewritten: 'Deployed container workloads to AWS EKS with Terraform, cutting release time 40%.',
      },
      {
        kind: 'rewrite',
        original: 'Worked on CI/CD pipelines and Docker containers.',
        rewritten: 'Built Jenkins and GitHub Actions pipelines, raising successful releases to 99.9%.',
      },
      {
        kind: 'rewrite',
        original: 'Involved in monitoring production systems.',
        rewritten: 'Instrumented Prometheus and Grafana dashboards, reducing mean incident time 35%.',
      },
      {
        kind: 'rewrite',
        original: 'Helped the team with infrastructure tasks.',
        rewritten: 'Standardized Terraform modules used by 4 squads for repeatable AWS environments.',
      },
      {
        kind: 'add',
        rewritten: 'Automated Kubernetes rollouts across 12 microservices on AWS EKS.',
      },
      {
        kind: 'add',
        rewritten: 'Hardened IAM and VPC controls, closing 18 high-risk findings before audit.',
      },
    ],
  },
  {
    title: 'Systems Engineer',
    company: 'BrightPath Labs — Austin, TX',
    dates: 'Jun 2018 – Dec 2020',
    bullets: [
      {
        kind: 'rewrite',
        original: 'Responsible for Linux servers and backups.',
        rewritten: 'Managed Linux fleets and automated backups, cutting restore time 60%.',
      },
      {
        kind: 'rewrite',
        original: 'Worked with the team on application releases.',
        rewritten: 'Coordinated weekly release trains with Git and Jenkins for 8 services.',
      },
      {
        kind: 'rewrite',
        original: 'Supported developers with environment setup.',
        rewritten: 'Provisioned repeatable Linux environments so new engineers were productive on day one.',
      },
      {
        kind: 'add',
        rewritten: 'Introduced containerized local stacks with Docker, reducing environment drift.',
      },
    ],
  },
]

const EXP_LINES = EXPERIENCE.flatMap((job, jobIdx) =>
  job.bullets.map((bullet, bulletIdx) => ({ ...bullet, jobIdx, bulletIdx })),
)

const SUM_START = 2
const SKILL_START = SUM_START + SUMMARY_LINES.length
const EXP_START = SKILL_START + SKILL_ADDS.length
const SCORE_IDX = EXP_START + EXP_LINES.length

const ENH_SCRIPT = [
  { ms: 1700, status: 'Reading the original resume…' },
  { ms: 800, status: 'Opening Rewritten…' },
  ...SUMMARY_LINES.map((line) => ({
    ms: line.kind === 'add' ? 1750 : 1450,
    status: line.kind === 'add' ? 'Adding a new summary bullet…' : 'Rewriting a weak summary bullet…',
  })),
  ...SKILL_ADDS.map(() => ({
    ms: 620,
    status: 'Adding missing skills from the job description…',
  })),
  ...EXP_LINES.map((line) => ({
    ms: line.kind === 'add' ? 1750 : 1450,
    status: line.kind === 'add' ? 'Adding a new experience bullet…' : 'Rewriting a weak experience bullet…',
  })),
  { ms: 2600, status: 'Score updated from the rewritten resume.' },
]

function useScript(script, resetKey) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setIdx(0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setIdx(script.length - 1)
      return undefined
    }
    let i = 0
    let timer
    const tick = () => {
      timer = window.setTimeout(() => {
        i = (i + 1) % script.length
        setIdx(i)
        tick()
      }, script[i].ms)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [resetKey, script])
  return idx
}

function EnhancerStage({ focusSection }) {
  const idx = useScript(ENH_SCRIPT, 'enhancer')
  const [manual, setManual] = useState(null)
  const canvasRef = useRef(null)
  const reduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (idx === 0) setManual(null)
  }, [idx])

  const autoMode = idx >= 1 ? 'rewritten' : 'original'
  const mode = manual || autoMode
  const switched = mode === 'rewritten'
  const instant = Boolean(manual === 'rewritten' || reduced || idx >= SCORE_IDX)
  const playIdx = manual === 'rewritten' || reduced ? SCORE_IDX : idx
  const scored = switched && (instant || idx >= SCORE_IDX)
  const status = switched
    ? (ENH_SCRIPT[Math.min(playIdx, ENH_SCRIPT.length - 1)]?.status || '')
    : 'Original resume — weak duty lines, missing JD skills.'

  useEffect(() => {
    const root = canvasRef.current
    if (!root) return undefined
    if (mode === 'original' && !focusSection) {
      root.scrollTo({ top: 0, behavior: 'smooth' })
      return undefined
    }
    const pinned = focusSection
      ? root.querySelector(`[data-section="${focusSection}"]`)
      : null
    const active = pinned || root.querySelector('[data-hw-active="true"]')
    if (!active) return undefined
    const next = root.scrollTop + (active.getBoundingClientRect().top - root.getBoundingClientRect().top) - 56
    root.scrollTo({ top: Math.max(0, next), behavior: 'smooth' })
    return undefined
  }, [playIdx, mode, focusSection])

  const showCursor = mode === 'original' || idx === 1
  const cursor = idx === 1 ? { left: '18%', top: '8%' } : { left: '48%', top: '42%' }

  return (
    <div className="hw-demo">
      <VersionToggle mode={mode} onChange={setManual} showLegend={switched} />
      <p className="hw-status">{status}</p>
      <div className="hw-demo__canvas" ref={canvasRef}>
        <article className="hw-page">
          <header className="hw-page__head">
            <h3 className="hw-page__name">Alex Rivera</h3>
            <p className="hw-page__title">
              {switched
                ? 'DevOps Engineer | Cloud Infrastructure | Kubernetes | CI/CD Automation'
                : 'DevOps Engineer'}
            </p>
            <p className="hw-page__contact">
              Austin, TX · (512) 555-0148 · alex.rivera@email.com · linkedin.com/in/alexrivera
            </p>
          </header>

          <h4 className="hw-page__sec" data-section="summary">Professional Summary</h4>
          <ul className="hw-page__bullets">
            {SUMMARY_LINES.map((line, i) => {
              const state = lineState(playIdx, SUM_START + i, switched)
              if (line.kind === 'add') {
                return <AddLine key={`s-${i}`} text={line.rewritten} state={state} instant={instant} />
              }
              return (
                <RewriteLine
                  key={`s-${i}`}
                  original={line.original}
                  rewritten={line.rewritten}
                  state={state}
                  instant={instant}
                />
              )
            })}
          </ul>

          <h4 className="hw-page__sec" data-section="skills">Technical Skills</h4>
          <div className="hw-page__skills">
            {SKILL_ROWS.map((row, rowIdx) => (
              <p key={row.label}>
                <strong>{row.label}:</strong> {row.base}
                {row.adds.map((text, addIdx) => {
                  const skillIdx = SKILL_ADDS.findIndex(
                    (item) => item.rowIdx === rowIdx && item.addIdx === addIdx,
                  )
                  const state = lineState(playIdx, SKILL_START + skillIdx, switched)
                  return (
                    <span key={text}>
                      {state !== 'idle' ? ', ' : null}
                      <AddSkill text={text} state={state} instant={instant} />
                    </span>
                  )
                })}
              </p>
            ))}
          </div>

          <h4 className="hw-page__sec" data-section="experience">Professional Experience</h4>
          {EXPERIENCE.map((job, jobIdx) => (
            <div key={job.company}>
              <div className="hw-page__job">
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.company}</span>
                </div>
                <em>{job.dates}</em>
              </div>
              <ul className="hw-page__bullets">
                {job.bullets.map((line, bulletIdx) => {
                  const flatIdx = EXP_LINES.findIndex(
                    (item) => item.jobIdx === jobIdx && item.bulletIdx === bulletIdx,
                  )
                  const state = lineState(playIdx, EXP_START + flatIdx, switched)
                  if (line.kind === 'add') {
                    return <AddLine key={`${jobIdx}-${bulletIdx}`} text={line.rewritten} state={state} instant={instant} />
                  }
                  return (
                    <RewriteLine
                      key={`${jobIdx}-${bulletIdx}`}
                      original={line.original}
                      rewritten={line.rewritten}
                      state={state}
                      instant={instant}
                    />
                  )
                })}
              </ul>
            </div>
          ))}
        </article>
      </div>
      {scored && (
        <div className="hw-score-chip enh-appear">
          <strong>65 → 92</strong>
          <span>ATS score</span>
        </div>
      )}
      {showCursor && (
        <Cursor left={cursor.left} top={cursor.top} clicking={idx === 1} pointing={false} />
      )}
    </div>
  )
}

const BLD_DURATIONS = [800, 1000, 1100, 1100, 1200, 1300, 2200]
const BLD_CURSOR = [
  { left: '50%', top: '14%' },
  { left: '50%', top: '14%' },
  { left: '46%', top: '32%' },
  { left: '40%', top: '46%' },
  { left: '48%', top: '62%' },
  { left: '50%', top: '74%' },
  { left: '70%', top: '18%' },
]

function usePinSection(canvasRef, focusSection) {
  useEffect(() => {
    const root = canvasRef.current
    if (!root || !focusSection) return undefined
    const el = root.querySelector(`[data-section="${focusSection}"]`)
    if (!el) return undefined
    const next = root.scrollTop + (el.getBoundingClientRect().top - root.getBoundingClientRect().top) - 24
    root.scrollTo({ top: Math.max(0, next), behavior: 'smooth' })
    return undefined
  }, [canvasRef, focusSection])
}

function BuilderStage({ focusSection }) {
  const phase = useLoop(BLD_DURATIONS, 'builder')
  const header = phase >= 1
  const summary = phase >= 2
  const skills = phase >= 3
  const job = phase >= 4
  const extra = phase >= 5
  const cursor = BLD_CURSOR[phase] || BLD_CURSOR[0]
  const canvasRef = useRef(null)
  usePinSection(canvasRef, focusSection)

  return (
    <div className="hw-demo">
      <div className="hw-demo__bar">
        <span className="hw-demo__kicker">Live preview</span>
      </div>
      <div className="hw-demo__canvas" ref={canvasRef}>
        <article className="hw-page">
          {header ? (
            <header className="hw-page__head enh-appear">
              <h3 className="hw-page__name">Maya Chen</h3>
              <p className="hw-page__title">Software Engineer | Full-Stack | Cloud</p>
              <p className="hw-page__contact">
                Austin, TX · (512) 555-0194 · maya.chen@email.com · linkedin.com/in/mayachen
              </p>
            </header>
          ) : (
            <div className="hw-skel hw-skel--head" />
          )}

          <h4 className="hw-page__sec" data-section="summary">Professional Summary</h4>
          {summary ? (
            <ul className="hw-page__bullets enh-appear">
              <li>
                Software Engineer with 5 years building scalable web apps, APIs, and cloud delivery for product teams.
              </li>
            </ul>
          ) : (
            <div className="hw-skel hw-skel--line" />
          )}

          <h4 className="hw-page__sec" data-section="skills">Technical Skills</h4>
          {skills ? (
            <div className="hw-page__skills enh-appear">
              <p><strong>Languages:</strong> TypeScript, Python, SQL</p>
              <p><strong>Stack:</strong> React, Node.js, AWS, CI/CD</p>
            </div>
          ) : (
            <div className="hw-skel hw-skel--line" />
          )}

          <h4 className="hw-page__sec" data-section="experience">Professional Experience</h4>
          {job ? (
            <>
              <div className="hw-page__job enh-appear">
                <div>
                  <strong>Software Engineer</strong>
                  <span>Harbor Apps — Austin, TX</span>
                </div>
                <em>2020 – Present</em>
              </div>
              <ul className="hw-page__bullets">
                <li className="enh-appear">Led a team of 8 engineers shipping 6 major releases on schedule.</li>
                <li className="enh-appear">Built a payments API handling 2M+ transactions with 99.9% uptime.</li>
                {extra && (
                  <li className="enh-appear">Cut page load 40% through a performance optimization project.</li>
                )}
              </ul>
            </>
          ) : (
            <div className="hw-skel hw-skel--block" />
          )}
        </article>
      </div>
      <Cursor left={cursor.left} top={cursor.top} clicking={phase === 1 || phase === 4} pointing={phase >= 6} />
    </div>
  )
}

const JD_DURATIONS = [1000, 1100, 1300, 1300, 1400, 1500, 2400]
const JD_CURSOR = [
  { left: '78%', top: '10%' },
  { left: '78%', top: '10%' },
  { left: '18%', top: '8%' },
  { left: '48%', top: '58%' },
  { left: '50%', top: '70%' },
  { left: '34%', top: '42%' },
  { left: '86%', top: '16%' },
]

function JdStage({ focusSection }) {
  const phase = useLoop(JD_DURATIONS, 'jd')
  const [manual, setManual] = useState(null)
  const canvasRef = useRef(null)
  usePinSection(canvasRef, focusSection)

  useEffect(() => {
    if (phase === 0) setManual(null)
  }, [phase])

  const autoMode = phase >= 2 ? 'rewritten' : 'original'
  const mode = manual || autoMode
  const rewritten = mode === 'rewritten'
  const all = Boolean(manual === 'rewritten' || (rewritten && phase >= 5))
  const r1 = rewritten && (all || manual || phase >= 2)
  const added = rewritten && (all || manual || phase >= 4)
  const keywords = rewritten && (all || manual || phase >= 5)
  const cursor = JD_CURSOR[phase] || JD_CURSOR[0]
  const rewriteState = r1 ? 'done' : 'idle'
  const addState = added ? 'done' : 'idle'
  const skillState = keywords ? 'done' : 'idle'

  return (
    <div className="hw-demo">
      <VersionToggle mode={mode} onChange={setManual} showLegend={rewritten} />
      <div className="hw-demo__canvas" ref={canvasRef}>
        {phase >= 1 && (
          <div className="hw-jd-chip enh-appear">JD: Senior Product Manager · B2B SaaS</div>
        )}
        <article className="hw-page">
          <header className="hw-page__head">
            <h3 className="hw-page__name">Jordan Hale</h3>
            <p className="hw-page__title">
              {r1 ? 'Senior Product Manager | B2B SaaS | Roadmaps' : 'Product Manager'}
            </p>
            <p className="hw-page__contact">
              Chicago, IL · (312) 555-0172 · jordan.hale@email.com · linkedin.com/in/jordanhale
            </p>
          </header>

          <h4 className="hw-page__sec" data-section="summary">Professional Summary</h4>
          <ul className="hw-page__bullets">
            <RewriteLine
              original="Product manager with experience working with engineering teams and stakeholders."
              rewritten="Senior Product Manager with 7+ years driving B2B SaaS roadmaps, go-to-market, and KPI-led growth."
              state={rewriteState}
              instant
            />
          </ul>

          <h4 className="hw-page__sec" data-section="skills">Technical Skills</h4>
          <div className="hw-page__skills">
            <p>
              <strong>Product:</strong> Roadmaps, Agile, Jira, SQL
              {['OKRs', 'Go-to-market', 'KPIs'].map((text) => (
                <span key={text}>
                  {skillState !== 'idle' ? ', ' : null}
                  <AddSkill text={text} state={skillState} instant />
                </span>
              ))}
            </p>
          </div>

          <h4 className="hw-page__sec" data-section="experience">Professional Experience</h4>
          <div className="hw-page__job">
            <div>
              <strong>{r1 ? 'Senior Product Manager' : 'Product Manager'}</strong>
              <span>NovaTech — Chicago, IL</span>
            </div>
            <em>2019 – Present</em>
          </div>
          <ul className="hw-page__bullets">
            <RewriteLine
              original="Managed product features and attended sprint meetings."
              rewritten="Defined the product roadmap for a platform with $8M ARR and 12 stakeholders."
              state={rewriteState}
              instant
            />
            <RewriteLine
              original="Worked on social and marketing requests from the business team."
              rewritten="Ran A/B experiments that lifted conversion 32% across 25,000 monthly users."
              state={rewriteState}
              instant
            />
            <AddLine
              text="Partnered with GTM on launch plans that grew qualified pipeline 18% quarter over quarter."
              state={addState}
              instant
            />
          </ul>
        </article>
      </div>
      <Cursor left={cursor.left} top={cursor.top} clicking={phase === 2 || phase === 4} pointing={phase >= 6} />
    </div>
  )
}

function IconEnhancer() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  )
}
function IconBuilder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
function IconJd() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

const ICONS = { enhancer: IconEnhancer, builder: IconBuilder, jd: IconJd }

export default function HowItWorks() {
  const [activeId, setActiveId] = useState('enhancer')
  const [topicId, setTopicId] = useState('summary')
  const [pinDemo, setPinDemo] = useState(false)
  const active = SERVICES.find((s) => s.id === activeId) || SERVICES[0]
  const Stage = activeId === 'builder' ? BuilderStage : activeId === 'jd' ? JdStage : EnhancerStage
  const topic = active.topics.find((item) => item.id === topicId) || active.topics[0]

  function selectService(id) {
    setActiveId(id)
    setTopicId('summary')
    setPinDemo(false)
  }

  function selectTopic(id) {
    setTopicId(id)
    setPinDemo(true)
  }

  return (
    <section id="how-it-works" className="how-it-works">
      <div className="container">
        <div className="section-header">
          <span className="section-label">How It Works</span>
          <h2 className="section-title">Pick a service. See how each section is written.</h2>
          <p className="section-desc">
            Open a tool, then tap Summary, Skills, or Experience to learn what we generate, on what basis, and why we add lines.
          </p>
        </div>

        <div className="hw-split">
          <div className="hw-menu" role="list">
            {SERVICES.map((svc) => {
              const open = svc.id === activeId
              const Icon = ICONS[svc.id]
              return (
                <div
                  key={svc.id}
                  role="listitem"
                  className={`hw-item hw-item--${svc.id} ${open ? 'is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="hw-item__head"
                    onClick={() => selectService(svc.id)}
                    aria-expanded={open}
                  >
                    <span className="hw-item__icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="hw-item__title">{svc.title}</span>
                    <span className="hw-item__chev" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        {open ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
                      </svg>
                    </span>
                  </button>
                  {open && (
                    <div className="hw-item__panel">
                      <p className="hw-item__desc">{svc.desc}</p>
                      <div className="hw-topics" role="tablist" aria-label={`${svc.title} sections`}>
                        {svc.topics.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            role="tab"
                            className={`hw-topic ${topicId === item.id ? 'is-active' : ''}`}
                            aria-selected={topicId === item.id}
                            onClick={() => selectTopic(item.id)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      {topic && (
                        <div className="hw-explain" role="tabpanel">
                          <strong className="hw-explain__title">{topic.headline}</strong>
                          <dl className="hw-explain__list">
                            {topic.facts.map((fact) => (
                              <div key={fact.label} className="hw-explain__row">
                                <dt>{fact.label}</dt>
                                <dd>{fact.text}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={`hw-stage hw-stage--${active.tint}`}>
            <div className="hw-stage__label">
              <span /> {active.title}
            </div>
            <div className="hw-window">
              <Stage key={active.id} focusSection={pinDemo ? topicId : null} />
            </div>
            <p className="hw-stage__caption">{active.caption}</p>
            <Link to={active.path} className="btn btn--primary hw-stage__cta">
              {active.cta}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
