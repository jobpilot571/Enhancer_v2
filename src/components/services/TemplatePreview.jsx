import DocxViewer from './DocxViewer'

const DUMMY = {
  name: 'Alex Morgan',
  title: 'Business Analyst',
  contact: 'Austin, TX  |  (555) 123-4567  |  alex.morgan@email.com',
  contactLinkedIn: 'Austin, TX  |  alex.morgan@email.com  |  linkedin.com/in/alexmorgan',
  summaryLines: 3,
  skillCats: [
    { label: 'Analysis', items: 'SQL, Power BI, Excel' },
    { label: 'Tools', items: 'Jira, Confluence, Agile' },
    { label: 'Data', items: 'Python, Tableau, ETL' },
  ],
  jobs: [
    { title: 'Business Analyst', company: 'Northstar Tech', loc: 'Austin, TX', dates: '2022 – Present' },
    { title: 'Junior Analyst', company: 'BrightPath Inc', loc: 'Dallas, TX', dates: '2020 – 2022' },
  ],
}

function Lines({ count = 3, short }) {
  return (
    <div className="tpl-preview__lines">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`tpl-preview__line ${short && i === count - 1 ? 'is-short' : ''}`}
        />
      ))}
    </div>
  )
}

function Section({ title, accent, children }) {
  return (
    <div className="tpl-preview__section">
      <div className="tpl-preview__heading" style={{ color: `#${accent}`, borderColor: `#${accent}` }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function JobBlock({ job, layout, accent }) {
  if (layout === 'company-first') {
    return (
      <div className="tpl-preview__job">
        <div className="tpl-preview__job-row">
          <strong>{job.company} – {job.loc}</strong>
          <span>{job.dates}</span>
        </div>
        <em className="tpl-preview__job-title">{job.title}</em>
        <Lines count={3} short />
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
        <Lines count={3} short />
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
        <Lines count={3} short />
      </div>
    )
  }

  // title-dates default
  return (
    <div className="tpl-preview__job">
      <div className="tpl-preview__job-row">
        <strong>{job.title}</strong>
        <span style={{ color: `#${accent}` }}>{job.dates}</span>
      </div>
      <em className="tpl-preview__job-sub">{job.company} | {job.loc}</em>
      <Lines count={3} short />
    </div>
  )
}

function MockupPreview({ template }) {
  const accent = template.accent || '1E40AF'
  const isBanner = template.headerStyle === 'banner'
  const showTitle = template.showTitle
  const titleBelow = template.titleBelowContact
  const layout = template.experienceLayout || 'title-dates'

  return (
    <div className={`tpl-preview ${template.compact ? 'is-compact' : ''}`} aria-hidden="true">
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
          <div className="tpl-preview__contact">
            {template.id === 'modern-data' || template.id === 'indigo-modern'
              ? DUMMY.contactLinkedIn
              : DUMMY.contact}
          </div>
          {showTitle && titleBelow && (
            <div className="tpl-preview__role is-italic">{DUMMY.title}</div>
          )}
        </div>
      )}

      <div className="tpl-preview__body">
        <Section title="SUMMARY" accent={accent}>
          <Lines count={DUMMY.summaryLines} short />
        </Section>

        <Section title="TECHNICAL SKILLS" accent={accent}>
          {DUMMY.skillCats.map((cat) => (
            <div key={cat.label} className="tpl-preview__skill">
              <strong style={{ color: `#${accent}` }}>{cat.label}:</strong> {cat.items}
            </div>
          ))}
        </Section>

        <Section title="EXPERIENCE" accent={accent}>
          {DUMMY.jobs.map((job) => (
            <JobBlock key={job.company} job={job} layout={layout} accent={accent} />
          ))}
        </Section>

        <Section title="EDUCATION" accent={accent}>
          <div className="tpl-preview__job-row">
            <strong>B.S. in Information Systems</strong>
            <span>2016 – 2020</span>
          </div>
          <div className="tpl-preview__edu">State University</div>
        </Section>
      </div>
    </div>
  )
}

/**
 * Template picker preview — prefers the admin-uploaded sample DOCX/PDF
 * (already anonymized on the server). Falls back to CSS mockup when no sample.
 */
export default function TemplatePreview({
  template,
  sampleBlob = null,
  sampleFileType = null,
  sampleUrl = null,
}) {
  if (sampleBlob && sampleFileType === 'docx') {
    return (
      <div className="tpl-preview tpl-preview--live" aria-hidden="true">
        <DocxViewer
          blob={sampleBlob}
          className="tpl-preview__docx"
          emptyLabel="Loading sample…"
        />
      </div>
    )
  }

  if (sampleFileType === 'pdf' && sampleUrl) {
    return (
      <div className="tpl-preview tpl-preview--live" aria-hidden="true">
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
