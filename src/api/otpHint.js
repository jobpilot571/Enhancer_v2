const OTP_HINT_KEY = 'jobpilot_otp_hint'

export function stashOtpHint(data) {
  if (!data?.email) return
  sessionStorage.setItem(
    OTP_HINT_KEY,
    JSON.stringify({
      email: data.email,
      message: data.message || '',
      previewCode: data.previewCode || '',
      delivered: Boolean(data.delivered),
      emailConfigured: Boolean(data.emailConfigured),
    })
  )
}

export function readOtpHint(email) {
  try {
    const raw = sessionStorage.getItem(OTP_HINT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (email && data.email && data.email !== email) return null
    return data
  } catch {
    return null
  }
}

export function clearOtpHint() {
  sessionStorage.removeItem(OTP_HINT_KEY)
}
