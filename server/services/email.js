/**
 * Email delivery for signup OTP.
 * Uses Resend when RESEND_API_KEY is set; otherwise logs the code (local/dev).
 *
 * EMAIL_FROM must use a domain verified in Resend (e.g. JoBPilot.AI <shiva@jobpilot.solutions>).
 * Never use @gmail.com / @yahoo.com etc. — Resend will reject those.
 */

function getFromAddress() {
  return (process.env.EMAIL_FROM || 'JoBPilot.AI <onboarding@resend.dev>').trim()
}

function extractEmailDomain(from) {
  const match = String(from || '').match(/@([a-z0-9.-]+)>?$/i)
  return match ? match[1].toLowerCase() : ''
}

/** Consumer mailbox domains cannot be used as Resend "from" addresses. */
function isUnverifiedMailboxDomain(domain) {
  return /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|me)\.com$/.test(domain)
    || domain === 'yahoo.co.uk'
}

export function getEmailFromStatus() {
  const from = getFromAddress()
  const domain = extractEmailDomain(from)
  const consumerFrom = isUnverifiedMailboxDomain(domain)
  const usingResendOnboarding = /@resend\.dev>?$/i.test(from) || domain === 'resend.dev'
  return {
    configured: isEmailConfigured(),
    fromDomain: domain || null,
    consumerMailboxFrom: consumerFrom,
    usingResendOnboarding,
    ok: isEmailConfigured() && Boolean(domain) && !consumerFrom,
    hint: !isEmailConfigured()
      ? 'Set RESEND_API_KEY on Render.'
      : consumerFrom
        ? `EMAIL_FROM uses @${domain}. Resend cannot send from Gmail/Yahoo/etc. Set EMAIL_FROM to an address on your verified domain (e.g. JoBPilot.AI <shiva@jobpilot.solutions>).`
        : usingResendOnboarding
          ? 'Using onboarding@resend.dev — you can only email your own Resend account address. Verify jobpilot.solutions in Resend and set EMAIL_FROM to that domain.'
          : `Sending from @${domain}.`,
  }
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY.trim()
  const from = getFromAddress()
  const status = getEmailFromStatus()
  if (status.consumerMailboxFrom) {
    throw new Error(status.hint)
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let detail = body || res.statusText
    try {
      const parsed = JSON.parse(body)
      detail = parsed.message || parsed.error || detail
    } catch {
      /* keep raw body */
    }
    if (/gmail\.com domain is not verified|domain is not verified/i.test(detail)) {
      throw new Error(
        `${detail} Fix on Render: set EMAIL_FROM to JoBPilot.AI <shiva@jobpilot.solutions> (or another address on your Resend-verified domain), then restart the service.`,
      )
    }
    throw new Error(detail)
  }
  return res.json()
}

function buildOtpEmail({ name, code, expiresInSeconds }) {
  const minutes = Math.max(1, Math.round(expiresInSeconds / 60))
  const greeting = name ? `Hi ${name},` : 'Hi,'
  const text = [
    greeting,
    '',
    `Your JoBPilot.AI verification code is: ${code}`,
    '',
    `This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    'If you did not create an account, you can ignore this email.',
  ].join('\n')

  const html = `
    <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:28px;color:#2f3a35;background:#ffffff;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#12a86e;">JoBPilot.AI</p>
      <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Use this code to verify your email and finish creating your account:</p>
      <p style="margin:0 0 20px;font-size:32px;letter-spacing:8px;font-weight:700;color:#0e8a5a;font-family:ui-monospace,Consolas,monospace;">${code}</p>
      <p style="margin:0;color:#6b7770;font-size:13px;line-height:1.5;">Expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you did not sign up, ignore this email.</p>
    </div>
  `.trim()

  return { subject: `${code} is your JoBPilot.AI verification code`, html, text }
}

export async function sendVerificationOtp({ to, name, code, expiresInSeconds }) {
  const payload = buildOtpEmail({ name, code, expiresInSeconds })

  if (!isEmailConfigured()) {
    console.log(`[auth:otp] Email not configured — code for ${to}: ${code} (expires in ${expiresInSeconds}s)`)
    return { delivered: false, mode: 'console' }
  }

  try {
    await sendViaResend({ to, ...payload })
    return { delivered: true, mode: 'resend' }
  } catch (err) {
    console.error('[auth:otp] Resend failed:', err.message)
    const e = new Error(err.message || 'Email delivery failed')
    e.code = 'EMAIL_DELIVERY_FAILED'
    throw e
  }
}
