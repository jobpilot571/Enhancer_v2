export default function Contact() {
  return (
    <section id="contact" className="contact">
      <div className="container">
        <div className="contact__inner">
          <div className="contact__info">
            <span className="section-label">Contact</span>
            <h2 className="section-title">Work With a Resume Specialist</h2>
            <p className="section-desc contact__lead">
              If you want to build your resume with senior experts and work one-to-one with a
              professional resume specialist, fill out your details below. Our team will review
              your request and get back to you.
            </p>
            <div className="contact__details">
              <div className="contact__detail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <div>
                  <strong>Email</strong>
                  <span>hello@resumeflow.io</span>
                </div>
              </div>
              <div className="contact__detail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <div>
                  <strong>Office</strong>
                  <span>San Francisco, CA</span>
                </div>
              </div>
            </div>
          </div>

          <form className="contact__form" onSubmit={(e) => e.preventDefault()}>
            <div className="form-grid form-grid--2">
              <div className="form-field">
                <label className="form-field__label">First Name</label>
                <input type="text" className="form-field__input" placeholder="John" />
              </div>
              <div className="form-field">
                <label className="form-field__label">Last Name</label>
                <input type="text" className="form-field__input" placeholder="Doe" />
              </div>
            </div>
            <div className="form-field">
              <label className="form-field__label">Email</label>
              <input type="email" className="form-field__input" placeholder="john@example.com" />
            </div>
            <div className="form-field">
              <label className="form-field__label">Phone (Optional)</label>
              <input type="tel" className="form-field__input" placeholder="+1 (555) 000-0000" />
            </div>
            <div className="form-field">
              <label className="form-field__label">Tell Us About Your Goals</label>
              <textarea
                className="form-field__input form-field__textarea"
                rows={5}
                placeholder="Share your target role, experience level, and what you need help with..."
              />
            </div>
            <button type="submit" className="btn btn--primary btn--lg btn--full">
              Request Specialist Consultation
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
