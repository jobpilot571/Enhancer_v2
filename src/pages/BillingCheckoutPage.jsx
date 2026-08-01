import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createCheckoutSession } from '../api/billing'
import { useAuth } from '../context/AuthContext'

export default function BillingCheckoutPage() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const plan = (searchParams.get('plan') || 'professional').toLowerCase()

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent(`/billing/checkout?plan=${plan}`)}`, {
        replace: true,
      })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const data = await createCheckoutSession(plan)
        if (!cancelled && data?.url) {
          window.location.href = data.url
        } else if (!cancelled) {
          setError('Could not start checkout.')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Checkout failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authLoading, isAuthenticated, navigate, plan])

  return (
    <div className="container" style={{ padding: '4rem 1.25rem', textAlign: 'center' }}>
      <h1 className="section-title" style={{ marginBottom: '0.75rem' }}>
        {error ? 'Checkout unavailable' : 'Redirecting to Stripe…'}
      </h1>
      {error ? (
        <>
          <p className="section-desc" style={{ marginBottom: '1.5rem' }}>{error}</p>
          <Link to="/#pricing" className="btn btn--primary">Back to pricing</Link>
        </>
      ) : (
        <p className="section-desc">Hang tight — opening secure checkout.</p>
      )}
    </div>
  )
}
