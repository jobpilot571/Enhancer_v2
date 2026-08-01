import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { confirmCheckoutSession } from '../api/billing'
import { useAuth } from '../context/AuthContext'

export default function BillingSuccessPage() {
  const { isAuthenticated, loading: authLoading, refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const sessionId = searchParams.get('session_id') || ''
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent(`/billing/success?session_id=${sessionId}`)}`, {
        replace: true,
      })
      return
    }
    if (!sessionId) {
      setStatus('error')
      setError('Missing checkout session.')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const data = await confirmCheckoutSession(sessionId)
        if (cancelled) return
        setPlan(data?.plan || data?.user?.plan || 'professional')
        await refreshUser?.()
        setStatus('ok')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err.message || 'Could not confirm payment')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authLoading, isAuthenticated, navigate, refreshUser, sessionId])

  return (
    <div className="container" style={{ padding: '4rem 1.25rem', textAlign: 'center' }}>
      {status === 'loading' && (
        <>
          <h1 className="section-title">Confirming your subscription…</h1>
          <p className="section-desc">This only takes a moment.</p>
        </>
      )}
      {status === 'ok' && (
        <>
          <h1 className="section-title">You&apos;re on {plan}!</h1>
          <p className="section-desc" style={{ marginBottom: '1.5rem' }}>
            Payment succeeded. Unlimited resume tools are unlocked on your account.
          </p>
          <Link to="/services/resume-enhancer" className="btn btn--primary">
            Start enhancing
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <h1 className="section-title">Almost there</h1>
          <p className="section-desc" style={{ marginBottom: '1.5rem' }}>
            {error} If you were charged, refresh in a minute or contact support — your plan updates
            when Stripe confirms the payment.
          </p>
          <Link to="/#pricing" className="btn btn--outline">Back to pricing</Link>
        </>
      )}
    </div>
  )
}
