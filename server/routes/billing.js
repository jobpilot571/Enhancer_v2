import express from 'express'
import { requireUser } from '../middleware/userAuth.js'
import {
  applyStripeSubscription,
  findUserById,
  findUserByStripeCustomerId,
} from '../store/userStore.js'
import {
  getFrontendUrl,
  getStripe,
  isPaidSubscriptionStatus,
  isStripeConfigured,
  planFromPriceId,
  priceIdForPlan,
} from '../services/stripe.js'

const router = express.Router()

function checkoutPlanAllowed(planId) {
  return planId === 'professional' || (planId === 'enterprise' && priceIdForPlan('enterprise'))
}

/** POST /api/billing/checkout { plan?: 'professional' | 'enterprise' } */
router.post('/checkout', requireUser, async (req, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured.', code: 'STRIPE_NOT_CONFIGURED' })
    }

    const planId = String(req.body?.plan || 'professional').trim().toLowerCase()
    if (!checkoutPlanAllowed(planId)) {
      return res.status(400).json({ error: 'Invalid plan for checkout.', code: 'INVALID_PLAN' })
    }

    const priceId = priceIdForPlan(planId)
    if (!priceId) {
      return res.status(503).json({
        error: `Stripe price for ${planId} is not configured.`,
        code: 'PRICE_NOT_CONFIGURED',
      })
    }

    const stripe = getStripe()
    const frontend = getFrontendUrl()
    const fullUser = findUserById(req.user.id)
    if (!fullUser) {
      return res.status(401).json({ error: 'Account not found.', code: 'AUTH_REQUIRED' })
    }

    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontend}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/#pricing`,
      client_reference_id: fullUser.id,
      metadata: { userId: fullUser.id, plan: planId },
      subscription_data: {
        metadata: { userId: fullUser.id, plan: planId },
      },
      allow_promotion_codes: true,
    }

    if (fullUser.stripeCustomerId) {
      sessionParams.customer = fullUser.stripeCustomerId
    } else {
      sessionParams.customer_email = fullUser.email
    }

    const session = await stripe.checkout.sessions.create(sessionParams)
    return res.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    next(err)
  }
})

/** POST /api/billing/portal — Stripe Customer Portal */
router.post('/portal', requireUser, async (req, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured.', code: 'STRIPE_NOT_CONFIGURED' })
    }

    const fullUser = findUserById(req.user.id)
    if (!fullUser?.stripeCustomerId) {
      return res.status(400).json({
        error: 'No Stripe customer on this account. Subscribe first.',
        code: 'NO_CUSTOMER',
      })
    }

    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: fullUser.stripeCustomerId,
      return_url: `${getFrontendUrl()}/#pricing`,
    })
    return res.json({ url: session.url })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/billing/confirm?session_id=...
 * Fallback when webhooks are not set up locally — verifies Checkout Session and upgrades plan.
 */
router.get('/confirm', requireUser, async (req, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured.', code: 'STRIPE_NOT_CONFIGURED' })
    }

    const sessionId = String(req.query.session_id || '').trim()
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id is required.' })
    }

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    const userId = session.client_reference_id || session.metadata?.userId
    if (!userId || userId !== req.user.id) {
      return res.status(403).json({ error: 'This checkout session does not belong to you.' })
    }

    if (session.status !== 'complete' && session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Checkout is not complete yet.', code: 'NOT_COMPLETE' })
    }

    const user = await syncFromCheckoutSession(session)
    return res.json({ user, plan: user?.plan || null })
  } catch (err) {
    next(err)
  }
})

router.get('/status', (_req, res) => {
  res.json({
    configured: isStripeConfigured(),
    professionalPriceConfigured: Boolean(priceIdForPlan('professional')),
    enterprisePriceConfigured: Boolean(priceIdForPlan('enterprise')),
  })
})

async function syncFromCheckoutSession(session) {
  const userId = session.client_reference_id || session.metadata?.userId
  if (!userId) return null

  let subscription = session.subscription
  if (typeof subscription === 'string') {
    subscription = await getStripe().subscriptions.retrieve(subscription)
  }

  const priceId = subscription?.items?.data?.[0]?.price?.id
  const planId =
    planFromPriceId(priceId)
    || session.metadata?.plan
    || subscription?.metadata?.plan
    || 'professional'

  const status = subscription?.status || (session.payment_status === 'paid' ? 'active' : null)

  return applyStripeSubscription(userId, {
    customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    subscriptionId: subscription?.id || null,
    status,
    planId: isPaidSubscriptionStatus(status) ? planId : null,
  })
}

async function syncFromSubscription(subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id

  let userId = subscription.metadata?.userId
  if (!userId && customerId) {
    userId = findUserByStripeCustomerId(customerId)?.id
  }
  if (!userId) {
    console.warn('[stripe] subscription event missing user mapping', subscription.id)
    return null
  }

  const priceId = subscription.items?.data?.[0]?.price?.id
  const planId = planFromPriceId(priceId) || subscription.metadata?.plan || 'professional'
  const status = subscription.status

  return applyStripeSubscription(userId, {
    customerId,
    subscriptionId: subscription.id,
    status,
    planId: isPaidSubscriptionStatus(status) ? planId : null,
  })
}

/** Stripe webhook — must receive raw body (mounted in index.js). */
export async function handleStripeWebhook(req, res) {
  if (!isStripeConfigured()) {
    return res.status(503).send('Stripe not configured')
  }

  const stripe = getStripe()
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  let event = req.body

  if (secret) {
    const signature = req.headers['stripe-signature']
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, secret)
    } catch (err) {
      console.error('[stripe] webhook signature failed:', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }
  } else if (Buffer.isBuffer(req.body)) {
    try {
      event = JSON.parse(req.body.toString('utf8'))
    } catch {
      return res.status(400).send('Invalid JSON')
    }
    console.warn('[stripe] STRIPE_WEBHOOK_SECRET not set — accepting unverified webhook (dev only)')
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.mode === 'subscription') {
          await syncFromCheckoutSession(session)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncFromSubscription(event.data.object)
        break
      }
      default:
        break
    }
  } catch (err) {
    console.error('[stripe] webhook handler error:', err)
    return res.status(500).json({ error: 'Webhook handler failed' })
  }

  return res.json({ received: true })
}

export default router
