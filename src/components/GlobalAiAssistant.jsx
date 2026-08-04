import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { streamAssistantChat } from '../api/assistant'
import { useAssistantWorkspace } from '../context/AssistantContext'
import { useAuth } from '../context/AuthContext'

const PROACTIVE_KEY = 'jobpilot_assistant_proactive_v1'

function serviceProactiveCopy(pathname) {
  if (pathname.includes('/services/resume-enhancer')) {
    return "I'm here with you on Resume Enhancer. If you get stuck on format, layout, or download — tap me anytime."
  }
  if (pathname.includes('/services/resume-builder')) {
    return "I'm here with you on Resume Builder. Stuck on templates or content? Let me know."
  }
  if (pathname.includes('/services/jd-tailored-resume')) {
    return "I'm here with you on JD-Tailored Resume. Stuck on companies, JD, or preview? Ask me anytime."
  }
  if (pathname === '/') {
    return "Hi! I'm your JoBPilot assistant. If you get stuck anywhere on the site, tap this chat — I'll help right away."
  }
  return "I'm here with you. If you get stuck anywhere, let me know and we'll sort it out."
}

export default function GlobalAiAssistant() {
  const location = useLocation()
  const { workspace } = useAssistantWorkspace()
  const { user } = useAuth() || {}
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const [thread, setThread] = useState([])
  const [files, setFiles] = useState([])
  const [nudge, setNudge] = useState('')
  const [localError, setLocalError] = useState('')
  const fileRef = useRef(null)
  const threadRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread, statusLine, open])

  // Proactive sticky nudge when user starts/lands on a service
  useEffect(() => {
    const path = location.pathname
    if (path.startsWith('/admin') || path === '/login' || path === '/signup') return undefined
    const key = `${PROACTIVE_KEY}:${path}:${user?.id || 'guest'}`
    try {
      if (sessionStorage.getItem(key)) return undefined
      sessionStorage.setItem(key, '1')
    } catch { /* ignore */ }
    const text = serviceProactiveCopy(path)
    setNudge(text)
    const t = setTimeout(() => setNudge(''), 9000)
    return () => clearTimeout(t)
  }, [location.pathname, user?.id])

  function openWithGreeting() {
    setOpen(true)
    setThread((prev) => {
      if (prev.length) return prev
      return [{
        role: 'assistant',
        text: "How may I help you? Where are you stuck?",
      }]
    })
  }

  async function send() {
    if (busy) return
    const text = message.trim()
    if (!text && !files.length) {
      setLocalError('Type a message or attach a file.')
      return
    }
    setLocalError('')
    setBusy(true)
    setStatusLine('Connecting…')
    const userLine = {
      role: 'user',
      text: text || '(attached file)',
      fileName: files[0]?.name || null,
    }
    const nextThread = [...thread, userLine]
    setThread(nextThread)
    setMessage('')
    const attached = [...files]
    setFiles([])
    if (fileRef.current) fileRef.current.value = ''

    abortRef.current?.abort?.()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamAssistantChat({
        message: text || 'Please review my attached file and help.',
        pathname: location.pathname,
        workspace,
        thread: nextThread,
        files: attached,
        signal: controller.signal,
        onEvent: (ev) => {
          if (ev.type === 'status' && ev.text) {
            setStatusLine(ev.text)
            setThread((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role === 'status') {
                return [...prev.slice(0, -1), { role: 'status', text: ev.text }]
              }
              return [...prev, { role: 'status', text: ev.text }]
            })
          }
          if (ev.type === 'reply') {
            setStatusLine('')
            setThread((prev) => {
              const cleaned = prev.filter((m) => m.role !== 'status')
              return [
                ...cleaned,
                {
                  role: 'assistant',
                  text: ev.reply || 'Done.',
                  suggestPath: ev.suggestPath || null,
                  previewUpdated: Boolean(ev.previewUpdated),
                },
              ]
            })
            if (ev.previewUpdated) {
              window.dispatchEvent(new CustomEvent('jobpilot:assistant-preview-updated', {
                detail: ev,
              }))
            }
            if (ev.projectUpdates || ev.navigateToStep) {
              window.dispatchEvent(new CustomEvent('jobpilot:assistant-project-update', {
                detail: ev,
              }))
            }
          }
        },
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      setThread((prev) => [
        ...prev.filter((m) => m.role !== 'status'),
        { role: 'assistant', text: err.message || 'Something went wrong. Please try again.' },
      ])
    } finally {
      setBusy(false)
      setStatusLine('')
    }
  }

  return (
    <div className="site-assistant" aria-live="polite">
      {nudge && !open && (
        <button
          type="button"
          className="site-assistant__nudge"
          onClick={() => {
            setNudge('')
            openWithGreeting()
          }}
        >
          <strong>AI Assistant</strong>
          <span>{nudge}</span>
        </button>
      )}

      {open && (
        <section className="site-assistant__panel" aria-label="JoBPilot AI Assistant">
          <header className="site-assistant__head">
            <div>
              <h3>AI Assistant</h3>
              <p>Stuck anywhere? I’ll help across the whole site.</p>
            </div>
            <button type="button" className="site-assistant__close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>

          <div ref={threadRef} className="site-assistant__thread" role="log">
            {thread.map((item, idx) => (
              <div
                key={`${item.role}-${idx}-${item.text?.slice(0, 12)}`}
                className={`site-assistant__bubble site-assistant__bubble--${item.role}`}
              >
                <p>{item.text}</p>
                {item.fileName && <small>Attached: {item.fileName}</small>}
                {item.suggestPath && (
                  <Link className="site-assistant__link" to={item.suggestPath} onClick={() => setOpen(false)}>
                    Open that page →
                  </Link>
                )}
              </div>
            ))}
            {busy && statusLine && (
              <div className="site-assistant__bubble site-assistant__bubble--status">
                <span className="site-assistant__pulse" />
                <p>{statusLine}</p>
              </div>
            )}
          </div>

          <div className="site-assistant__composer">
            <textarea
              className="site-assistant__input"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="How may I help you? Where are you stuck?"
              disabled={busy}
            />
            <div className="site-assistant__actions">
              <label className="site-assistant__attach">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 4))}
                  disabled={busy}
                />
                <span>{files.length ? `${files.length} file(s)` : 'Upload image / PDF / Word'}</span>
              </label>
              <button type="button" className="btn btn--primary btn--sm" onClick={send} disabled={busy}>
                {busy ? 'Working…' : 'Send'}
              </button>
            </div>
            {localError && <p className="site-assistant__error">{localError}</p>}
          </div>
        </section>
      )}

      <button
        type="button"
        className={`site-assistant__fab ${open ? 'is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openWithGreeting())}
        aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
      >
        {open ? (
          <span aria-hidden="true">×</span>
        ) : (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
            <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H12l-4.2 3.2c-.7.5-1.8 0-1.8-.9V16H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  )
}
