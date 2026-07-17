import PizZip from 'pizzip'
import {
  qaEnhancedResume,
  ensureEnhancedResumeQuality,
  findPaginationDefects,
  findGeometryDefects,
} from '../server/services/resumeQaService.js'
import { patchDocx, normalizeDocxGeometry } from '../server/services/docxService.js'

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

// Permanent fix: paragraphs with NO pPr must get keepNext=0 (style inheritance trap)
const noPprBody = [
  '<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Business Analyst | Acme</w:t></w:r></w:p>',
  // list bullet with numPr but keepNext only in STYLE — classic blank-page source
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`
  + `<w:r><w:t>Acted as a thought partner to senior leadership on strategy.</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`
  + `<w:r><w:t>Delivered dashboards that improved decision speed by 30 percent.</w:t></w:r></w:p>`,
  // paragraph with ZERO pPr
  `<w:p><w:r><w:t>Another bullet-like line without any paragraph properties at all.</w:t></w:r></w:p>`,
].join('')

const noPprStyles = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
  + `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>`
  + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="200"/></w:pPr></w:style></w:styles>`

const noPprBuf = makeDocx(noPprBody, noPprStyles)
const noPprQaBefore = qaEnhancedResume(noPprBuf, noPprBuf, { experience: [{ company: 'Acme' }] })
assert(!noPprQaBefore.ok, 'list paras without keepNext=0 fail QA')

const noPprFixed = ensureEnhancedResumeQuality(noPprBuf, noPprBuf, { experience: [{ company: 'Acme' }] }, { maxAttempts: 2 })
assert(noPprFixed.qa.ok, 'nuclear repair passes QA')
const noPprXml = new PizZip(noPprFixed.buffer).file('word/document.xml').asText()
const noPprStylesOut = new PizZip(noPprFixed.buffer).file('word/styles.xml').asText()
assert((noPprXml.match(/w:keepNext w:val="0"/g) || []).length >= 3, 'every para got keepNext=0')
assert(noPprStylesOut.includes('w:keepNext w:val="0"'), 'styles forced keepNext off')
assert(!/<w:keepNext\s*\/>/.test(noPprStylesOut), 'styles have no bare keepNext enabled')

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

// --- Geometry: huge left margin + skinny sidebar column (vertical "Experience") ---
const skinnyTableBody = [
  '<w:tbl>',
  '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="5000"/></w:tblGrid>',
  '<w:tr>',
  '<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/><w:textDirection w:val="btLr"/></w:tcPr>',
  '<w:p><w:r><w:t>Experience</w:t></w:r></w:p></w:tc>',
  '<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>',
  '<w:p><w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr>',
  '<w:r><w:t>Experienced Business Analyst skilled in IFS ERP.</w:t></w:r></w:p></w:tc>',
  '</w:tr></w:tbl>',
  '<w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="2880" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
].join('')

const geoDefects = findGeometryDefects(
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${skinnyTableBody}</w:body></w:document>`,
)
assert(geoDefects.some((d) => d.code === 'huge_page_margin'), 'detects huge page margin')
assert(geoDefects.some((d) => d.code === 'narrow_table_col'), 'detects narrow table col')
assert(geoDefects.some((d) => d.code === 'extreme_indent'), 'detects extreme indent')

const fixedGeo = normalizeDocxGeometry(
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${skinnyTableBody}</w:body></w:document>`,
)
assert(!/w:left="2880"/.test(fixedGeo), 'page left margin normalized')
assert(/w:left="720"/.test(fixedGeo), 'safe page margin applied')
assert(!/<w:textDirection\b/.test(fixedGeo), 'textDirection stripped')
assert(!/w:w="600"/.test(fixedGeo), 'skinny gridCol widened')
assert(!/w:left="2880" w:hanging/.test(fixedGeo), 'extreme para indent capped')
assert(fixedGeo.includes('Experienced Business Analyst'), 'full sentence preserved')

// --- Skills tab-column layout: hanging ≈ left must NOT be crushed ---
const skillsTabBody = [
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>',
  '<w:p><w:pPr>',
  '<w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs>',
  '<w:ind w:left="2880" w:hanging="2880"/>',
  '</w:pPr>',
  '<w:r><w:rPr><w:b/></w:rPr><w:t>Business Analysis &amp; Requirements</w:t></w:r>',
  '<w:r><w:tab/></w:r>',
  '<w:r><w:t>Requirements Gathering, Stakeholder Management, Process Mapping, Gap Analysis</w:t></w:r>',
  '</w:p>',
  '<w:p><w:pPr>',
  '<w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs>',
  '<w:ind w:left="2880" w:hanging="2880"/>',
  '</w:pPr>',
  '<w:r><w:rPr><w:b/></w:rPr><w:t>Agile &amp; SDLC</w:t></w:r>',
  '<w:r><w:tab/></w:r>',
  '<w:r><w:t>Scrum, Kanban, User Stories, Acceptance Criteria</w:t></w:r>',
  '</w:p>',
  '<w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>',
].join('')

const skillsXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${skillsTabBody}</w:body></w:document>`
const skillsGeoFixed = normalizeDocxGeometry(skillsXml)
assert(/w:left="2880"/.test(skillsGeoFixed), 'skills column left indent preserved')
assert(/w:hanging="2880"/.test(skillsGeoFixed), 'skills hanging indent preserved')
assert(!findGeometryDefects(skillsGeoFixed).some((d) => d.code === 'extreme_indent'), 'skills column not flagged as extreme indent')

const skillsBuf = makeDocx(skillsTabBody)
const skillsPlan = {
  summaryBullets: [],
  experienceAdditions: [],
  bulletRewrites: [],
  skillsToAdd: ['Jira', 'Confluence'],
  skillsByCategory: [{ category: 'Agile & SDLC', skills: ['Jira'] }],
}
const { buffer: skillsPatched } = patchDocx(skillsBuf, skillsPlan, {
  highlight: false,
  resumeData: { name: 'Vamsidhar', experience: [] },
})
const skillsOut = new PizZip(skillsPatched).file('word/document.xml').asText()
assert(/w:left="2880"/.test(skillsOut), 'patch preserves skills left column')
assert(/w:hanging="2880"/.test(skillsOut), 'patch preserves skills hanging column')
assert(/<w:tab[\s/>]/.test(skillsOut), 'patch preserves category tab')
assert(skillsOut.includes('Business Analysis'), 'skills labels intact')

const geoBuf = makeDocx(skinnyTableBody.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, '') + '<w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="2880"/></w:sectPr>')
const geoEnsured = ensureEnhancedResumeQuality(geoBuf, geoBuf, { name: 'Arpitha', experience: [{ company: 'Anthem' }] }, { maxAttempts: 2 })
const geoOut = new PizZip(geoEnsured.buffer).file('word/document.xml').asText()
assert(!/w:left="2880"/.test(geoOut) || (geoOut.match(/w:left="2880"/g) || []).length === 0, 'QA repair clears huge left margin')
assert(!/<w:textDirection\b/.test(geoOut), 'QA repair strips textDirection')
assert(geoEnsured.repaired, 'mandatory layout repair always runs')

// --- Permanent: vertical "Business" sidebar + mashed skills categories ---
const verticalBusinessBody = [
  '<w:p><w:r><w:t>SHAHEDA AFRIDE</w:t></w:r></w:p>',
  '<w:tbl>',
  '<w:tblGrid><w:gridCol w:w="480"/><w:gridCol w:w="8500"/></w:tblGrid>',
  '<w:tr>',
  '<w:tc><w:tcPr><w:tcW w:w="480" w:type="dxa"/><w:textDirection w:val="btLr"/></w:tcPr>',
  '<w:p><w:r><w:t>Business</w:t></w:r></w:p></w:tc>',
  '<w:tc><w:tcPr><w:tcW w:w="8500" w:type="dxa"/></w:tcPr>',
  '<w:p><w:r><w:t>PROFESSIONAL SUMMARY</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Business Analyst with 4+ years delivering ERP and healthcare programs.</w:t></w:r></w:p>',
  '</w:tc></w:tr></w:tbl>',
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>TECHNICAL SKILLS</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Documentation: BRD, FRD, User Stories, Use Cases and Wireframes BI and Reporting Tools: Power BI, Tableau Database: SQL, MySQL</w:t></w:r></w:p>',
  '<w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>',
].join('')

const verticalXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${verticalBusinessBody}</w:body></w:document>`
assert(findGeometryDefects(verticalXml).some((d) => d.code === 'narrow_table_col'), 'detects Business sidebar skinny col')
assert(findGeometryDefects(verticalXml).some((d) => d.code === 'skills_mashed'), 'detects mashed skills categories')

const verticalFixed = normalizeDocxGeometry(verticalXml)
assert(!/<w:textDirection\b/.test(verticalFixed), 'vertical Business textDirection stripped')
assert(!/w:w="480"/.test(verticalFixed), '480-twip Business column widened or cleared')
assert(verticalFixed.includes('Documentation:'), 'Documentation category preserved')
assert(verticalFixed.includes('BI and Reporting Tools:'), 'BI category preserved')
// Mashed line must become separate paragraphs
const skillParas = [...verticalFixed.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
  .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
  .filter((t) => /Documentation:|Reporting Tools:|Database:/.test(t))
assert(skillParas.length >= 2, 'mashed skills split into multiple paragraphs')
assert(!findGeometryDefects(verticalFixed).some((d) => d.code === 'skills_mashed'), 'skills mash cleared after normalize')

const verticalBuf = makeDocx(verticalBusinessBody)
const verticalQa = ensureEnhancedResumeQuality(
  verticalBuf,
  verticalBuf,
  { name: 'Shaheda', experience: [{ company: 'Client' }] },
  { maxAttempts: 2 },
)
const verticalOut = new PizZip(verticalQa.buffer).file('word/document.xml').asText()
assert(verticalQa.repaired, 'permanent repair ran for Business sidebar resume')
assert(!/<w:textDirection\b/.test(verticalOut), 'QA path strips textDirection')
assert(!/w:w="480"/.test(verticalOut), 'QA path clears 480-twip column')
assert(verticalOut.includes('Business'), 'Business label text preserved')

console.log('ALL QA TESTS PASSED')
