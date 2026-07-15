import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useAuth } from '../context/AuthContext'
import { stashOtpHint } from '../api/otpHint'

export default function SignupPage() {
  const { signup, loginWithGoogle, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const showGoogle = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const data = await signup({ name, email, password, confirmPassword })
      if (data.signedIn || (data.token && data.user && !data.needsVerification)) {
        navigate('/', { replace: true })
        return
      }
      stashOtpHint(data)
      navigate(`/verify?email=${encodeURIComponent(data.email)}`, { replace: true })
    } catch (err) {
      if (err.code === 'ALREADY_REGISTERED') {
        setError(err.message)
      } else {
        setError(err.message || 'Sign up failed')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle(credential) {
    setError('')
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
      setError(err.message || 'Google sign-up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Free plan"
      title="Create your account"
      desc="Verify your email once, then sign in with password or Google anytime."
    >
      <div className="auth-form-card">
        <h2 className="auth-form-card__title">Sign up</h2>
        <p className="auth-form-card__desc">
          Google and email signups both require a 6-digit email code once. Free plan includes <strong>10 resume enhancements</strong> per month.
        </p>

        {showGoogle && (
          <>
            <GoogleSignInButton
              text="signup_with"
              onCredential={handleGoogle}
              onError={(err) => setError(err.message)}
            />
            <div className="auth-divider"><span>or email</span></div>
          </>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Full name</span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              required
            />
          </label>
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
          <div className="auth-field-row">
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="Min. 8 characters"
                required
              />
            </label>
            <label className="auth-field">
              <span>Confirm</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                placeholder="Repeat password"
                required
              />
            </label>
          </div>

          {error && (
            <div className="auth-error-block">
              <p className="auth-error">{error}</p>
              {(error.toLowerCase().includes('already exists') || error.toLowerCase().includes('sign in')) && (
                <Link to={`/login?email=${encodeURIComponent(email)}`} className="btn btn--primary btn--full">
                  Go to sign in
                </Link>
              )}
            </div>
          )}

          <button type="submit" className="btn btn--primary btn--full" disabled={loading}>
            {loading ? 'Sending code…' : 'Continue with email'}
          </button>
        </form>

        <p className="auth-card__footer">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </AuthShell>
  )
}
