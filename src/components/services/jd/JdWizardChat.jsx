import { useEffect, useRef, useState } from 'react'
import { chatJdWizard } from '../../../api/jdBuilder'

/**
 * Persistent AI chat for the entire JD-Tailored Resume wizard.
 */
export default function JdWizardChat({
  project,
  stepId,
  sessionId,
  disabled = false,
  hasPreview = false,
  onApplyResult,
}) {
  const [open, setOpen] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [thread, setThread] = useState([])
  const [localError, setLocalError] = useState('')
  const threadRef = useRef(null)

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [thread, busy, open])

  async function send() {
    if (busy || disabled) return
    const text = message.trim()
    if (!text) {
      setLocalError('Type what you want help with.')
      return
    }
    setLocalError('')
    setBusy(true)
    const userLine = { role: 'user', text }
    const nextThread = [...thread, userLine]
    setThread(nextThread)
    setMessage('')
    try {
      const result = await chatJdWizard({
        message: text,
        project,
        stepId,
        sessionId,
        thread: nextThread,
      })
      setThread((prev) => [...prev, { role: 'assistant', text: result.reply || 'Done.' }])
      await onApplyResult?.(result)
    } catch (err) {
      setThread((prev) => [...prev, {
        role: 'assistant',
        text: err.message || 'Could not process that. Please try again.',
      }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`jd-wizard-chat ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="jd-wizard-chat__launcher"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="jd-wizard-chat__launcher-title">AI Assistant</span>
        <span className="jd-wizard-chat__launcher-meta">
          {busy ? 'Working…' : open ? 'Minimize' : 'Chat across all steps'}
        </span>
      </button>

      {open && (
        <div className="jd-wizard-chat__panel">
          <p className="jd-wizard-chat__hint">
            Ask anything for this JD resume — change companies, fill basics, tweak the JD,
            pick a template, or revise the built resume. Claude first, then ChatGPT / Gemini.
          </p>

          <div ref={threadRef} className="jd-wizard-chat__thread" role="log" aria-live="polite">
            {thread.length === 0 && (
              <p className="jd-wizard-chat__empty">
                {hasPreview
                  ? 'Examples: “Rename my first company to Apex Analytics” · “Make summary more cloud-focused”'
                  : 'Examples: “Set my name to Alex Morgan” · “Add 2 companies: Northstar and BrightPath” · “Use Navy Pro template”'}
              </p>
            )}
            {thread.map((item, idx) => (
              <div
                key={`${item.role}-${idx}`}
                className={`jd-wizard-chat__bubble jd-wizard-chat__bubble--${item.role}`}
              >
                <p>{item.text}</p>
              </div>
            ))}
            {busy && (
              <div className="jd-wizard-chat__bubble jd-wizard-chat__bubble--assistant">
                <p>Thinking…</p>
              </div>
            )}
          </div>

          <label className="jd-wizard-chat__label" htmlFor="jd-wizard-chat-input">
            Message
          </label>
          <textarea
            id="jd-wizard-chat-input"
            className="jd-wizard-chat__input"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Ask the assistant…"
            disabled={busy || disabled}
          />
          <div className="jd-wizard-chat__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={send}
              disabled={busy || disabled || !message.trim()}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          {localError && <p className="jd-wizard-chat__error">{localError}</p>}
          {!sessionId && (
            <p className="jd-wizard-chat__note">
              Draft edits work now. After you Build, chat can also update the generated DOCX.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
