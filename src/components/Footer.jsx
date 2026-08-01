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
            <Link to="/services/jd-tailored-resume">JD-Tailored Resume Builder</Link>
          </div>
          <div className="footer__col">
            <h4>Quick Links</h4>
            <Link to="/#how-it-works">How It Works</Link>
            <Link to="/#pricing">Pricing</Link>
            <Link to="/#contact">Contact</Link>
          </div>
          <div className="footer__col">
            <h4>Contact</h4>
            <a href="mailto:shiva@jobpilot.solutions">shiva@jobpilot.solutions</a>
          </div>
        </div>
      </div>

      <div className="footer__bottom">
        <div className="container footer__bottom-inner">
          <p>&copy; {new Date().getFullYear()} <BrandName />. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
