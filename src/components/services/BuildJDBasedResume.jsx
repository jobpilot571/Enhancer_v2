import FormField from './FormField'

const templates = ['Modern Professional', 'Classic Executive', 'Creative Minimal', 'Tech Focused']

export default function BuildJDBasedResume() {
  return (
    <div className="service-block">
      <div className="service-block__header">
        <span className="service-block__num">03</span>
        <div>
          <h3 className="service-block__title">JD-Tailored Resume Builder</h3>
          <p className="service-block__desc">
            Tailor a resume specifically to a job description and role requirements with intelligent content generation.
          </p>
        </div>
      </div>

      <div className="form-card">
        <div className="form-grid">
          <FormField label="Job Role" placeholder="e.g. Senior Product Manager" />
          <FormField label="Candidate Name" placeholder="Full name" />
          <FormField label="Years of Experience" type="number" placeholder="e.g. 7" />
          <FormField label="Start Year" type="number" placeholder="e.g. 2016" />
          <FormField label="End Year" type="number" placeholder="e.g. 2024" />
          <FormField label="Number of Companies" type="number" placeholder="e.g. 4" />
          <FormField label="Company Names (Optional)" placeholder="Comma-separated names" />
          <FormField label="Company Locations (Optional)" placeholder="e.g. SF, Austin, NYC" />
          <FormField label="Companies in USA" type="number" placeholder="e.g. 3" />
          <FormField label="Companies in India" type="number" placeholder="e.g. 1" />
          <FormField label="Resume Pages" type="number" placeholder="1 or 2" />
          <FormField label="Template" placeholder="Choose a template" options={templates} />
        </div>

        <div className="form-field form-field--full">
          <label className="form-field__label">Upload / Paste Job Description</label>
          <div className="jd-input-area">
            <textarea
              className="form-field__input form-field__textarea jd-input-area__text"
              rows={6}
              placeholder="Paste the full job description here, or upload a JD file..."
            />
            <button type="button" className="jd-input-area__upload">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload JD File
            </button>
          </div>
        </div>

        <div className="form-cta">
          <button type="button" className="btn btn--primary btn--xl">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Build JD-Based Resume
          </button>
        </div>
      </div>
    </div>
  )
}
