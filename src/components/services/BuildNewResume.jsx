import FormField from './FormField'

const templates = ['Modern Professional', 'Classic Executive', 'Creative Minimal', 'Tech Focused']

export default function BuildNewResume() {
  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">02</span>
        <div>
          <h3 className="service-block__title">Professional Resume Builder</h3>
          <p className="service-block__desc">
            Create a professional resume from scratch with our guided builder and premium templates.
          </p>
        </div>
      </div>

      <div className="form-card">
        <div className="form-grid">
          <FormField label="Name" placeholder="Full name" />
          <FormField label="Primary Role" placeholder="e.g. Software Engineer" />
          <FormField label="Role 2" placeholder="Secondary role (optional)" />
          <FormField label="Role 3" placeholder="Third role (optional)" />
          <FormField label="Years of Experience" type="number" placeholder="e.g. 5" />
          <FormField label="Number of Companies" type="number" placeholder="e.g. 3" />
          <FormField label="Experience Dates" placeholder="e.g. 2018 – Present" />
          <FormField label="Number of Pages" type="number" placeholder="1 or 2" />
          <FormField label="Resume Template" placeholder="Choose a template" options={templates} />
        </div>
        <div className="form-cta">
          <button type="button" className="btn btn--primary btn--xl">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            Build Resume
          </button>
        </div>
      </div>
    </div>
  )
}
