import { useEffect, useState } from 'react'
import { reviseJdResume } from '../../../api/jdBuilder'

/**
 * Chat box for JD-tailored resume revisions (companies, bullets, skills, etc.).
 */
export default function JdRevisionChat({
  sessionId,
  disabled = false,
  ready = false,
  onRevised,
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [thread, setThread] = useState([])
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    setThread([])
    setMessage('')
    setLocalError('')
  }, [sessionId])

  async function send() {
    if (!sessionId || busy || !ready) return
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

  const locked = disabled || busy || !ready || !sessionId

  return (
    <section className="jd-revision-chat" aria-label="Revise resume with AI chat">
      <div className="jd-revision-chat__head">
        <h5 className="jd-revision-chat__title">AI revision chat</h5>
        <p className="jd-revision-chat__subtitle">
          Ask to change companies, bullets, skills, summary, or titles. Claude runs first, then ChatGPT / Gemini.
        </p>
      </div>

      <div className="jd-revision-chat__panel">
        <div className="jd-revision-chat__thread" role="log" aria-live="polite">
          {!ready && (
            <p className="jd-revision-chat__empty">
              Build your resume first, then type a change request here.
            </p>
          )}
          {ready && thread.length === 0 && (
            <p className="jd-revision-chat__empty">
              Examples: “Rename Northstar Tech to Apex Analytics” · “Add 2 stronger bullets to my latest role”
            </p>
          )}
          {thread.map((item, idx) => (
            <div
              key={`${item.role}-${idx}`}
              className={`jd-revision-chat__bubble jd-revision-chat__bubble--${item.role}`}
            >
              <p>{item.text}</p>
            </div>
          ))}
        </div>

        <label className="jd-revision-chat__label" htmlFor="jd-revision-message">
          Your request
        </label>
        <textarea
          id="jd-revision-message"
          className="jd-revision-chat__input"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={ready ? 'What would you like changed?' : 'Build a resume to enable chat…'}
          disabled={locked}
        />

        <div className="jd-revision-chat__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={send}
            disabled={locked || !message.trim()}
          >
            {busy ? 'Updating…' : 'Send'}
          </button>
        </div>
        {localError && <p className="jd-revision-chat__error">{localError}</p>}
      </div>
    </section>
  )
}
