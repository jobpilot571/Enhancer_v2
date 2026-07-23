import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useAuth } from '../context/AuthContext'
import { stashOtpHint } from '../api/otpHint'
import { isLocalDevHost, shouldShowGoogleAuth } from '../utils/googleAuthUi'

export default function LoginPage() {
  const { login, loginWithGoogle, loginLocalDev, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notRegisteredEmail, setNotRegisteredEmail] = useState('')
  const [needsVerifyEmail, setNeedsVerifyEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const showGoogle = shouldShowGoogleAuth()
  const localDev = isLocalDevHost()

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setNotRegisteredEmail('')
    setNeedsVerifyEmail('')
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/', { replace: true })
    } catch (err) {
      if (err.code === 'NOT_REGISTERED') {
        setNotRegisteredEmail(err.email || email)
        setError(err.message)
      } else if (err.needsVerification || err.code === 'NEEDS_VERIFICATION') {
        setNeedsVerifyEmail(err.email || email)
        setError(err.message)
      } else {
        setError(err.message || 'Sign in failed')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle(credential) {
    setError('')
    setNotRegisteredEmail('')
    setNeedsVerifyEmail('')
    setLoading(true)
    try {
      const data = await loginWithGoogle(credential)
      if (data.needsVerification) {
        stashOtpHint(data)
        navigate(`/verify?email=${encodeURIComponent(data.email)}`, { replace: true })
        return
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleLocalDev() {
    setError('')
    setLoading(true)
    try {
      await loginLocalDev()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Local dev sign-in failed. Set LOCAL_DEV_AUTH=true in .env and restart the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to JoBPilot.AI"
      desc="Continue enhancing resumes with your Free plan limits."
    >
      <div className="auth-form-card">
        <h2 className="auth-form-card__title">Sign in</h2>
        <p className="auth-form-card__desc">
          {showGoogle
            ? 'Use Google or email. OTP is only for new or unverified accounts — returning users stay signed in.'
            : 'Sign in with email and password to use Resume Enhancer and other services.'}
        </p>

        {localDev && (
          <div className="auth-callout" style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 10 }}>
              Local development: Google is disabled here (origin mismatch). Use the button below for unlimited local access, or email sign-in.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--full"
              disabled={loading}
              onClick={handleLocalDev}
            >
              Continue as local developer
            </button>
          </div>
        )}

        {showGoogle && (
          <>
            <GoogleSignInButton
              text="signin_with"
              onCredential={handleGoogle}
              onError={(err) => setError(err.message)}
            />
            <div className="auth-divider"><span>or email</span></div>
          </>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          {notRegisteredEmail && (
            <div className="auth-callout">
              <p>This email isn’t registered yet.</p>
              <Link
                to={`/signup?email=${encodeURIComponent(notRegisteredEmail)}`}
                className="btn btn--primary btn--full"
              >
                Create an account
              </Link>
            </div>
          )}

          {needsVerifyEmail && (
            <div className="auth-callout">
              <p>Finish verifying your email to continue.</p>
              <Link
                to={`/verify?email=${encodeURIComponent(needsVerifyEmail)}`}
                className="btn btn--primary btn--full"
              >
                Enter verification code
              </Link>
            </div>
          )}

          {!notRegisteredEmail && (
            <button type="submit" className="btn btn--primary btn--full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          )}
        </form>

        <p className="auth-card__footer">
          New here? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </AuthShell>
  )
}
