import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../context/AuthContext'
import { stashOtpHint, readOtpHint, clearOtpHint } from '../api/otpHint'

export default function VerifyEmailPage() {
  const { verifyOtp, resendOtp, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [previewCode, setPreviewCode] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  useEffect(() => {
    const fromQuery = searchParams.get('email')
    if (fromQuery) setEmail(fromQuery)
    const hint = readOtpHint(fromQuery || email)
    if (hint) {
      setMessage(hint.message || '')
      setPreviewCode(hint.previewCode || '')
      setDelivered(Boolean(hint.delivered))
      setEmailConfigured(Boolean(hint.emailConfigured))
      if (hint.previewCode) setCode(hint.previewCode)
    }
  }, [searchParams, email])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verifyOtp({ email, code })
      clearOtpHint()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setMessage('')
    setResending(true)
    try {
      const data = await resendOtp({ email })
      stashOtpHint(data)
      setMessage(data.message || 'A new code was sent.')
      setPreviewCode(data.previewCode || '')
      setDelivered(Boolean(data.delivered))
      setEmailConfigured(Boolean(data.emailConfigured))
      if (data.previewCode) setCode(data.previewCode)
    } catch (err) {
      setError(err.message || 'Could not resend code')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Almost there"
      title="Verify your email"
      desc="Enter the 6-digit code. After this, you sign in with password or Google — no more OTP."
    >
      <div className="auth-form-card">
        <h2 className="auth-form-card__title">Enter code</h2>
        <p className="auth-form-card__desc">
          {email ? (
            delivered ? (
              <>Check your inbox for a code sent to <strong>{email}</strong></>
            ) : (
              <>Code for <strong>{email}</strong></>
            )
          ) : (
            'Enter the email you used to sign up, then your code.'
          )}
        </p>

        {previewCode && (
          <div className="auth-otp-preview">
            <p className="auth-otp-preview__label">
              {emailConfigured ? 'Email delivery failed — temporary code' : 'Dev mode — email not configured'}
            </p>
            <p className="auth-otp-preview__code">{previewCode}</p>
            <p className="auth-otp-preview__hint">
              {emailConfigured
                ? (message || 'Check Render EMAIL_FROM / domain verification in Resend.')
                : <>Add <code>RESEND_API_KEY</code> on Render (not only local .env) to send real emails.</>}
            </p>
          </div>
        )}

        {!previewCode && message && (
          <p className={`auth-banner ${delivered ? 'auth-banner--ok' : 'auth-banner--warn'}`}>{message}</p>
        )}

        {!previewCode && !delivered && !message && emailConfigured === false && (
          <p className="auth-banner auth-banner--warn">
            Email is not configured on the API. Set <code>RESEND_API_KEY</code> on Render and restart.
          </p>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {!searchParams.get('email') && (
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
          )}
          <label className="auth-field">
            <span>6-digit code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn btn--primary btn--full" disabled={loading || code.length !== 6}>
            {loading ? 'Verifying…' : 'Verify & continue'}
          </button>
        </form>

        <div className="auth-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--full"
            onClick={handleResend}
            disabled={resending || !email}
          >
            {resending ? 'Sending…' : 'Resend code'}
          </button>
          <p className="auth-card__footer">
            Wrong email? <Link to="/signup">Sign up again</Link>
          </p>
        </div>
      </div>
    </AuthShell>
  )
}
