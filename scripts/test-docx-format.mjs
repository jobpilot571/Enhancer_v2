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
  + `<w:ind w:left="720" w:hanging="360"/><w:spacing w:before="0" w:after="2400"/><w:keepNext/></w:pPr>`
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
  + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
  + gapBullet('After page break bullet that should flow without blank page.')
  + `<w:sectPr/></w:body></w:document>`

const gapZip = new PizZip()
gapZip.file('word/document.xml', gapXml)
gapZip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="ListParagraph"><w:pPr><w:keepNext/><w:spacing w:after="2400"/></w:pPr></w:style></w:styles>`)
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
    bullets: [
      'Built pipelines with Python and SQL for analytics.',
      'Created Power BI dashboards for stakeholders.',
      'After page break bullet that should flow without blank page.',
    ],
  }],
}
const { buffer: gapOutBuf } = patchDocx(gapBuf, gapPlan, { highlight: false, resumeData: gapResume })
const gapOutZip = new PizZip(gapOutBuf)
const gapOut = gapOutZip.file('word/document.xml').asText()
const gapStyles = gapOutZip.file('word/styles.xml').asText()
const gIdx = gapOut.indexOf('Tight spacing experience bullet')
const gWin = gapOut.slice(Math.max(0, gIdx - 350), gIdx + 40)
assert(!gWin.includes('w:after="2400"'), 'new bullet does not keep huge after spacing')
assert(/w:after="(0|40|60|80|120)"/.test(gWin), 'new bullet uses tightened after spacing')
assert(!/<w:keepNext\s*\/>/.test(gapOut), 'document has no bare keepNext enabled')
assert(!gapOut.includes('w:type="page"'), 'empty page-break paragraph removed')
assert(!gapStyles.includes('w:keepNext'), 'styles keepNext removed')

// Skills dump must NOT explode category lines / table layouts
const skillsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>SUMMARY</w:t></w:r></w:p>`
  + bulletA('Summary bullet one about devops and cloud work here.', 720, 'Calibri')
  + bulletA('Summary bullet two about pipelines and automation here.', 720, 'Calibri')
  + `<w:p><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>`
  + `<w:tbl><w:tr>`
  + `<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>CI/CD &amp; Automation Tools:</w:t></w:r>`
  + `<w:r><w:t> Jenkins, GitHub Actions</w:t></w:r></w:p></w:tc>`
  + `<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Cloud Platforms:</w:t></w:r>`
  + `<w:r><w:t> AWS, Azure</w:t></w:r></w:p></w:tc>`
  + `</w:tr></w:tbl>`
  + `<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>DevOps Engineer — Capgemini</w:t></w:r></w:p>`
  + bulletA('Built CI/CD pipelines with Jenkins and GitHub Actions.', 720, 'Calibri')
  + bulletA('Deployed workloads on AWS EKS with Terraform.', 720, 'Calibri')
  + `<w:sectPr/></w:body></w:document>`

const skillsZip = new PizZip()
skillsZip.file('word/document.xml', skillsXml)
skillsZip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
const skillsBuf = skillsZip.generate({ type: 'nodebuffer' })
const skillsPlan = {
  summaryBullets: [],
  experienceAdditions: [],
  bulletRewrites: [],
  skillsByCategory: [{
    category: 'CI/CD & Automation Tools',
    skills: [
      'AI tools, SRE, Cloud environments, Cloud deployments, Cloud infrastructure, Cloud-native applications, Developer-facing products, Dashboards, Internal tools',
      'Terraform',
      'Kubernetes',
      'Helm',
      'Prometheus',
      'Grafana',
      'Docker',
      'Ansible',
    ],
  }],
  skillsToAdd: [],
}
const skillsResume = {
  summaryBullets: ['Summary bullet one about devops and cloud work here.', 'Summary bullet two about pipelines and automation here.'],
  headings: ['CI/CD & Automation Tools', 'Cloud Platforms'],
  experience: [{
    company: 'Capgemini',
    title: 'DevOps Engineer',
    bullets: ['Built CI/CD pipelines with Jenkins and GitHub Actions.', 'Deployed workloads on AWS EKS with Terraform.'],
  }],
}
const { buffer: skillsOutBuf, applied: skillsApplied } = patchDocx(skillsBuf, skillsPlan, {
  highlight: false,
  resumeData: skillsResume,
})
const skillsOut = new PizZip(skillsOutBuf).file('word/document.xml').asText()
assert(!skillsOut.includes('Cloud environments'), 'soft JD phrases not dumped into skills')
assert(!skillsOut.includes('Developer-facing'), 'soft phrases rejected')
assert((skillsApplied.skills || []).length <= 5, 'skills append capped')
const cicdCell = skillsOut.slice(skillsOut.indexOf('CI/CD'), skillsOut.indexOf('Cloud Platforms'))
assert(cicdCell.length < 500, 'CI/CD cell did not explode into a dump block')
assert(skillsOut.includes('Terraform') || skillsOut.includes('Kubernetes') || skillsOut.includes('Docker'), 'at least one real tool skill added')

// Paragraph-style summary must stay a paragraph (no new bullets)
const paraXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>SUMMARY</w:t></w:r></w:p>`
  + `<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr>`
  + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr>`
  + `<w:t>Results-driven Business Analyst with 3+ years of experience translating business needs into actionable insights across healthcare operations.</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Languages: SQL, Python</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Business Analyst | CVS Health</w:t></w:r></w:p>`
  + bulletA('Partnered with stakeholders to deliver analytics solutions.', 720, 'Calibri')
  + bulletA('Built dashboards that improved decision making by 20 percent.', 720, 'Calibri')
  + `<w:sectPr/></w:body></w:document>`

const paraZip = new PizZip()
paraZip.file('word/document.xml', paraXml)
paraZip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
const paraBuf = paraZip.generate({ type: 'nodebuffer' })
const paraPlan = {
  summaryBullets: [
    'Skilled in SQL and Power BI for healthcare analytics reporting.',
    'Collaborated with cross-functional teams to improve operational KPIs.',
  ],
  experienceAdditions: [],
  bulletRewrites: [],
  skillsToAdd: [],
}
const paraResume = {
  summaryFormat: 'paragraph',
  summary: 'Results-driven Business Analyst with 3+ years of experience translating business needs into actionable insights across healthcare operations.',
  summaryBullets: [],
  experience: [{
    company: 'CVS Health',
    title: 'Business Analyst',
    bullets: [
      'Partnered with stakeholders to deliver analytics solutions.',
      'Built dashboards that improved decision making by 20 percent.',
    ],
  }],
}
const { buffer: paraOutBuf } = patchDocx(paraBuf, paraPlan, { highlight: true, resumeData: paraResume })
const paraOut = new PizZip(paraOutBuf).file('word/document.xml').asText()
assert(paraOut.includes('Skilled in SQL and Power BI'), 'paragraph summary includes woven sentence')
assert(paraOut.includes('Results-driven Business Analyst'), 'original paragraph text preserved')
assert(!/<w:numPr>[\s\S]*Skilled in SQL/.test(paraOut), 'woven summary is not a numbered bullet')
assert(!/>•\s*Skilled in SQL/.test(paraOut) && !/>•Skilled in SQL/.test(paraOut), 'woven summary has no literal bullet glyph')
const summaryRegion = paraOut.slice(paraOut.indexOf('SUMMARY'), paraOut.indexOf('TECHNICAL SKILLS'))
const bulletCountInSummary = (summaryRegion.match(/w:numPr/g) || []).length
assert(bulletCountInSummary === 0, 'paragraph summary section has zero list bullets')

console.log('ALL PASSED')
