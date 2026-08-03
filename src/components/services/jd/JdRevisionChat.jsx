import { useEffect, useState } from 'react'
import { reviseJdResume } from '../../../api/jdBuilder'

/**
 * Chat box for JD-tailored resume revisions (companies, bullets, skills, etc.).
 */
export default function JdRevisionChat({
  sessionId,
  disabled = false,
  forceOpen = false,
  onRevised,
}) {
  const [open, setOpen] = useState(Boolean(forceOpen))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [thread, setThread] = useState([])
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  useEffect(() => {
    setThread([])
    setMessage('')
    setLocalError('')
  }, [sessionId])

  async function send() {
    if (!sessionId || busy) return
    const text = message.trim()
    if (!text) {
      setLocalError('Describe what you want changed.')
      return
    }
    setLocalError('')
    setBusy(true)
    setThread((prev) => [...prev, { role: 'user', text }])
    try {
      const result = await reviseJdResume(sessionId, text)
      setThread((prev) => [...prev, { role: 'assistant', text: result.reply || 'Done.' }])
      setMessage('')
      await onRevised?.(result)
    } catch (err) {
      setThread((prev) => [...prev, {
        role: 'assistant',
        text: err.message || 'Could not apply that change. Please try again.',
      }])
    } finally {
      setBusy(false)
    }
  }

  if (!sessionId) return null

  return (
    <section className="layout-issue-chat jd-revision-chat" aria-label="Revise resume with AI chat">
      {!forceOpen && (
        <button
          type="button"
          className="layout-issue-chat__toggle"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
        >
          {open ? 'Close chat' : 'Ask AI to revise'}
        </button>
      )}

      {(open || forceOpen) && (
        <div className="layout-issue-chat__panel">
          <p className="layout-issue-chat__hint">
            Tell the AI what to change — companies, bullets, skills, summary, titles, and more.
            It uses Claude first, then ChatGPT / Gemini if needed, and updates your preview.
          </p>

          <div className="layout-issue-chat__thread" role="log" aria-live="polite">
            {thread.length === 0 && (
              <p className="layout-issue-chat__empty">
                Examples: “Rename Northstar Tech to Apex Analytics” · “Add 2 stronger bullets to my latest role” · “Make the summary more cloud-focused”
              </p>
            )}
            {thread.map((item, idx) => (
              <div
                key={`${item.role}-${idx}`}
                className={`layout-issue-chat__bubble layout-issue-chat__bubble--${item.role}`}
              >
                <p>{item.text}</p>
              </div>
            ))}
          </div>

          <label className="layout-issue-chat__label" htmlFor="jd-revision-message">
            Your request
          </label>
          <textarea
            id="jd-revision-message"
            className="layout-issue-chat__input"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="What would you like changed?"
            disabled={busy || disabled}
          />

          <div className="layout-issue-chat__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={send}
              disabled={busy || disabled || !message.trim()}
            >
              {busy ? 'Updating…' : 'Send'}
            </button>
          </div>
          {localError && <p className="layout-issue-chat__error">{localError}</p>}
        </div>
      )}
    </section>
  )
}
