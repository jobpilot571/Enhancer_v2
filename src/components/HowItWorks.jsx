const steps = [
  {
    num: '01',
    title: 'Upload Resume + JD',
    desc: 'Drop your existing resume and paste or upload the job description to align your content with the role.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'AI Resume Enhancement',
    desc: 'Our engine analyzes ATS requirements, adds missing skills, rewrites bullets, and optimizes every section for maximum impact.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Download ATS Optimized Resume',
    desc: 'Preview side-by-side comparisons, review your ATS score, and export a polished resume ready to land your dream role.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works">
      <div className="container">
        <div className="section-header">
          <span className="section-label">How It Works</span>
          <h2 className="section-title">Three Steps to a Perfect Resume</h2>
          <p className="section-desc">
            From upload to interview-ready — our streamlined process handles the heavy lifting
            so you can focus on landing the role.
          </p>
        </div>

        <div className="steps">
          {steps.map((step, i) => (
            <div key={step.num} className="step">
              {i < steps.length - 1 && <div className="step__connector" />}
              <div className="step__icon">{step.icon}</div>
              <span className="step__num">{step.num}</span>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
