import { Link } from 'react-router-dom'
import BrandName from './BrandName'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <Link to="/" className="navbar__brand">
            <span className="navbar__logo">
              <Logo size={38} />
            </span>
            <span className="navbar__name"><BrandName /></span>
          </Link>
          <p className="footer__tagline">
            AI-powered resume automation, enhancement, and building — built for modern professionals.
          </p>
        </div>

        <div className="footer__links">
          <div className="footer__col">
            <h4>Services</h4>
            <Link to="/services/resume-enhancer">Resume Enhancer</Link>
            <Link to="/services/resume-builder">Resume Builder</Link>
            <Link to="/services/jd-tailored-resume">JD-Tailored Builder</Link>
          </div>
          <div className="footer__col">
            <h4>Quick Links</h4>
            <Link to="/#how-it-works">How It Works</Link>
            <Link to="/#pricing">Pricing</Link>
            <Link to="/#contact">Contact</Link>
          </div>
          <div className="footer__col">
            <h4>Contact</h4>
            <a href="mailto:hello@resumeflow.io">hello@resumeflow.io</a>
            <span className="footer__text">San Francisco, CA</span>
          </div>
        </div>
      </div>

      <div className="footer__bottom">
        <div className="container footer__bottom-inner">
          <p>&copy; {new Date().getFullYear()} <BrandName />. All rights reserved.</p>
          <div className="footer__social">
            <a href="/" aria-label="Twitter">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a href="/" aria-label="LinkedIn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
