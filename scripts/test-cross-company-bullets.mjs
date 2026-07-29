import PizZip from 'pizzip'
import {
  patchDocx,
  dedupeExperienceAdditionsAcrossCompanies,
  mergeExperienceAdditions,
  bulletClaimsOtherCompany,
} from '../server/services/docxService.js'
import { classifyEnhancerIssue } from '../server/services/layoutIssueService.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  console.log('ok:', msg)
}

const companies = ['Cerebrone.ai', 'Capgemini']
const bad = 'As Forward Deployed Engineer at Cerebrone.ai United States, delivered Lead complex software deployments.'
assert(bulletClaimsOtherCompany(bad, 'Capgemini', companies), 'flags Cerebrone claim under Capgemini')
assert(!bulletClaimsOtherCompany(bad, 'Cerebrone.ai', companies), 'allows Cerebrone claim under Cerebrone')

let plan = {
  experienceAdditions: [
    { company: 'Cerebrone.ai United States', bullets: [bad, bad] },
    { company: 'Capgemini', bullets: [bad, 'Mentored juniors on CI/CD with Jenkins.'] },
  ],
  summaryBullets: [],
  bulletRewrites: [],
  skillsByCategory: [],
  skillsToAdd: [],
}
const resumeData = {
  experience: [
    { company: 'Cerebrone.ai', title: 'Forward Deployed Engineer / Applied AI Engineer', bullets: ['Built AI apps.'] },
    { company: 'Capgemini', title: 'Software Engineer', bullets: ['Supported CI/CD.'] },
  ],
}
plan = mergeExperienceAdditions(plan, resumeData)
plan = dedupeExperienceAdditionsAcrossCompanies(plan, resumeData)
const cere = plan.experienceAdditions.find((e) => e.company === 'Cerebrone.ai')
const cap = plan.experienceAdditions.find((e) => e.company === 'Capgemini')
assert(cere?.bullets?.length === 1, 'Cerebrone keeps one copy')
assert(!cap?.bullets?.some((b) => /Cerebrone/i.test(b)), 'Capgemini drops Cerebrone bullet')
assert(cap?.bullets?.length === 1, 'Capgemini keeps mentorship bullet')

const bulletA = (text) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
  + `<w:ind w:left="720" w:hanging="360"/></w:pPr>`
  + `<w:r><w:t>${text}</w:t></w:r></w:p>`

const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>WORK EXPERIENCE</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Forward Deployed Engineer — Cerebrone.ai</w:t></w:r></w:p>`
  + bulletA('Built AI applications for enterprise clients.')
  + `<w:p><w:r><w:t>Software Engineer — Capgemini</w:t></w:r></w:p>`
  + bulletA('Supported CI/CD pipelines and deployments.')
  + `<w:p><w:r><w:t>EDUCATION</w:t></w:r></w:p>`
  + `<w:sectPr/></w:body></w:document>`

const zip = new PizZip()
zip.file('word/document.xml', xml)
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
const buf = zip.generate({ type: 'nodebuffer' })

const dirtyPlan = {
  summaryBullets: [],
  experienceAdditions: [
    { company: 'Cerebrone.ai', bullets: [bad] },
    { company: 'Capgemini', bullets: [bad] },
  ],
  bulletRewrites: [],
  skillsToAdd: [],
}
const { buffer, applied } = patchDocx(buf, dirtyPlan, { highlight: true, resumeData })
const out = new PizZip(buffer).file('word/document.xml').asText()
const count = (out.match(/Lead complex software deployments/g) || []).length
assert(count === 1, `patched DOCX has Cerebrone bullet once (got ${count})`)
const capIdx = out.indexOf('Capgemini')
const cereBulletIdx = out.indexOf('Lead complex software deployments')
assert(cereBulletIdx < capIdx, 'Cerebrone bullet stays above Capgemini header')
assert((applied.experience.Capgemini?.added || []).length === 0, 'Capgemini applied.added empty')

const classified = classifyEnhancerIssue('in the screenshot, one same bullet added in two companies')
assert(classified.codes.includes('duplicate_bullet'), 'classifies duplicate bullet reports')
assert(classified.strategy === 'content_rebuild' || classified.strategy === 'full_rebuild', 'duplicate uses content strategy')

const general = classifyEnhancerIssue('something looks off in the enhanced resume')
assert(general.focus === 'general_enhancer', 'unknown messages use full enhancer repair')
assert(general.strategy === 'full_rebuild', 'unknown → full rebuild')

const layoutOnly = classifyEnhancerIssue('blank page after experience section')
assert(layoutOnly.strategy === 'layout_repair', 'blank page uses layout repair')

const garbled = classifyEnhancerIssue('garbled bullet text that does not make sense')
assert(garbled.codes.includes('garbled_bullet'), 'classifies garbled bullets')

console.log('ALL PASSED')
