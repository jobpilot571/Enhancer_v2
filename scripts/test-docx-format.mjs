import PizZip from 'pizzip'
import { patchDocx } from '../server/services/docxService.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
  console.log('ok:', msg)
}

const bulletA = (text, left, font) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
  + `<w:ind w:left="${left}" w:hanging="360"/><w:spacing w:before="0" w:after="60"/></w:pPr>`
  + `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="20"/></w:rPr>`
  + `<w:t>${text}</w:t></w:r></w:p>`

const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>PROFESSIONAL SUMMARY</w:t></w:r></w:p>`
  + bulletA('Summary bullet one about data analysis work here.', 720, 'Calibri')
  + bulletA('Summary bullet two about SQL and Python skills here.', 720, 'Calibri')
  + bulletA('Summary bullet three about dashboards and reporting.', 720, 'Calibri')
  + `<w:p><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Languages: Python, SQL</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Data Analyst — Cardinal Health</w:t></w:r></w:p>`
  + bulletA('Built pipelines with Python and SQL for analytics.', 720, 'Calibri')
  + bulletA('Created Power BI dashboards for stakeholders.', 720, 'Calibri')
  + bulletA('Wrong indent times font bullet should not be template.', 0, 'Times New Roman')
  + bulletA('Integrated data from multiple sources into warehouse.', 720, 'Calibri')
  + bulletA('Automated reporting reducing manual effort by 35 percent.', 720, 'Calibri')
  + `<w:p><w:r><w:t>EDUCATION</w:t></w:r></w:p>`
  + `<w:sectPr/></w:body></w:document>`

const zip = new PizZip()
zip.file('word/document.xml', xml)
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
const buf = zip.generate({ type: 'nodebuffer' })

const plan = {
  summaryBullets: ['Added summary bullet with Python and SQL impact metrics.'],
  experienceAdditions: [{ company: 'Cardinal Health', bullets: ['Added experience bullet using Power BI and Python.'] }],
  bulletRewrites: [],
  skillsToAdd: [],
}

const resumeData = {
  summaryBullets: [
    'Summary bullet one about data analysis work here.',
    'Summary bullet two about SQL and Python skills here.',
    'Summary bullet three about dashboards and reporting.',
  ],
  experience: [{
    company: 'Cardinal Health',
    title: 'Data Analyst',
    bullets: [
      'Built pipelines with Python and SQL for analytics.',
      'Created Power BI dashboards for stakeholders.',
      'Wrong indent times font bullet should not be template.',
      'Integrated data from multiple sources into warehouse.',
      'Automated reporting reducing manual effort by 35 percent.',
    ],
  }],
}

const { buffer } = patchDocx(buf, plan, { highlight: false, resumeData })
const out = new PizZip(buffer).file('word/document.xml').asText()

assert(out.includes('Added summary bullet'), 'summary bullet inserted')
assert(out.includes('Added experience bullet'), 'experience bullet inserted')

const idx = out.indexOf('Added experience bullet')
const window = out.slice(Math.max(0, idx - 400), idx + 50)
assert(window.includes('Calibri'), 'experience new bullet uses Calibri')
assert(!window.includes('Times New Roman'), 'experience new bullet does not use Times')
assert(window.includes('w:left="720"'), 'experience new bullet uses left=720')

const sidx = out.indexOf('Added summary bullet')
const sw = out.slice(Math.max(0, sidx - 400), sidx + 50)
assert(sw.includes('Calibri'), 'summary new bullet uses Calibri')
assert(sw.includes('w:left="720"'), 'summary new bullet uses left=720')

// Large spacing on a sibling must be tightened (no half-page gaps on new bullets)
const gapBullet = (text) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
  + `<w:ind w:left="720" w:hanging="360"/><w:spacing w:before="0" w:after="2400"/></w:pPr>`
  + `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr>`
  + `<w:t>${text}</w:t></w:r></w:p>`

const gapXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>PROFESSIONAL SUMMARY</w:t></w:r></w:p>`
  + gapBullet('Summary bullet one about data analysis work here.')
  + gapBullet('Summary bullet two about SQL and Python skills here.')
  + `<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Data Analyst — Cardinal Health</w:t></w:r></w:p>`
  + gapBullet('Built pipelines with Python and SQL for analytics.')
  + gapBullet('Created Power BI dashboards for stakeholders.')
  + `<w:sectPr/></w:body></w:document>`

const gapZip = new PizZip()
gapZip.file('word/document.xml', gapXml)
gapZip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
const gapBuf = gapZip.generate({ type: 'nodebuffer' })
const gapPlan = {
  summaryBullets: ['Tight spacing summary bullet with Python metrics.'],
  experienceAdditions: [{ company: 'Cardinal Health', bullets: ['Tight spacing experience bullet with SQL.'] }],
  bulletRewrites: [],
  skillsToAdd: [],
}
const gapResume = {
  summaryBullets: ['Summary bullet one about data analysis work here.', 'Summary bullet two about SQL and Python skills here.'],
  experience: [{
    company: 'Cardinal Health',
    title: 'Data Analyst',
    bullets: ['Built pipelines with Python and SQL for analytics.', 'Created Power BI dashboards for stakeholders.'],
  }],
}
const { buffer: gapOutBuf } = patchDocx(gapBuf, gapPlan, { highlight: false, resumeData: gapResume })
const gapOut = new PizZip(gapOutBuf).file('word/document.xml').asText()
const gIdx = gapOut.indexOf('Tight spacing experience bullet')
const gWin = gapOut.slice(Math.max(0, gIdx - 350), gIdx + 40)
assert(!gWin.includes('w:after="2400"'), 'new bullet does not keep huge after spacing')
assert(gWin.includes('w:after="60"'), 'new bullet uses tightened after spacing')

console.log('ALL PASSED')
