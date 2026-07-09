import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/* Word-style sample resume used inside the animated demo boxes */
function WordDoc({ enhanced = false, typing = false }) {
  return (
    <div className={`enh-doc ${enhanced ? 'enh-doc--enhanced' : ''} ${typing ? 'enh-doc--typing' : ''}`}>
      <div className="enh-doc__header">
        <div className="enh-doc__name">ALEX MORGAN</div>
        <div className="enh-doc__role">
          {enhanced ? (
            <>Senior <mark className="enh-hl">Product Manager</mark></>
          ) : (
            'Product Manager'
          )}
        </div>
        <div className="enh-doc__contact">alex.morgan@email.com • San Francisco</div>
      </div>
      <div className="enh-doc__rule" />

      <div className="enh-doc__sec">SUMMARY</div>
      <div className="enh-doc__p">
        {enhanced ? (
          <>PM with <mark className="enh-hl">8+ yrs</mark> driving <mark className="enh-hl">SaaS growth</mark> and roadmap strategy.</>
        ) : (
          'PM with experience in SaaS products and teams.'
        )}
      </div>

      <div className="enh-doc__sec">EXPERIENCE</div>
      <div className="enh-doc__co">
        <strong>TechVentures Inc.</strong><span>2021–Now</span>
      </div>
      <ul className="enh-doc__bullets">
        <li className={enhanced ? 'enh-bullet--changed' : ''}>
          {enhanced ? (
            <>Led platform to <mark className="enh-hl">50k+ users</mark>, <mark className="enh-hl">40% growth</mark></>
          ) : (
            'Managed product platform'
          )}
        </li>
        <li className={enhanced ? 'enh-bullet--changed' : ''}>
          {enhanced ? (
            <>Ran <mark className="enh-hl">A/B tests</mark> lifting conv. <mark className="enh-hl">28%</mark></>
          ) : (
            'Worked on features'
          )}
        </li>
      </ul>

      <div className="enh-doc__sec">SKILLS</div>
      <div className="enh-doc__skills">
        {enhanced ? (
          <>
            <mark className="enh-hl">Roadmap</mark> • <mark className="enh-hl">Agile</mark> • SQL • <mark className="enh-hl">KPIs</mark>
          </>
        ) : (
          'PM • Agile • Communication'
        )}
      </div>
    </div>
  )
}

function DemoCursor({ left, top, clicking = false, pointing = false }) {
  return (
    <div
      className={`enh-cursor ${clicking ? 'enh-cursor--click' : ''} ${pointing ? 'enh-cursor--point' : ''}`}
      style={{ left, top }}
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 3l4.5 16 2.5-6.5L18.5 10 5 3z" fill="#0a0e0d" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function DemoBadges({ show, badges }) {
  return (
    <div className={`enh-badges ${show ? 'enh-badges--show' : ''}`}>
      {badges.map((b, i) => (
        <span key={b} className="enh-badge" style={{ '--b-delay': `${i * 120}ms` }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          {b}
        </span>
      ))}
    </div>
  )
}

function useDemoLoop(durations, finalPhase) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setPhase(finalPhase)
      return
    }
    let idx = 0
    let timer
    const tick = () => {
      timer = setTimeout(() => {
        idx = (idx + 1) % durations.length
        setPhase(idx)
        tick()
      }, durations[idx])
    }
    tick()
    return () => clearTimeout(timer)
  }, [durations, finalPhase])
  return phase
}

function BuilderWordDoc() {
  return (
    <div className="enh-doc enh-doc--builder">
      <div className="enh-doc__header">
        <div className="enh-doc__name">SARAH CHEN</div>
        <div className="enh-doc__role">Software Engineer</div>
        <div className="enh-doc__contact">sarah.chen@email.com • Austin, TX</div>
      </div>
      <div className="enh-doc__rule" />

      <div className="enh-doc__sec">SUMMARY</div>
      <div className="enh-doc__p">
        Software Engineer with 5 years building scalable web apps and leading cross-functional delivery.
      </div>

      <div className="enh-doc__sec">SKILLS</div>
      <div className="enh-doc__skills">React • TypeScript • Node.js • AWS • Agile • CI/CD</div>

      <div className="enh-doc__sec">EXPERIENCE</div>
      <div className="enh-doc__co">
        <strong>CloudScale Inc.</strong><span>2020–Now</span>
      </div>
      <ul className="enh-doc__bullets">
        <li>Led team of 8 engineers shipping 6 major releases on schedule</li>
        <li>Built payment API handling 2M+ transactions with 99.9% uptime</li>
        <li>Reduced page load time 40% via performance optimization project</li>
      </ul>

      <div className="enh-doc__sec">PROJECTS</div>
      <ul className="enh-doc__bullets">
        <li>Real-time analytics dashboard — React, WebSockets, 50k DAU</li>
      </ul>
    </div>
  )
}

function JDWordDoc() {
  return (
    <div className="enh-doc enh-doc--enhanced">
      <div className="enh-doc__header">
        <div className="enh-doc__name">JAMES PARK</div>
        <div className="enh-doc__role">
          Senior <mark className="enh-hl">Product Manager</mark>
        </div>
        <div className="enh-doc__contact">james.park@email.com • Remote</div>
      </div>
      <div className="enh-doc__rule" />

      <div className="enh-doc__sec">SUMMARY</div>
      <div className="enh-doc__p">
        <mark className="enh-hl">B2B SaaS</mark> PM with <mark className="enh-hl">7+ years</mark> driving{' '}
        <mark className="enh-hl">roadmap</mark> and <mark className="enh-hl">go-to-market</mark> strategy.
      </div>

      <div className="enh-doc__sec">EXPERIENCE</div>
      <div className="enh-doc__co">
        <strong>NovaTech</strong><span>2019–Now</span>
      </div>
      <ul className="enh-doc__bullets">
        <li className="enh-bullet--changed">
          Defined <mark className="enh-hl">product roadmap</mark> for platform with <mark className="enh-hl">$8M ARR</mark>
        </li>
        <li className="enh-bullet--changed">
          Ran <mark className="enh-hl">A/B experiments</mark> improving conversion <mark className="enh-hl">32%</mark>
        </li>
      </ul>

      <div className="enh-doc__sec">SKILLS</div>
      <div className="enh-doc__skills">
        <mark className="enh-hl">Agile</mark> • <mark className="enh-hl">KPIs</mark> • SQL • <mark className="enh-hl">Stakeholders</mark>
      </div>
    </div>
  )
}

const CURSOR_POS = {
  0: { left: '50%', top: '50%' },
  1: { left: '25%', top: '24%' },
  2: { left: '25%', top: '24%' },
  3: { left: '75%', top: '24%' },
  4: { left: '74%', top: '32%' },
  5: { left: '50%', top: '58%' },
  6: { left: '74%', top: '74%' },
  7: { left: '70%', top: '66%' },
  8: { left: '70%', top: '66%' },
}

const PHASE_DURATIONS = [700, 950, 1150, 950, 1350, 1050, 950, 1450, 2100]

function EnhancerPreview() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setPhase(8)
      return
    }
    let idx = 0
    let timer
    const tick = () => {
      timer = setTimeout(() => {
        idx = (idx + 1) % PHASE_DURATIONS.length
        setPhase(idx)
        tick()
      }, PHASE_DURATIONS[idx])
    }
    tick()
    return () => clearTimeout(timer)
  }, [])

  const uploadFilled = phase >= 2
  const clicking = phase === 2
  const jdTyping = phase === 4
  const jdFilled = phase >= 4
  const jdComplete = phase >= 5
  const originalFilled = phase >= 5
  const enhancedFilled = phase >= 7
  const badgesShown = phase >= 8

  const cursor = CURSOR_POS[phase] || CURSOR_POS[0]

  const badges = ['ATS Score Improved', 'Keywords Added', 'Bullets Improved', 'JD Matched']

  return (
    <div className="card-preview card-preview--enhancer enh-demo">
      <div className="card-preview__row">
        <div className={`mini-box mini-box--upload ${clicking ? 'enh-box--active' : ''}`}>
          <div className="mini-box__header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Upload Resume</span>
          </div>
          <div className="mini-box__body enh-scroll">
            {uploadFilled ? (
              <div className="enh-appear"><WordDoc /></div>
            ) : (
              <div className="enh-dropzone">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Click to upload</span>
              </div>
            )}
          </div>
        </div>

        <div className={`mini-box mini-box--jd ${jdTyping ? 'enh-box--active' : ''}`}>
          <div className="mini-box__header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
            <span>Paste / Upload JD</span>
          </div>
          <div className="mini-box__body mini-box__body--jd enh-scroll">
            {jdFilled ? (
              <div className="enh-jd">
                <div className={`enh-jd__line ${jdTyping ? 'enh-jd__line--type1' : ''}`} />
                <div className={`enh-jd__line ${jdTyping ? 'enh-jd__line--type2' : ''}`} />
                <div className={`enh-jd__line enh-jd__line--short ${jdTyping ? 'enh-jd__line--type3' : ''}`} />
                {jdComplete && <span className="mini-tag mini-tag--blue enh-appear">Senior PM • SaaS</span>}
                {jdTyping && <span className="enh-caret" />}
              </div>
            ) : (
              <div className="enh-dropzone enh-dropzone--jd">
                <span>Paste job description…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card-preview__row">
        <div className="mini-box mini-box--preview enh-scroll">
          <span className="mini-label">Original</span>
          {originalFilled ? (
            <div className="enh-appear"><WordDoc /></div>
          ) : (
            <div className="enh-empty" />
          )}
        </div>

        <div className={`mini-box mini-box--preview mini-box--enhanced enh-scroll ${enhancedFilled ? 'enh-box--glow' : ''}`}>
          <span className="mini-label mini-label--amber">Enhanced</span>
          {enhancedFilled ? (
            <div className="enh-appear"><WordDoc enhanced /></div>
          ) : (
            <div className="enh-empty" />
          )}
        </div>
      </div>

      <div className={`enh-badges ${badgesShown ? 'enh-badges--show' : ''}`}>
        {badges.map((b, i) => (
          <span key={b} className="enh-badge" style={{ '--b-delay': `${i * 120}ms` }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            {b}
          </span>
        ))}
      </div>

      <div
        className={`enh-cursor ${clicking ? 'enh-cursor--click' : ''} ${phase === 7 || phase === 8 ? 'enh-cursor--point' : ''}`}
        style={{ left: cursor.left, top: cursor.top }}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 3l4.5 16 2.5-6.5L18.5 10 5 3z" fill="#0a0e0d" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}

const BUILDER_DURATIONS = [650, 850, 1000, 850, 1000, 750, 750, 1200, 2000]
const BUILDER_CURSOR = {
  0: { left: '50%', top: '50%' },
  1: { left: '28%', top: '14%' },
  2: { left: '28%', top: '14%' },
  3: { left: '28%', top: '28%' },
  4: { left: '28%', top: '28%' },
  5: { left: '22%', top: '42%' },
  6: { left: '78%', top: '42%' },
  7: { left: '50%', top: '72%' },
  8: { left: '50%', top: '72%' },
}

const JD_DURATIONS = [650, 900, 1100, 850, 850, 1000, 1300, 2000]
const JD_CURSOR = {
  0: { left: '50%', top: '50%' },
  1: { left: '50%', top: '16%' },
  2: { left: '50%', top: '22%' },
  3: { left: '25%', top: '48%' },
  4: { left: '75%', top: '48%' },
  5: { left: '50%', top: '58%' },
  6: { left: '50%', top: '76%' },
  7: { left: '68%', top: '70%' },
}

function BuilderPreview() {
  const phase = useDemoLoop(BUILDER_DURATIONS, 8)

  const nameFilled = phase >= 2
  const nameTyping = phase === 2
  const roleFilled = phase >= 4
  const roleTyping = phase === 4
  const expFilled = phase >= 5
  const templateFilled = phase >= 6
  const previewShown = phase >= 7
  const badgesShown = phase >= 8

  const activeField =
    phase === 1 || phase === 2 ? 'name'
    : phase === 3 || phase === 4 ? 'role'
    : phase === 5 ? 'exp'
    : phase === 6 ? 'template'
    : null

  const cursor = BUILDER_CURSOR[phase] || BUILDER_CURSOR[0]
  const badges = ['ATS-Friendly', 'Professional Tone', 'Project Bullets Added', 'Humanized Resume']

  return (
    <div className="card-preview card-preview--builder enh-demo">
      <div className="bld-form">
        <div className={`bld-field ${activeField === 'name' ? 'enh-box--active' : ''} ${nameFilled ? 'bld-field--filled' : ''}`}>
          <span className="bld-field__lbl">Name</span>
          <span className={`bld-field__val ${nameTyping ? 'bld-field__val--type' : ''}`}>
            {nameFilled ? 'Sarah Chen' : ''}
            {nameTyping && <span className="enh-caret" />}
          </span>
        </div>
        <div className={`bld-field ${activeField === 'role' ? 'enh-box--active' : ''} ${roleFilled ? 'bld-field--filled' : ''}`}>
          <span className="bld-field__lbl">Role</span>
          <span className={`bld-field__val ${roleTyping ? 'bld-field__val--type' : ''}`}>
            {roleFilled ? 'Software Engineer' : ''}
            {roleTyping && <span className="enh-caret" />}
          </span>
        </div>
        <div className="bld-field-row">
          <div className={`bld-field bld-field--sm ${activeField === 'exp' ? 'enh-box--active' : ''} ${expFilled ? 'bld-field--filled' : ''}`}>
            <span className="bld-field__lbl">Years</span>
            <span className="bld-field__val">{expFilled ? '5 yrs' : ''}</span>
          </div>
          <div className={`bld-field bld-field--sm ${activeField === 'template' ? 'enh-box--active' : ''} ${templateFilled ? 'bld-field--filled' : ''}`}>
            <span className="bld-field__lbl">Template</span>
            <span className="bld-field__val">{templateFilled ? 'Modern' : ''}</span>
          </div>
        </div>
      </div>

      <div className={`bld-preview mini-box mini-box--preview ${previewShown ? 'enh-box--glow bld-preview--live' : ''}`}>
        <span className="mini-label">Generated Resume</span>
        {previewShown ? (
          <div className="enh-appear"><BuilderWordDoc /></div>
        ) : (
          <div className="enh-empty" />
        )}
      </div>

      <DemoBadges show={badgesShown} badges={badges} />
      <DemoCursor
        left={cursor.left}
        top={cursor.top}
        clicking={phase === 5 || phase === 6}
        pointing={phase === 7 || phase === 8}
      />
    </div>
  )
}

function JDBasedPreview() {
  const phase = useDemoLoop(JD_DURATIONS, 7)

  const jdTyping = phase === 2
  const jdFilled = phase >= 2
  const jdComplete = phase >= 3
  const roleFilled = phase >= 3
  const yearsFilled = phase >= 4
  const keywordsShown = phase >= 5
  const previewShown = phase >= 6
  const badgesShown = phase >= 7

  const activeField =
    phase === 1 || phase === 2 ? 'jd'
    : phase === 3 ? 'role'
    : phase === 4 ? 'years'
    : null

  const cursor = JD_CURSOR[phase] || JD_CURSOR[0]
  const badges = ['JD Matched', 'Keywords Added', 'ATS Score Improved', 'Resume Generated']
  const keywords = ['Agile', 'Roadmap', 'KPIs', 'Go-to-Market', 'Stakeholders', 'SQL']

  return (
    <div className="card-preview card-preview--jd-card enh-demo">
      <div className={`mini-box mini-box--jd mini-box--full ${activeField === 'jd' ? 'enh-box--active' : ''}`}>
        <div className="mini-box__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
          <span>Paste JD</span>
        </div>
        <div className="mini-box__body mini-box__body--jd enh-scroll">
          {jdFilled ? (
            <div className="enh-jd">
              <div className={`enh-jd__line ${jdTyping ? 'enh-jd__line--type1' : ''}`} />
              <div className={`enh-jd__line ${jdTyping ? 'enh-jd__line--type2' : ''}`} />
              <div className={`enh-jd__line enh-jd__line--short ${jdTyping ? 'enh-jd__line--type3' : ''}`} />
              {jdComplete && <span className="mini-tag mini-tag--blue enh-appear">Senior PM • B2B SaaS</span>}
              {jdTyping && <span className="enh-caret" />}
            </div>
          ) : (
            <div className="enh-dropzone enh-dropzone--jd"><span>Paste job description…</span></div>
          )}
        </div>
      </div>

      <div className="bld-field-row">
        <div className={`bld-field bld-field--sm ${activeField === 'role' ? 'enh-box--active' : ''} ${roleFilled ? 'bld-field--filled' : ''}`}>
          <span className="bld-field__lbl">Role</span>
          <span className={`bld-field__val ${phase === 3 ? 'bld-field__val--type' : ''}`}>
            {roleFilled ? 'Product Manager' : ''}
            {phase === 3 && <span className="enh-caret" />}
          </span>
        </div>
        <div className={`bld-field bld-field--sm ${activeField === 'years' ? 'enh-box--active' : ''} ${yearsFilled ? 'bld-field--filled' : ''}`}>
          <span className="bld-field__lbl">Years</span>
          <span className="bld-field__val">{yearsFilled ? '7+' : ''}</span>
        </div>
      </div>

      <div className={`jd-keywords ${keywordsShown ? 'jd-keywords--show' : ''}`}>
        {keywords.map((kw, i) => (
          <span key={kw} className="mini-tag mini-tag--green jd-kw-chip" style={{ '--kw-delay': `${i * 80}ms` }}>
            {kw}
          </span>
        ))}
      </div>

      <div className={`bld-preview mini-box mini-box--preview mini-box--enhanced ${previewShown ? 'enh-box--glow' : ''}`}>
        <span className="mini-label mini-label--amber">Generated</span>
        {previewShown ? (
          <div className="enh-appear"><JDWordDoc /></div>
        ) : (
          <div className="enh-empty" />
        )}
      </div>

      <DemoBadges show={badgesShown} badges={badges} />
      <DemoCursor
        left={cursor.left}
        top={cursor.top}
        clicking={phase === 2}
        pointing={phase === 6 || phase === 7}
      />
    </div>
  )
}

const cards = [
  {
    id: 'resume-enhancer',
    path: '/services/resume-enhancer',
    title: 'Resume Enhancer',
    subtitle: 'Your Resume to Match JD Strongly',
    cta: 'Open Resume Enhancer',
    accent: 'green',
    Preview: EnhancerPreview,
  },
  {
    id: 'resume-builder',
    path: '/services/resume-builder',
    title: 'Resume Builder',
    subtitle: 'Build your resume with only your name and role — professional, ATS-friendly, humanized, practical, and project-involved bullets in every section.',
    cta: 'Build Resume',
    accent: 'blue',
    Preview: BuilderPreview,
  },
  {
    id: 'jd-tailored-resume',
    path: '/services/jd-tailored-resume',
    title: 'JD-Based Resume Builder',
    subtitle: 'Create any resume from a JD. If you have a JD but no resume, this is the right place. Add the JD and we will build a resume that strongly matches it.',
    cta: 'Build JD-Based Resume',
    accent: 'green',
    Preview: JDBasedPreview,
  },
]

export default function ServicesCards() {
  return (
    <section id="services" className="services-cards">
      <div className="container container--wide">
        <div className="section-header section-header--compact">
          <span className="section-label">Services</span>
          <h2 className="section-title">Choose Your Resume Solution</h2>
          <p className="section-desc">
            Live previews of each workflow — pick the tool that fits your goal.
          </p>
        </div>

        <div className="services-cards__grid">
          {cards.map((card) => (
            <article
              key={card.id}
              className={`service-card service-card--live service-card--${card.accent}`}
            >
              <div className="service-card__glass" />
              <div className="service-card__content">
                <header className="service-card__header">
                  <h3 className="service-card__title">{card.title}</h3>
                  <p className="service-card__subtitle">{card.subtitle}</p>
                </header>

                <div className="service-card__preview-wrap">
                  <card.Preview />
                </div>

                <Link to={card.path} className="btn btn--primary service-card__cta">
                  {card.cta}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export { cards as services }
