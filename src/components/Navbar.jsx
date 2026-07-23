import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import BrandName from './BrandName'
import Logo from './Logo'
import { useAuth } from '../context/AuthContext'

const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'How It Works', to: '/#how-it-works' },
  { label: 'Pricing', to: '/#pricing' },
  { label: 'Contact', to: '/#contact' },
]

const serviceLinks = [
  { label: 'Resume Enhancer', to: '/services/resume-enhancer' },
  { label: 'Resume Builder', to: '/services/resume-builder' },
  { label: 'JD-Tailored Resume Builder', to: '/services/jd-tailored-resume' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const location = useLocation()
  const { user, isAuthenticated, logout, loading } = useAuth()

  const closeMenu = () => {
    setOpen(false)
    setDropdownOpen(false)
  }

  const isActive = (to) => {
    if (to === '/') return location.pathname === '/' && !location.hash
    if (to.startsWith('/#')) return location.pathname === '/' && location.hash === to.slice(1)
    return location.pathname === to
  }

  async function handleLogout() {
    closeMenu()
    try {
      await logout()
    } catch {
      /* storage already cleared */
    }
  }

  const firstName = user?.name?.split(/\s+/)[0] || 'Account'
  const enhancerLeft = user?.usage?.remaining?.enhancer
  const enhancerLimit = user?.usage?.limits?.enhancer
  const isUnlimited = enhancerLeft == null || !Number.isFinite(enhancerLimit)
  const usageShort = isUnlimited ? 'Unlimited' : `${enhancerLeft} left`
  const usageFull = isUnlimited
    ? 'Unlimited enhancements'
    : `${enhancerLeft} of ${enhancerLimit} enhancements left`
  const usageTitle = user?.planLabel ? `${user.planLabel} · ${usageFull}` : usageFull

  return (
    <header className="navbar">
      <div className="navbar__inner container">
        <Link to="/" className="navbar__brand" onClick={closeMenu}>
          <span className="navbar__logo">
            <Logo size={38} />
          </span>
          <span className="navbar__name"><BrandName /></span>
        </Link>

        <nav className={`navbar__nav ${open ? 'navbar__nav--open' : ''}`}>
          <Link
            to="/"
            className={`navbar__link ${isActive('/') ? 'navbar__link--active' : ''}`}
            onClick={closeMenu}
          >
            Home
          </Link>
          <Link
            to="/#how-it-works"
            className={`navbar__link ${isActive('/#how-it-works') ? 'navbar__link--active' : ''}`}
            onClick={closeMenu}
          >
            How It Works
          </Link>

          <div
            className={`navbar__dropdown ${dropdownOpen ? 'navbar__dropdown--open' : ''}`}
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <Link
              to="/#services"
              className={`navbar__link ${isActive('/#services') ? 'navbar__link--active' : ''}`}
              onClick={closeMenu}
            >
              Services
              <svg className="navbar__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </Link>
            <div className="navbar__dropdown-menu">
              {serviceLinks.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="navbar__dropdown-item"
                  onClick={closeMenu}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {navLinks.slice(2).map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`navbar__link ${isActive(link.to) ? 'navbar__link--active' : ''}`}
              onClick={closeMenu}
            >
              {link.label}
            </Link>
          ))}

          <div className="navbar__mobile-actions">
            {!loading && isAuthenticated ? (
              <>
                <span className="navbar__user navbar__user--mobile">Hi, {firstName}</span>
                <span className="navbar__usage navbar__usage--mobile" title={usageTitle}>
                  {usageFull}
                </span>
                <button type="button" className="btn btn--ghost navbar__signin navbar__signin--mobile" onClick={handleLogout}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn--ghost navbar__signin navbar__signin--mobile" onClick={closeMenu}>
                  Sign In
                </Link>
                <Link to="/signup" className="btn btn--primary navbar__cta navbar__cta--mobile" onClick={closeMenu}>
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </nav>

        <div className={`navbar__actions${isAuthenticated ? ' navbar__actions--authed' : ''}`}>
          {!loading && isAuthenticated ? (
            <>
              <span className="navbar__usage" title={usageTitle}>
                {usageShort}
              </span>
              <span className="navbar__user" title={user?.name || firstName}>
                {firstName}
              </span>
              <button type="button" className="btn btn--ghost navbar__signin" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn--ghost navbar__signin">
                Sign In
              </Link>
              <Link to="/signup" className="btn btn--primary navbar__cta">
                Sign Up
              </Link>
            </>
          )}
          <button
            className="navbar__toggle"
            aria-label="Toggle menu"
            onClick={() => setOpen(!open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  )
}
