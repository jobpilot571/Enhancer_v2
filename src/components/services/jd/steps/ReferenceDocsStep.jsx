import { newId } from '../jdProjectModel'

const STATUS_LABELS = {
  waiting: 'Waiting',
  uploading: 'Uploading',
  extracting: 'Extracting',
  analyzing: 'Analyzing',
  ready: 'Ready',
  failed: 'Failed',
}

/**
 * Phase 3: UI + local mock pipeline. Real extraction lands in Phase 5.
 */
export default function ReferenceDocsStep({ project, onChange, onProcessFile }) {
  const docs = project.referenceDocuments || []

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const remaining = 10 - docs.length
    if (remaining <= 0) return
    const slice = files.slice(0, remaining)

    for (const file of slice) {
      const id = newId('ref')
      const stub = {
        id,
        filename: file.name,
        documentType: 'unknown',
        uploadStatus: 'waiting',
        error: '',
      }
      onChange((prev) => ({
        ...prev,
        referenceDocuments: [...(prev.referenceDocuments || []), stub],
      }))

      if (onProcessFile) {
        await onProcessFile(file, id)
      } else {
        // Local mock status progression for Phase 3 UI
        await mockProcess(file, id, onChange)
      }
    }
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Reference Documents</h4>
        <p className="jd-step__desc">
          Upload up to 10 reference files (PDF, DOCX, TXT). We extract professional material only —
          never names, contact info, or another person’s employment identity.
        </p>
      </header>

      <div className="jd-upload-panel">
        <div className="jd-upload-panel__row">
          <div>
            <strong>Add reference files</strong>
            <p className="builder-hint">{docs.length} / 10 uploaded</p>
          </div>
          <label className={`btn btn--outline ${docs.length >= 10 ? 'is-disabled' : ''}`}>
            Upload files
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.txt,text/plain,application/pdf"
              className="sr-only"
              disabled={docs.length >= 10}
              onChange={(e) => {
                handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>

      <ul className="jd-ref-list">
        {docs.map((doc) => (
          <li key={doc.id} className={`jd-ref-list__item is-${doc.uploadStatus}`}>
            <div>
              <strong>{doc.filename}</strong>
              <span className="jd-ref-list__status">{STATUS_LABELS[doc.uploadStatus] || doc.uploadStatus}</span>
              {doc.error && <p className="builder-error">{doc.error}</p>}
            </div>
            <div className="jd-step__row-actions">
              {doc.uploadStatus === 'failed' && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    onChange({
                      ...project,
                      referenceDocuments: docs.map((d) =>
                        d.id === doc.id ? { ...d, uploadStatus: 'waiting', error: '' } : d,
                      ),
                    })
                  }
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  onChange({
                    ...project,
                    referenceDocuments: docs.filter((d) => d.id !== doc.id),
                    referenceItems: (project.referenceItems || []).filter(
                      (i) => i.sourceDocumentId !== doc.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!docs.length && <p className="builder-hint">No reference documents yet — optional but recommended.</p>}
    </div>
  )
}

async function mockProcess(file, id, onChange) {
  const stages = ['uploading', 'extracting', 'analyzing', 'ready']
  for (const status of stages) {
    await new Promise((r) => setTimeout(r, 350))
    onChange((prev) => ({
      ...prev,
      referenceDocuments: (prev.referenceDocuments || []).map((d) =>
        d.id === id ? { ...d, uploadStatus: status } : d,
      ),
      referenceItems:
        status === 'ready'
          ? [
              ...(prev.referenceItems || []),
              {
                id: newId('item'),
                sourceDocumentId: id,
                sourceFileName: file.name,
                category: 'experience',
                cleanedText: `Sample professional activity idea from ${file.name} (mock — real extraction in Phase 5)`,
                relevanceScore: 0.72,
                relevanceLevel: 'medium',
                approved: true,
                targetSection: 'experience',
              },
              {
                id: newId('item'),
                sourceDocumentId: id,
                sourceFileName: file.name,
                category: 'skill',
                cleanedText: 'Sample tool mention (mock)',
                relevanceScore: 0.65,
                relevanceLevel: 'medium',
                approved: true,
                targetSection: 'skills',
              },
            ]
          : prev.referenceItems || [],
    }))
  }
}
