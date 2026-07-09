import { Link } from 'react-router-dom'

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
            Automate, Enhance &amp; Build
            <span className="hero__title-accent"> Resumes That Win Interviews</span>
          </h1>
          <p className="hero__subtitle">
            JoBPilot.AI transforms your career documents with intelligent automation.
            Upload your resume, match it to any job description, and get ATS-optimized
            results — or build a brand-new resume from scratch in minutes.
          </p>
          <div className="hero__actions">
            <Link to="/#services" className="btn btn--primary btn--lg">
              Get Started Free
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
          <div className="hero__card hero__card--back">
            <div className="hero__card-header">
              <div className="hero__card-dots">
                <span /><span /><span />
              </div>
              <span>Original Resume</span>
            </div>
            <div className="hero__mini-doc">
              <div className="hero__mini-name">Sarah Chen</div>
              <div className="hero__mini-role">Software Engineer</div>
              <div className="hero__mini-line hero__mini-line--short" />
              <div className="hero__mini-line" />
              <div className="hero__mini-line hero__mini-line--med" />
            </div>
          </div>

          <div className="hero__card hero__card--front">
            <div className="hero__card-header">
              <div className="hero__card-dots">
                <span /><span /><span />
              </div>
              <span className="hero__card-badge">Enhanced</span>
            </div>
            <div className="hero__mini-doc hero__mini-doc--enhanced">
              <div className="hero__mini-name">Sarah Chen</div>
              <div className="hero__mini-role">Senior Software Engineer</div>
              <div className="hero__score">
                <div className="hero__score-ring">
                  <svg viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831
                         a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831
                         a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="url(#scoreGrad)"
                      strokeWidth="3"
                      strokeDasharray="92, 100"
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#16c784" />
                        <stop offset="100%" stopColor="#22d3ee" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span>92</span>
                </div>
                <div>
                  <strong>ATS Score</strong>
                  <small>+34 from original</small>
                </div>
              </div>
              <div className="hero__skills">
                <span>React</span>
                <span>TypeScript</span>
                <span>AWS</span>
                <span>+12 more</span>
              </div>
            </div>
          </div>

          <div className="hero__float hero__float--1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16c784" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Skills Matched
          </div>
          <div className="hero__float hero__float--2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            JD Aligned
          </div>
        </div>
      </div>
    </section>
  )
}
