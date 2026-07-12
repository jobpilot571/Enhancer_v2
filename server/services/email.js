/**
 * Email delivery for signup OTP.
 * Uses Resend when RESEND_API_KEY is set; otherwise logs the code (local/dev).
 */

function getFromAddress() {
  return (process.env.EMAIL_FROM || 'JoBPilot.AI <onboarding@resend.dev>').trim()
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY.trim()
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: [to],
      subject,
      html,
      text,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Email provider error (${res.status}): ${body || res.statusText}`)
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
