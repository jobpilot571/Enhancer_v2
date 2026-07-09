export function ResumeDocumentPreview({ variant = 'original', enhanced = false }) {
  const isEnhanced = variant === 'enhanced' || enhanced

  return (
    <div className={`doc-preview ${isEnhanced ? 'doc-preview--enhanced' : ''}`}>
      <div className="doc-preview__page">
        <header className="doc-preview__header">
          <h1 className="doc-preview__name">Alexandra Morgan</h1>
          <p className="doc-preview__title">
            {isEnhanced ? 'Senior Product Manager | SaaS & B2B Growth' : 'Product Manager'}
          </p>
          <div className="doc-preview__contact">
            <span>alexandra.morgan@email.com</span>
            <span className="doc-preview__sep">|</span>
            <span>(415) 555-0192</span>
            <span className="doc-preview__sep">|</span>
            <span>San Francisco, CA</span>
            <span className="doc-preview__sep">|</span>
            <span>linkedin.com/in/amorgan</span>
          </div>
        </header>

        <section className="doc-preview__section">
          <h2 className="doc-preview__section-title">PROFESSIONAL SUMMARY</h2>
          <div className="doc-preview__rule" />
          <p className="doc-preview__text">
            {isEnhanced ? (
              <>
                Results-driven Senior Product Manager with <mark className="doc-preview__highlight">8+ years</mark> of
                experience leading cross-functional teams to deliver{' '}
                <mark className="doc-preview__highlight">SaaS products</mark> generating{' '}
                <mark className="doc-preview__highlight">$12M+ ARR</mark>. Expert in agile methodologies,
                user-centric design, and data-driven decision making. Proven track record of increasing
                user retention by <mark className="doc-preview__highlight">35%</mark> and reducing churn by{' '}
                <mark className="doc-preview__highlight">22%</mark> through strategic product roadmaps.
              </>
            ) : (
              <>
                Product Manager with experience in SaaS and B2B products. Skilled in leading teams
                and delivering products. Good at communication and project management.
              </>
            )}
          </p>
        </section>

        <section className="doc-preview__section">
          <h2 className="doc-preview__section-title">PROFESSIONAL EXPERIENCE</h2>
          <div className="doc-preview__rule" />
          <div className="doc-preview__job">
            <div className="doc-preview__job-header">
              <strong>{isEnhanced ? 'TechVentures Inc.' : 'TechVentures'}</strong>
              <span>San Francisco, CA</span>
            </div>
            <div className="doc-preview__job-sub">
              <em>{isEnhanced ? 'Senior Product Manager' : 'Product Manager'}</em>
              <span>Jan 2021 – Present</span>
            </div>
            <ul className="doc-preview__bullets">
              {isEnhanced ? (
                <>
                  <li>
                    Led product strategy for flagship SaaS platform serving{' '}
                    <mark className="doc-preview__highlight">50,000+ users</mark>, achieving{' '}
                    <mark className="doc-preview__highlight">40% YoY revenue growth</mark>
                  </li>
                  <li>
                    Managed cross-functional team of 12 engineers, designers, and analysts to deliver
                    6 major feature releases on schedule
                  </li>
                  <li>
                    Implemented A/B testing framework that improved conversion rates by{' '}
                    <mark className="doc-preview__highlight">28%</mark>
                  </li>
                  <li>
                    Defined and executed product roadmap aligned with company OKRs, resulting in{' '}
                    <mark className="doc-preview__highlight">NPS score increase from 42 to 67</mark>
                  </li>
                </>
              ) : (
                <>
                  <li>Managed product development for SaaS platform</li>
                  <li>Worked with engineering team on features</li>
                  <li>Helped improve user experience</li>
                </>
              )}
            </ul>
          </div>

          <div className="doc-preview__job">
            <div className="doc-preview__job-header">
              <strong>InnovateLabs</strong>
              <span>Austin, TX</span>
            </div>
            <div className="doc-preview__job-sub">
              <em>Associate Product Manager</em>
              <span>Mar 2018 – Dec 2020</span>
            </div>
            <ul className="doc-preview__bullets">
              {isEnhanced ? (
                <>
                  <li>
                    Drove go-to-market strategy for 3 product launches generating{' '}
                    <mark className="doc-preview__highlight">$2.4M in first-year revenue</mark>
                  </li>
                  <li>
                    Conducted 50+ user interviews and usability tests to inform product decisions
                  </li>
                  <li>
                    Collaborated with sales team to reduce deal cycle time by{' '}
                    <mark className="doc-preview__highlight">18%</mark>
                  </li>
                </>
              ) : (
                <>
                  <li>Helped launch new products</li>
                  <li>Conducted user research</li>
                  <li>Worked with sales on deals</li>
                </>
              )}
            </ul>
          </div>
        </section>

        <section className="doc-preview__section">
          <h2 className="doc-preview__section-title">SKILLS</h2>
          <div className="doc-preview__rule" />
          <p className="doc-preview__skills-line">
            {isEnhanced ? (
              <>
                <mark className="doc-preview__highlight">Product Strategy</mark> • Agile/Scrum • Jira •
                Figma • SQL • A/B Testing • <mark className="doc-preview__highlight">Roadmapping</mark> •
                User Research • <mark className="doc-preview__highlight">Stakeholder Management</mark> •
                Data Analytics • OKRs • <mark className="doc-preview__highlight">Go-to-Market</mark>
              </>
            ) : (
              <>Product Management • Agile • Jira • Communication</>
            )}
          </p>
        </section>

        <section className="doc-preview__section">
          <h2 className="doc-preview__section-title">PROJECTS</h2>
          <div className="doc-preview__rule" />
          <div className="doc-preview__job">
            <div className="doc-preview__job-header">
              <strong>Customer Portal Redesign</strong>
            </div>
            <p className="doc-preview__text">
              {isEnhanced
                ? 'Led end-to-end redesign of customer portal, reducing support tickets by 45% and increasing self-service adoption by 60%.'
                : 'Redesigned customer portal to improve user experience.'}
            </p>
          </div>
        </section>

        <section className="doc-preview__section">
          <h2 className="doc-preview__section-title">EDUCATION</h2>
          <div className="doc-preview__rule" />
          <div className="doc-preview__job-header">
            <strong>MBA, Business Administration</strong>
            <span>2016 – 2018</span>
          </div>
          <p className="doc-preview__text doc-preview__text--muted">Stanford Graduate School of Business</p>
        </section>
      </div>
    </div>
  )
}

export function JDDocumentPreview() {
  return (
    <div className="doc-preview doc-preview--jd">
      <div className="doc-preview__page doc-preview__page--jd">
        <div className="doc-preview__jd-header">
          <span className="doc-preview__jd-badge">Job Description</span>
          <h2 className="doc-preview__jd-title">Senior Product Manager</h2>
          <p className="doc-preview__jd-company">CloudScale Technologies • Remote (US)</p>
        </div>

        <section className="doc-preview__section">
          <h3 className="doc-preview__jd-section">About the Role</h3>
          <p className="doc-preview__text">
            We are seeking an experienced Senior Product Manager to lead our core SaaS platform.
            You will define product vision, prioritize the roadmap, and collaborate with engineering,
            design, and go-to-market teams to deliver exceptional user experiences.
          </p>
        </section>

        <section className="doc-preview__section">
          <h3 className="doc-preview__jd-section">Responsibilities</h3>
          <ul className="doc-preview__bullets">
            <li>Define and execute product strategy aligned with business objectives</li>
            <li>Lead cross-functional teams through the full product lifecycle</li>
            <li>Conduct market research and competitive analysis</li>
            <li>Develop and track KPIs, OKRs, and success metrics</li>
            <li>Partner with sales and customer success on GTM initiatives</li>
            <li>Manage product backlog and sprint planning in Agile environment</li>
          </ul>
        </section>

        <section className="doc-preview__section">
          <h3 className="doc-preview__jd-section">Requirements</h3>
          <ul className="doc-preview__bullets">
            <li>7+ years of product management experience in B2B SaaS</li>
            <li>Proven track record of launching and scaling products</li>
            <li>Strong analytical skills with SQL and data visualization tools</li>
            <li>Experience with Agile/Scrum methodologies</li>
            <li>Excellent stakeholder management and communication skills</li>
            <li>MBA or equivalent experience preferred</li>
          </ul>
        </section>

        <section className="doc-preview__section">
          <h3 className="doc-preview__jd-section">Nice to Have</h3>
          <ul className="doc-preview__bullets">
            <li>Experience with A/B testing and experimentation platforms</li>
            <li>Background in enterprise software or developer tools</li>
            <li>Familiarity with Figma and design collaboration workflows</li>
          </ul>
        </section>

        <section className="doc-preview__section">
          <h3 className="doc-preview__jd-section">Benefits</h3>
          <p className="doc-preview__text">
            Competitive salary ($160K–$200K), equity, full health coverage, unlimited PTO,
            remote-first culture, and $2,000 annual learning stipend.
          </p>
        </section>
      </div>
    </div>
  )
}

export function UploadBox({ label, sublabel, icon, children, widthClass }) {
  return (
    <div className={`upload-box ${widthClass || ''}`}>
      <div className="upload-box__header">
        <div className="upload-box__label-group">
          <span className="upload-box__icon">{icon}</span>
          <div>
            <h4 className="upload-box__label">{label}</h4>
            {sublabel && <p className="upload-box__sublabel">{sublabel}</p>}
          </div>
        </div>
        <button type="button" className="upload-box__action">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload
        </button>
      </div>
      <div className="upload-box__content">{children}</div>
    </div>
  )
}
