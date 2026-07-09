import { useCallback, useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'

const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  useBase64URL: true,
}

function fitDocxToWidth(container, scalerEl, bodyEl) {
  const wrapper = bodyEl.querySelector('.docx-wrapper')
  if (!wrapper || !container || !scalerEl) return

  bodyEl.style.transform = 'none'
  bodyEl.style.width = ''
  bodyEl.style.height = ''
  scalerEl.style.height = ''

  const pad = 10
  const availW = Math.max(container.clientWidth - pad * 2, 1)

  const naturalW = wrapper.scrollWidth
  const naturalH = wrapper.scrollHeight
  if (naturalW <= 0 || naturalH <= 0) return

  const scale = Math.min(availW / naturalW, 1)

  bodyEl.style.width = `${naturalW}px`
  bodyEl.style.height = `${naturalH}px`
  bodyEl.style.transform = `scale(${scale})`
  bodyEl.style.transformOrigin = 'top center'

  scalerEl.style.height = `${naturalH * scale}px`
}

export default function DocxViewer({ blob, className = '', emptyLabel = 'Upload a DOCX or PDF resume to preview' }) {
  const containerRef = useRef(null)
  const scalerRef = useRef(null)
  const bodyRef = useRef(null)
  const styleRef = useRef(null)

  const fitToWidth = useCallback(() => {
    const container = containerRef.current
    const scalerEl = scalerRef.current
    const bodyEl = bodyRef.current
    if (!container || !scalerEl || !bodyEl?.querySelector('.docx-wrapper')) return
    fitDocxToWidth(container, scalerEl, bodyEl)
  }, [])

  useEffect(() => {
    const bodyEl = bodyRef.current
    const styleEl = styleRef.current
    if (!bodyEl || !blob) return

    let cancelled = false

    bodyEl.innerHTML = ''
    if (styleEl) styleEl.innerHTML = ''
    bodyEl.style.transform = 'none'
    bodyEl.style.width = ''
    bodyEl.style.height = ''
    if (scalerRef.current) scalerRef.current.style.height = ''

    renderAsync(blob, bodyEl, styleEl, RENDER_OPTIONS)
      .then(() => {
        if (cancelled) return
        requestAnimationFrame(() => {
          requestAnimationFrame(fitToWidth)
        })
      })
      .catch((err) => {
        if (cancelled) return
        bodyEl.innerHTML = `<p class="docx-error">Preview failed: ${err.message}</p>`
      })

    return () => {
      cancelled = true
    }
  }, [blob, fitToWidth])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !blob) return

    const observer = new ResizeObserver(() => fitToWidth())
    observer.observe(container)
    return () => observer.disconnect()
  }, [blob, fitToWidth])

  if (!blob) {
    return (
      <div className={`docx-viewer docx-viewer--empty ${className}`.trim()}>
        <div className="docx-viewer__empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span>{emptyLabel}</span>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`docx-viewer ${className}`.trim()}>
      <div ref={scalerRef} className="docx-viewer__scaler">
        <div ref={styleRef} className="docx-viewer__styles" aria-hidden="true" />
        <div ref={bodyRef} className="docx-viewer__body" />
      </div>
    </div>
  )
}
