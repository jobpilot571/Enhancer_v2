import PizZip from 'pizzip'
import {
  qaEnhancedResume,
  ensureEnhancedResumeQuality,
  findPaginationDefects,
} from '../server/services/resumeQaService.js'
import { patchDocx } from '../server/services/docxService.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
  console.log('ok:', msg)
}

const bullet = (text, extraPPr = '') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
  + `<w:ind w:left="720" w:hanging="360"/>${extraPPr}</w:pPr>`
  + `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr>`
  + `<w:t>${text}</w:t></w:r></w:p>`

function makeDocx(bodyXml, stylesXml = null) {
  const zip = new PizZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + bodyXml
    + `<w:sectPr/></w:body></w:document>`,
  )
  if (stylesXml) zip.file('word/styles.xml', stylesXml)
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
  return zip.generate({ type: 'nodebuffer' })
}

// --- Pagination defect detection ---
const gapXml = [
  '<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>DevOps Engineer — Capgemini</w:t></w:r></w:p>',
  bullet('Built APIs with AWS Kinesis and GitOps workflows here.', '<w:keepNext/><w:spacing w:before="0" w:after="4800"/>'),
  bullet('Optimized serverless workloads reducing compute costs by 22 percent.'),
  bullet('Implemented disaster recovery drills across regions.'),
].join('')

const gapBuf = makeDocx(gapXml)
const gapZipXml = new PizZip(gapBuf).file('word/document.xml').asText()
const pageDefects = findPaginationDefects(gapZipXml)
assert(pageDefects.some((d) => d.code === 'keep_next'), 'detects keepNext')
assert(pageDefects.some((d) => d.code === 'huge_spacing'), 'detects huge spacing')

// --- QA + auto-repair loop ---
const originalBody = [
  '<w:p><w:r><w:t>SUMMARY</w:t></w:r></w:p>',
  bullet('Summary bullet one about devops pipelines and cloud.'),
  bullet('Summary bullet two about kubernetes and monitoring.'),
  '<w:p><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>CI/CD &amp; Automation Tools: Jenkins, GitHub Actions</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>DevOps Engineer — Capgemini</w:t></w:r></w:p>',
  bullet('Built CI/CD pipelines with Jenkins and GitHub Actions.'),
  bullet('Deployed workloads on AWS EKS with Terraform.'),
].join('')

const badEnhancedBody = [
  '<w:p><w:r><w:t>SUMMARY</w:t></w:r></w:p>',
  bullet('Summary bullet one about devops pipelines and cloud.'),
  bullet('Summary bullet two about kubernetes and monitoring.'),
  '<w:p><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>CI/CD &amp; Automation Tools: Jenkins, GitHub Actions, Cloud environments, Developer-facing products</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>DevOps Engineer — Capgemini</w:t></w:r></w:p>',
  bullet('Built CI/CD pipelines with Jenkins and GitHub Actions.', '<w:keepNext/><w:spacing w:after="5000"/>'),
  bullet('Deployed workloads on AWS EKS with Terraform reducing compute costs by 22 percent.'),
].join('')

const originalBuf = makeDocx(originalBody)
const badEnhancedBuf = makeDocx(
  badEnhancedBody,
  `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="ListParagraph"><w:pPr><w:keepNext/></w:pPr></w:style></w:styles>`,
)

const resumeData = {
  name: 'Capgemini Engineer',
  summaryBullets: [
    'Summary bullet one about devops pipelines and cloud.',
    'Summary bullet two about kubernetes and monitoring.',
  ],
  experience: [{
    company: 'Capgemini',
    title: 'DevOps Engineer',
    bullets: [
      'Built CI/CD pipelines with Jenkins and GitHub Actions.',
      'Deployed workloads on AWS EKS with Terraform.',
    ],
  }],
}

const beforeQa = qaEnhancedResume(originalBuf, badEnhancedBuf, resumeData)
assert(!beforeQa.ok, 'bad enhanced fails QA')
assert(beforeQa.defects.some((d) => d.code === 'keep_next' || d.code === 'huge_spacing'), 'gap defects present')
assert(beforeQa.defects.some((d) => d.code === 'skills_dump'), 'skills dump detected')

const ensured = ensureEnhancedResumeQuality(originalBuf, badEnhancedBuf, resumeData, { maxAttempts: 2 })
assert(ensured.repaired, 'QA repair ran')
assert(ensured.qa.ok, 'QA passes after repair')
const fixedXml = new PizZip(ensured.buffer).file('word/document.xml').asText()
assert(!/<w:keepNext\s*\/>/.test(fixedXml), 'bare keepNext removed after repair')
assert(!fixedXml.includes('w:after="5000"'), 'huge spacing removed after repair')
assert(!fixedXml.toLowerCase().includes('cloud environments'), 'skills dump stripped')
assert(fixedXml.includes('Capgemini'), 'company preserved')

// --- Patch + QA path still works ---
const plan = {
  summaryBullets: [],
  experienceAdditions: [{ company: 'Capgemini', bullets: ['Added Terraform module for EKS node groups.'] }],
  bulletRewrites: [],
  skillsToAdd: [],
}
const { buffer: patched } = patchDocx(originalBuf, plan, { highlight: false, resumeData })
const afterPatchQa = qaEnhancedResume(originalBuf, patched, resumeData)
assert(afterPatchQa.ok, 'normal patchDocx output passes QA')

console.log('ALL QA TESTS PASSED')
