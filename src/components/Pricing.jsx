import { Link } from 'react-router-dom'

const plans = [
  {
    name: 'Starter',
    price: '0',
    period: 'forever',
    desc: 'Perfect for trying out resume enhancement',
    features: [
      '1 resume enhancement per month',
      'Basic ATS score report',
      'PDF export',
      'Email support',
    ],
    cta: 'Start Free',
    featured: false,
  },
  {
    name: 'Professional',
    price: '19',
    period: '/month',
    desc: 'For active job seekers who need more power',
    features: [
      'Unlimited resume enhancements',
      'Full ATS analysis & suggestions',
      'Build new resumes (3/month)',
      'JD-based resume builder',
      'All premium templates',
      'Priority support',
    ],
    cta: 'Get Professional',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: '49',
    period: '/month',
    desc: 'For career coaches and recruiting teams',
    features: [
      'Everything in Professional',
      'Unlimited resume builds',
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
              key={plan.name}
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
                to="/#contact"
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
