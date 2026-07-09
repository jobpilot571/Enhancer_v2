import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export default function PdfViewer({ blob, className = '', emptyLabel = 'Upload a PDF resume to preview' }) {
  const containerRef = useRef(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !blob) return

    let cancelled = false
    setError('')
    setLoading(true)
    container.innerHTML = ''

    const render = async () => {
      try {
        const data = await blob.arrayBuffer()
        const pdf = await pdfjs.getDocument({ data }).promise
        if (cancelled) return

        const pagesWrap = document.createElement('div')
        pagesWrap.className = 'pdf-viewer__pages'

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          if (cancelled) return

          const viewport = page.getViewport({ scale: 1.2 })
          const canvas = document.createElement('canvas')
          canvas.className = 'pdf-viewer__page'
          const ctx = canvas.getContext('2d')
          canvas.width = viewport.width
          canvas.height = viewport.height

          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          pagesWrap.appendChild(canvas)
        }

        container.appendChild(pagesWrap)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [blob])

  if (!blob) {
    return (
      <div className={`pdf-viewer pdf-viewer--empty ${className}`.trim()}>
        <div className="pdf-viewer__empty">
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
    <div ref={containerRef} className={`pdf-viewer ${className}`.trim()}>
      {loading && (
        <div className="pdf-viewer__loading">
          <span className="pdf-viewer__spinner" />
          Loading PDF…
        </div>
      )}
      {error && <p className="pdf-viewer__error">{error}</p>}
    </div>
  )
}
