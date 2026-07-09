import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export async function extractResumeText(buffer, fileType) {
  if (fileType === 'pdf') {
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return result.text.trim()
    } finally {
      await parser.destroy()
    }
  }
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}
