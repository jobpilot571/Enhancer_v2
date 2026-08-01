import { useEffect, useMemo, useState } from 'react'
import DocumentPreview from '../../DocumentPreview'
import {
  listSavedJdResumes,
  fetchSavedJdResumeBlob,
  getSavedJdResumeDownloadUrl,
  getSavedJdTextDownloadUrl,
  deleteSavedJdResume,
} from '../../../../api/jdBuilder'
import { getAuthToken } from '../../../../api/auth'

function formatExp(item) {
  const yoe = item.yearsOfExperience
  const req = item.yearsRequired
  if (Number.isFinite(Number(yoe)) && Number(yoe) > 0) {
    return `${Number(yoe)} yr${Number(yoe) === 1 ? '' : 's'}`
  }
  if (Number.isFinite(Number(req)) && Number(req) > 0) {
    return `${Number(req)} yr${Number(req) === 1 ? '' : 's'} req`
  }
  return '—'
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function downloadWithAuth(url, fileName) {
  const token = getAuthToken()
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Download failed')
      }
      return res.blob()
    })
    .then((blob) => {
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = fileName || 'download'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1500)
    })
}

export default function SavedResumesStep({ refreshKey = 0 }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [jdHoverId, setJdHoverId] = useState(null)
  const [resumeHoverId, setResumeHoverId] = useState(null)
  const [resumeBlobs, setResumeBlobs] = useState({})
  const [resumeLoadingId, setResumeLoadingId] = useState('')
  const [modal, setModal] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    listSavedJdResumes()
      .then((data) => {
        if (cancelled) return
        setItems(Array.isArray(data?.items) ? data.items : [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Could not load saved resumes.')
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [refreshKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => {
      const hay = [
        item.role,
        item.fileName,
        item.jdText,
        item.jdSnippet,
        formatExp(item),
        String(item.yearsOfExperience || ''),
        String(item.yearsRequired || ''),
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [items, query])

  async function ensureResumeBlob(id) {
    if (resumeBlobs[id]) return resumeBlobs[id]
    setResumeLoadingId(id)
    try {
      const blob = await fetchSavedJdResumeBlob(id)
      setResumeBlobs((prev) => ({ ...prev, [id]: blob }))
      return blob
    } finally {
      setResumeLoadingId('')
    }
  }

  async function handleResumeHover(id) {
    setResumeHoverId(id)
    try {
      await ensureResumeBlob(id)
    } catch (err) {
      setError(err.message || 'Could not load resume preview.')
    }
  }

  async function openResumeModal(item) {
    try {
      const blob = await ensureResumeBlob(item.id)
      setModal({ type: 'resume', item, blob })
    } catch (err) {
      setError(err.message || 'Could not open resume preview.')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this saved resume?')) return
    try {
      await deleteSavedJdResume(id)
      setItems((prev) => prev.filter((x) => x.id !== id))
      setResumeBlobs((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (err) {
      setError(err.message || 'Could not delete saved resume.')
    }
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Saved Resumes</h4>
        <p className="jd-step__desc">
          Resumes you download are kept here so you can search and re-download without digging through email or your laptop.
        </p>
      </header>

      <div className="jd-saved__toolbar">
        <input
          className="form-field__input jd-saved__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by role, experience, or JD keywords…"
          aria-label="Search saved resumes"
        />
        <span className="jd-saved__count">
          {loading ? 'Loading…' : `${filtered.length} saved`}
        </span>
      </div>

      {error && <p className="builder-error" role="alert">{error}</p>}

      {!loading && !filtered.length && (
        <p className="builder-hint">
          {items.length
            ? 'No saved resumes match your search.'
            : 'No saved resumes yet. Build a resume and click Download DOCX on Preview — it will appear here.'}
        </p>
      )}

      {!!filtered.length && (
        <div className="jd-saved__table-wrap">
          <table className="jd-saved__table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Exp</th>
                <th>JD</th>
                <th>Resume</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="jd-saved__role">{item.role || 'Untitled role'}</div>
                    <div className="jd-saved__meta">{formatDate(item.createdAt)}</div>
                  </td>
                  <td>{formatExp(item)}</td>
                  <td>
                    <div
                      className="jd-saved__hover-wrap"
                      onMouseEnter={() => setJdHoverId(item.id)}
                      onMouseLeave={() => setJdHoverId((cur) => (cur === item.id ? null : cur))}
                    >
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setModal({ type: 'jd', item })}
                      >
                        Preview JD
                      </button>
                      {jdHoverId === item.id && (
                        <div className="jd-saved__popover" role="tooltip">
                          <strong className="jd-saved__popover-title">Job description</strong>
                          <pre className="jd-saved__popover-text">
                            {item.jdText || item.jdSnippet || 'No JD text saved.'}
                          </pre>
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() => downloadWithAuth(
                              getSavedJdTextDownloadUrl(item.id),
                              `${(item.role || 'job').replace(/\s+/g, '-')}-jd.txt`,
                            ).catch((err) => setError(err.message))}
                          >
                            Download JD (.txt)
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div
                      className="jd-saved__hover-wrap"
                      onMouseEnter={() => handleResumeHover(item.id)}
                      onMouseLeave={() => setResumeHoverId((cur) => (cur === item.id ? null : cur))}
                    >
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => openResumeModal(item)}
                      >
                        {resumeLoadingId === item.id ? 'Loading…' : 'Preview resume'}
                      </button>
                      {resumeHoverId === item.id && (
                        <div className="jd-saved__popover jd-saved__popover--resume" role="tooltip">
                          <strong className="jd-saved__popover-title">
                            {item.role || 'Resume'} preview
                          </strong>
                          {resumeBlobs[item.id] ? (
                            <div className="jd-saved__popover-preview">
                              <DocumentPreview
                                blob={resumeBlobs[item.id]}
                                fileType="docx"
                                emptyLabel="Preview unavailable"
                              />
                            </div>
                          ) : (
                            <p className="builder-hint">Loading preview…</p>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="jd-saved__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => downloadWithAuth(
                          getSavedJdResumeDownloadUrl(item.id),
                          item.fileName || 'resume.docx',
                        ).catch((err) => setError(err.message))}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => handleDelete(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'jd' && (
        <div
          className="sample-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Job description preview"
          onClick={() => setModal(null)}
        >
          <div className="sample-modal__panel" onClick={(e) => e.stopPropagation()}>
            <div className="sample-modal__head">
              <h3>JD · {modal.item.role || 'Untitled'}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
            <div className="sample-modal__body">
              <pre className="jd-saved__modal-jd">{modal.item.jdText || 'No JD text saved.'}</pre>
              <button
                type="button"
                className="btn btn--outline"
                style={{ marginTop: 12 }}
                onClick={() => downloadWithAuth(
                  getSavedJdTextDownloadUrl(modal.item.id),
                  `${(modal.item.role || 'job').replace(/\s+/g, '-')}-jd.txt`,
                ).catch((err) => setError(err.message))}
              >
                Download JD (.txt)
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === 'resume' && (
        <div
          className="sample-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Resume preview"
          onClick={() => setModal(null)}
        >
          <div className="sample-modal__panel" onClick={(e) => e.stopPropagation()}>
            <div className="sample-modal__head">
              <h3>{modal.item.role || 'Resume'}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
            <div className="sample-modal__body">
              <DocumentPreview blob={modal.blob} fileType="docx" emptyLabel="Preview unavailable" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
