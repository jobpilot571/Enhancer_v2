import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchPublicPricing } from '../api/admin'

const FALLBACK_PLANS = [
  {
    id: 'starter',
    name: 'Free',
    price: '0',
    period: 'forever',
    desc: 'Get started with monthly limits that cover most job searches',
    features: [
      '10 resume enhancements per month',
      '5 resume builds per month',
      '5 JD-tailored resumes per month',
      'ATS score report',
      'DOCX export',
    ],
    cta: 'Start Free',
    featured: false,
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '19',
    period: '/month',
    desc: 'For active job seekers who need more power',
    features: [
      'Unlimited resume enhancements',
      'Unlimited resume builds',
      'Unlimited JD-tailored resumes',
      'Full ATS analysis & suggestions',
      'All premium templates',
      'Priority support',
    ],
    cta: 'Get Professional',
    featured: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '49',
    period: '/month',
    desc: 'For career coaches and recruiting teams',
    features: [
      'Everything in Professional',
      'Team dashboard & analytics',
      'White-label exports',
      'API access',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    featured: false,
  },
]

export default function Pricing() {
  const [plans, setPlans] = useState(FALLBACK_PLANS)

  useEffect(() => {
    let cancelled = false
    fetchPublicPricing()
      .then((data) => {
        if (!cancelled && Array.isArray(data.plans) && data.plans.length > 0) {
          setPlans(data.plans)
        }
      })
      .catch(() => {
        /* keep fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section id="pricing" className="pricing">
      <div className="container">
        <div className="section-header">
          <span className="section-label">Pricing</span>
          <h2 className="section-title">Simple, Transparent Pricing</h2>
          <p className="section-desc">
            Start free and upgrade when you need more. No hidden fees, cancel anytime.
          </p>
        </div>

        <div className="pricing-grid">
          {plans.map((plan) => (
            <div
              key={plan.id || plan.name}
              className={`pricing-card ${plan.featured ? 'pricing-card--featured' : ''}`}
            >
              {plan.featured && <span className="pricing-card__badge">Most Popular</span>}
              <h3 className="pricing-card__name">{plan.name}</h3>
              <div className="pricing-card__price">
                <span className="pricing-card__currency">$</span>
                <span className="pricing-card__amount">{plan.price}</span>
                <span className="pricing-card__period">{plan.period}</span>
              </div>
              <p className="pricing-card__desc">{plan.desc}</p>
              <ul className="pricing-card__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to={plan.id === 'starter' || plan.price === '0' ? '/signup' : '/#contact'}
                className={`btn ${plan.featured ? 'btn--primary' : 'btn--outline'} btn--full`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
