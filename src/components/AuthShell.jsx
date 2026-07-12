import { Link } from 'react-router-dom'
import BrandName from './BrandName'
import Logo from './Logo'

const BENEFITS = [
  '10 resume enhancements every month',
  '5 resume builds & 5 JD-tailored resumes',
  'ATS-ready DOCX exports',
]

export default function AuthShell({ children, eyebrow, title, desc }) {
  return (
    <div className="auth-shell">
      <div className="auth-shell__panel auth-shell__panel--brand">
        <Link to="/" className="auth-shell__brand">
          <Logo size={42} />
          <span><BrandName /></span>
        </Link>
        <div className="auth-shell__hero">
          <p className="auth-shell__eyebrow">{eyebrow}</p>
          <h1 className="auth-shell__headline">{title}</h1>
          <p className="auth-shell__lede">{desc}</p>
          <ul className="auth-shell__benefits">
            {BENEFITS.map((item) => (
              <li key={item}>
                <span className="auth-shell__check" aria-hidden="true">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-shell__foot">AI resume automation for faster applications</p>
      </div>

      <div className="auth-shell__panel auth-shell__panel--form">
        <div className="auth-shell__form-wrap">
          <Link to="/" className="auth-shell__brand auth-shell__brand--mobile">
            <Logo size={34} />
            <span><BrandName /></span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}
