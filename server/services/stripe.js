import Stripe from 'stripe'

let stripe = null

export function isStripeConfigured() {
  return Boolean((process.env.STRIPE_SECRET_KEY || '').trim())
}

export function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim()
  if (!key) return null
  if (!stripe) {
    stripe = new Stripe(key)
  }
  return stripe
}

export function getFrontendUrl() {
  const fromEnv = (process.env.FRONTEND_URL || process.env.APP_URL || '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return 'http://localhost:5173'
}

/** Map Stripe Price ID → plan entitlement id */
export function planFromPriceId(priceId) {
  if (!priceId) return null
  const professional = (process.env.STRIPE_PRICE_PROFESSIONAL || '').trim()
  const enterprise = (process.env.STRIPE_PRICE_ENTERPRISE || '').trim()
  if (professional && priceId === professional) return 'professional'
  if (enterprise && priceId === enterprise) return 'enterprise'
  return null
}

export function priceIdForPlan(planId) {
  if (planId === 'professional') return (process.env.STRIPE_PRICE_PROFESSIONAL || '').trim() || null
  if (planId === 'enterprise') return (process.env.STRIPE_PRICE_ENTERPRISE || '').trim() || null
  return null
}

export function isPaidSubscriptionStatus(status) {
  return status === 'active' || status === 'trialing'
}
