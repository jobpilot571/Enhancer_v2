import { useEffect, useRef, useState } from 'react'

const GIS_SRC = 'https://accounts.google.com/gsi/client'

function loadGisScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')))
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google sign-in'))
    document.head.appendChild(script)
  })
}

export default function GoogleSignInButton({ onCredential, onError, text = 'continue_with' }) {
  const btnRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const callbackRef = useRef({ onCredential, onError })
  callbackRef.current = { onCredential, onError }

  useEffect(() => {
    let cancelled = false
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

    // No client ID → hide quietly (email/password still works)
    if (!clientId) {
      setUnavailable(true)
      return undefined
    }

    async function init() {
      try {
        await loadGisScript()
        if (cancelled || !btnRef.current) return

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response?.credential) {
              callbackRef.current.onCredential?.(response.credential)
            } else {
              callbackRef.current.onError?.(new Error('Google sign-in was cancelled.'))
            }
          },
          ux_mode: 'popup',
        })

        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text,
          width: 356,
          logo_alignment: 'left',
        })

        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) setUnavailable(true)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [text])

  if (unavailable) return null

  return (
    <div className="auth-google">
      {!ready && <p className="auth-google__loading">Loading Google…</p>}
      <div ref={btnRef} className="auth-google__btn" />
    </div>
  )
}
