import DocxViewer from './DocxViewer'
import PdfViewer from './PdfViewer'

function detectPreviewType(blob, fileType) {
  if (fileType === 'pdf') return 'pdf'
  if (fileType === 'docx') return 'docx'
  if (blob instanceof File) {
    const name = blob.name.toLowerCase()
    if (name.endsWith('.pdf')) return 'pdf'
    if (name.endsWith('.docx')) return 'docx'
  }
  if (blob?.type === 'application/pdf') return 'pdf'
  return 'docx'
}

export default function DocumentPreview({
  blob,
  fileType,
  className = '',
  emptyLabel = 'Upload a DOCX or PDF resume to preview',
}) {
  const type = detectPreviewType(blob, fileType)

  if (type === 'pdf') {
    return <PdfViewer blob={blob} className={className} emptyLabel={emptyLabel} />
  }
  return <DocxViewer blob={blob} className={className} emptyLabel={emptyLabel} />
}
