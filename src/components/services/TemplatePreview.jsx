import { useLayoutEffect, useRef } from 'react'
import DocxViewer from './DocxViewer'

/** Rich fictional preview content (resume.io–style gallery cards). */
const DUMMY = {
  name: 'Alex Morgan',
  title: 'Business Analyst',
  contact: 'Austin, TX  |  (555) 123-4567  |  alex.morgan@email.com',
  contactLinkedIn: 'Austin, TX  |  alex.morgan@email.com  |  linkedin.com/in/alexmorgan',
  contactPhoneEmail: '(555) 123-4567  |  alex.morgan@email.com',
  summary: [
    'Business analyst with 5+ years translating stakeholder needs into requirements, data models, and delivery plans across SaaS analytics programs.',
    'Skilled in SQL, Power BI, and Agile collaboration with product and engineering partners to ship measurable outcomes.',
  ],
  skillCats: [
    { label: 'Analysis', items: 'SQL, Power BI, Excel, Tableau, Requirements' },
    { label: 'Delivery', items: 'Jira, Confluence, Agile, UAT, Stakeholder Mgmt' },
    { label: 'Data', items: 'Python, ETL, Data Validation, Reporting' },
  ],
  jobs: [
    {
      title: 'Business Analyst',
      company: 'Northstar Tech',
      loc: 'Austin, TX',
      dates: '2022 – Present',
      bullets: [
        'Owned requirements for a customer insights dashboard used by sales and success teams across quarterly releases.',
        'Facilitated discovery with product and domain leads to keep delivery tied to adoption and revenue goals.',
        'Designed process maps and data contracts that reduced reporting defects for operations partners.',
        'Partnered with engineering on acceptance criteria and release readiness for analytics features.',
      ],
    },
    {
      title: 'Junior Analyst',
      company: 'BrightPath Inc',
      loc: 'Dallas, TX',
      dates: '2020 – 2022',
      bullets: [
        'Built recurring SQL and Excel KPI packages for finance and operations stakeholders.',
        'Documented onboarding and billing workflows used by cross-functional delivery teams.',
        'Supported sprint planning and backlog grooming for high-impact reporting stories.',
      ],
    },
    {
      title: 'Operations Intern',
      company: 'Riverline Group',
      loc: 'Houston, TX',
      dates: '2019 – 2020',
      bullets: [
        'Assisted analysts with data cleanup, spreadsheet models, and weekly status reporting.',
      ],
    },
  ],
  education: {
    degree: 'B.S. in Information Systems',
    school: 'State University',
    dates: '2016 – 2020',
  },
}

const PAGE_WIDTH = 440

function fontStackFor(template) {
  if (template.previewFont) return template.previewFont
  const id = template.id || ''
  if (id.includes('serif') || id === 'navy-executive') {
    return 'Georgia, "Times New Roman", Times, serif'
  }
  if (id.includes('ats') || id.includes('technical') || id === 'jd-classic') {
    return 'Arial, Helvetica, sans-serif'
  }
  return 'Calibri, "Segoe UI", Candara, sans-serif'
}

function Section({ title, accent, headingStyle, children }) {
  const isColon = headingStyle === 'underline-colon'
  return (
    <div className="tpl-preview__section">
      <div
        className={`tpl-preview__heading ${isColon ? 'is-colon' : ''}`}
        style={{ color: `#${accent}`, borderColor: `#${accent}` }}
      >
        {isColon ? `${title}:` : title}
      </div>
      {children}
    </div>
  )
}

function JobBlock({ job, layout, accent, showResponsibilities }) {
  const bullets = (
    <>
      {showResponsibilities && (
        <div className="tpl-preview__resp-label">Responsibilities:</div>
      )}
      <ul className="tpl-preview__bullets">
        {job.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </>
  )

  if (layout === 'company-first') {
    return (
      <div className="tpl-preview__job">
        <div className="tpl-preview__job-row">
          <strong>{job.company} – {job.loc}</strong>
          <span>{job.dates}</span>
        </div>
        <em className="tpl-preview__job-title">{job.title}</em>
        {bullets}
      </div>
    )
  }

  if (layout === 'title-company') {
    return (
      <div className="tpl-preview__job">
        <div className="tpl-preview__job-row">
          <strong>{job.title} | {job.company}</strong>
          <span>{job.dates}</span>
        </div>
        {bullets}
      </div>
    )
  }

  if (layout === 'title-company-split') {
    return (
      <div className="tpl-preview__job">
        <div className="tpl-preview__job-row">
          <strong>{job.title}</strong>
          <span>{job.dates}</span>
        </div>
        <div className="tpl-preview__job-row">
          <strong style={{ color: `#${accent}` }}>{job.company}</strong>
          <span>{job.loc}</span>
        </div>
        {bullets}
      </div>
    )
  }

  return (
    <div className="tpl-preview__job">
      <div className="tpl-preview__job-row">
        <strong>{job.title}</strong>
        <span style={{ color: `#${accent}` }}>{job.dates}</span>
      </div>
      <em className="tpl-preview__job-sub">{job.company} | {job.loc}</em>
      {bullets}
    </div>
  )
}

function fitPageToBox(boxEl, pageEl, spacerEl) {
  if (!boxEl || !pageEl) return
  pageEl.style.transform = 'none'
  pageEl.style.left = '0'
  const availW = boxEl.clientWidth
  if (availW <= 0) return

  const naturalW = pageEl.offsetWidth || PAGE_WIDTH
  const naturalH = pageEl.scrollHeight
  if (naturalW <= 0 || naturalH <= 0) return

  // Fit full page width (no side crop); height scrolls inside the card.
  const scale = availW / naturalW
  pageEl.style.left = '0'
  pageEl.style.transform = `scale(${scale})`
  pageEl.style.transformOrigin = 'top left'
  if (spacerEl) {
    spacerEl.style.height = `${Math.ceil(naturalH * scale)}px`
  }
}

function MockupPreview({ template }) {
  const boxRef = useRef(null)
  const pageRef = useRef(null)
  const spacerRef = useRef(null)
  const accent = template.accent || '1E40AF'
  const isBanner = template.headerStyle === 'banner'
  const showTitle = template.showTitle
  const titleBelow = template.titleBelowContact
  const layout = template.experienceLayout || 'title-dates'
  const fontFamily = fontStackFor(template)
  const headingStyle = template.headingStyle
  const pageBorder = template.pageBorder
  const skillsAsBullets = template.skillsAsBullets
  const showResponsibilities = template.showResponsibilitiesLabel

  useLayoutEffect(() => {
    const box = boxRef.current
    const page = pageRef.current
    const spacer = spacerRef.current
    if (!box || !page) return undefined

    const run = () => fitPageToBox(box, page, spacer)
    run()
    const ro = new ResizeObserver(run)
    ro.observe(box)
    return () => ro.disconnect()
  }, [template.id])

  let contactLine = DUMMY.contact
  if (template.contactStyle === 'phone-email') contactLine = DUMMY.contactPhoneEmail
  else if (template.id === 'modern-data' || template.id === 'indigo-modern') {
    contactLine = DUMMY.contactLinkedIn
  }

  return (
    <div ref={boxRef} className="tpl-preview tpl-preview--flow" aria-hidden="true" spellCheck={false}>
      <div ref={spacerRef} className="tpl-preview__spacer" aria-hidden="true" />
      <div
        ref={pageRef}
        className={`tpl-preview__page ${template.compact ? 'is-compact' : ''} ${pageBorder ? 'has-border' : ''}`}
        style={{ fontFamily, width: PAGE_WIDTH }}
      >
        {isBanner ? (
          <div className="tpl-preview__banner" style={{ background: `#${accent}` }}>
            <div className="tpl-preview__name is-light">{DUMMY.name.toUpperCase()}</div>
            {showTitle && <div className="tpl-preview__role is-light">{DUMMY.title}</div>}
            <div className="tpl-preview__contact is-light">{DUMMY.contactLinkedIn}</div>
          </div>
        ) : (
          <div className="tpl-preview__header">
            <div className="tpl-preview__name" style={{ color: `#${accent}` }}>
              {DUMMY.name.toUpperCase()}
            </div>
            {showTitle && !titleBelow && (
              <div className="tpl-preview__role">{DUMMY.title}</div>
            )}
            <div className="tpl-preview__contact">{contactLine}</div>
            {showTitle && titleBelow && (
              <div className="tpl-preview__role is-italic">{DUMMY.title}</div>
            )}
          </div>
        )}

        <div className="tpl-preview__body">
          <Section title="SUMMARY" accent={accent} headingStyle={headingStyle}>
            {DUMMY.summary.map((line) => (
              <p key={line} className="tpl-preview__para">{line}</p>
            ))}
          </Section>

          <Section title="TECHNICAL SKILLS" accent={accent} headingStyle={headingStyle}>
            {skillsAsBullets ? (
              <ul className="tpl-preview__bullets">
                {DUMMY.skillCats.map((cat) => (
                  <li key={cat.label}>
                    <strong style={{ color: `#${accent}` }}>{cat.label}:</strong> {cat.items}
                  </li>
                ))}
              </ul>
            ) : (
              DUMMY.skillCats.map((cat) => (
                <div key={cat.label} className="tpl-preview__skill">
                  <strong style={{ color: `#${accent}` }}>{cat.label}:</strong> {cat.items}
                </div>
              ))
            )}
          </Section>

          <Section title="EXPERIENCE" accent={accent} headingStyle={headingStyle}>
            {DUMMY.jobs.map((job) => (
              <JobBlock
                key={job.company}
                job={job}
                layout={layout}
                accent={accent}
                showResponsibilities={showResponsibilities}
              />
            ))}
          </Section>

          <Section title="EDUCATION" accent={accent} headingStyle={headingStyle}>
            <div className="tpl-preview__job-row">
              <strong>{DUMMY.education.degree}</strong>
              <span>{DUMMY.education.dates}</span>
            </div>
            <div className="tpl-preview__edu">{DUMMY.education.school}</div>
          </Section>
        </div>
      </div>
    </div>
  )
}

/**
 * Template picker preview.
 * @param {'card'|'live'} [mode] — card = CSS mockup; live = admin/demo DOCX/PDF when available
 */
export default function TemplatePreview({
  template,
  sampleBlob = null,
  sampleFileType = null,
  sampleUrl = null,
  mode = 'card',
}) {
  const wantLive = mode === 'live'

  if (wantLive && sampleBlob && sampleFileType === 'docx') {
    return (
      <div className="tpl-preview tpl-preview--live tpl-preview--flow" aria-hidden="true" spellCheck={false}>
        <DocxViewer
          blob={sampleBlob}
          className="tpl-preview__docx"
          emptyLabel="Loading sample…"
          previewMode="card"
        />
      </div>
    )
  }

  if (wantLive && sampleFileType === 'pdf' && sampleUrl) {
    return (
      <div className="tpl-preview tpl-preview--live tpl-preview--flow" aria-hidden="true">
        <iframe
          title={`${template.name} sample`}
          className="tpl-preview__pdf"
          src={`${sampleUrl}#toolbar=0&navpanes=0&scrollbar=0`}
        />
      </div>
    )
  }

  return <MockupPreview template={template} />
}
