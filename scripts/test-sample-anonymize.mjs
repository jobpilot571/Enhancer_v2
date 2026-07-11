import fs from 'fs'
import PizZip from 'pizzip'
import { anonymizeSampleDocx, SAMPLE_DUMMY } from '../server/services/sampleAnonymize.js'

function plainOf(buf) {
  const zip = new PizZip(buf)
  return [...zip.file('word/document.xml').asText().matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"'),
    )
    .join(' ')
}

const files = fs.readdirSync('./server/admin-data/samples').filter((f) => f.endsWith('.docx'))
for (const f of files) {
  const buf = fs.readFileSync(`./server/admin-data/samples/${f}`)
  const { buffer, meta } = anonymizeSampleDocx(buf)
  const after = plainOf(buffer)
  const emailsLeft = (after.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter(
    (e) => e !== SAMPLE_DUMMY.email,
  )
  const nameLeft =
    meta.replacedName && after.toLowerCase().includes(meta.replacedName.toLowerCase())
  console.log('---', f)
  console.log(JSON.stringify(meta))
  console.log(
    'hasDummy',
    after.includes(SAMPLE_DUMMY.name) || after.includes(SAMPLE_DUMMY.nameUpper),
  )
  console.log('nameLeft', Boolean(nameLeft), 'emailsLeft', emailsLeft)
  console.log('head:', after.slice(0, 200).replace(/\s+/g, ' '))
}
