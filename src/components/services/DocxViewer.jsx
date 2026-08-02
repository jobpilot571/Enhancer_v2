import { useCallback, useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'

const DEFAULT_RENDER_OPTIONS = {
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

/** Compact gallery cards — crop to top of page so fonts/style stay readable */
const CARD_RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  ignoreWidth: true,
  ignoreHeight: true,
  ignoreFonts: false,
  breakPages: false,
  renderHeaders: false,
  renderFooters: false,
  renderFootnotes: false,
  useBase64URL: true,
}

function fitDocxToWidth(container, scalerEl, bodyEl, { cover = false } = {}) {
  const wrapper = bodyEl.querySelector('.docx-wrapper')
  if (!wrapper || !container || !scalerEl) return

  bodyEl.style.transform = 'none'
  bodyEl.style.width = ''
  bodyEl.style.height = ''
  scalerEl.style.height = ''

  const pad = cover ? 0 : 4
  const availW = Math.max(container.clientWidth - pad * 2, 1)

  const naturalW = wrapper.scrollWidth
  const naturalH = wrapper.scrollHeight
  if (naturalW <= 0 || naturalH <= 0) return

  // Always fit full page width so sides aren't cropped; height scrolls in the card.
  const scale = availW / naturalW

  bodyEl.style.width = `${naturalW}px`
  bodyEl.style.height = `${naturalH}px`
  bodyEl.style.transform = `scale(${scale})`
  bodyEl.style.transformOrigin = 'top center'

  scalerEl.style.height = `${Math.ceil(naturalH * scale)}px`
}

export default function DocxViewer({
  blob,
  className = '',
  emptyLabel = 'Upload a DOCX or PDF resume to preview',
  previewMode = 'default',
}) {
  const containerRef = useRef(null)
  const scalerRef = useRef(null)
  const bodyRef = useRef(null)
  const styleRef = useRef(null)
  const isCard = previewMode === 'card'

  const fitToWidth = useCallback(() => {
    const container = containerRef.current
    const scalerEl = scalerRef.current
    const bodyEl = bodyRef.current
    if (!container || !scalerEl || !bodyEl?.querySelector('.docx-wrapper')) return
    fitDocxToWidth(container, scalerEl, bodyEl, { cover: false })
  }, [isCard])

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

    const options = isCard ? CARD_RENDER_OPTIONS : DEFAULT_RENDER_OPTIONS
    renderAsync(blob, bodyEl, styleEl, options)
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
  }, [blob, fitToWidth, isCard])

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
    <div
      ref={containerRef}
      className={`docx-viewer ${isCard ? 'docx-viewer--card' : ''} ${className}`.trim()}
    >
      <div ref={scalerRef} className="docx-viewer__scaler">
        <div ref={styleRef} className="docx-viewer__styles" aria-hidden="true" />
        <div ref={bodyRef} className="docx-viewer__body" />
      </div>
    </div>
  )
}
