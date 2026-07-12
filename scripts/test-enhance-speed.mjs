/**
 * End-to-end speed/token acceptance test for the optimized enhance pipeline.
 *
 * Run: node scripts/test-enhance-speed.mjs
 *
 * Requires OPENAI_API_KEY (or another configured provider) in .env
 */
import 'dotenv/config'
import { generateResumeDocx } from '../server/services/resumeDocxGenerator.js'
import { createSession, getSession } from '../server/store/sessionStore.js'
import { createEnhanceJob, getEnhanceJob } from '../server/store/enhanceJobStore.js'
import { runEnhanceJob } from '../server/services/enhanceWorker.js'
import { parseResumeLocally } from '../server/services/localResumeParse.js'
import { extractResumeText } from '../server/services/resumeExtract.js'
import { cleanJobDescription } from '../server/services/jdCleaner.js'

const SAMPLE_RESUME = {
  name: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  phone: '555-0100',
  location: 'Austin, TX',
  role: 'Business Analyst',
  summary:
    'Business Analyst with 6+ years delivering requirements, UAT, and stakeholder alignment in healthcare and enterprise programs.',
  summaryBullets: [],
  skillCategories: [
    {
      category: 'Tools & Platforms',
      skills: ['Jira', 'Confluence', 'SQL', 'Excel', 'Visio'],
    },
    {
      category: 'Methods',
      skills: ['Agile', 'Requirements Gathering', 'UAT', 'SDLC'],
    },
  ],
  skills: ['Jira', 'Confluence', 'SQL', 'Excel', 'Visio', 'Agile', 'Requirements Gathering', 'UAT', 'SDLC'],
  experience: [
    {
      company: 'Cigna Healthcare',
      title: 'Business Analyst',
      startDate: 'Jan 2021',
      endDate: 'Present',
      bullets: [
        'Gathered business requirements and prepared BRDs for healthcare claims workflows.',
        'Created user stories and acceptance criteria in Jira for cross-functional delivery teams.',
        'Coordinated UAT activities by preparing test scenarios and supporting defect closure.',
        'Facilitated stakeholder workshops with business and IT partners.',
      ],
    },
    {
      company: 'Lambda Therapeutic Research',
      title: 'Business Analyst',
      startDate: 'Jun 2018',
      endDate: 'Dec 2020',
      bullets: [
        'Documented business rules for laboratory data products.',
        'Created process maps and workflow diagrams for operational improvements.',
        'Partnered with QA to validate release criteria before production cutover.',
      ],
    },
  ],
  education: [
    {
      school: 'State University',
      degree: 'B.S.',
      course: 'Information Systems',
      startDate: '2014',
      endDate: '2018',
    },
  ],
}

const SAMPLE_JD = `
Job Title: Senior Business Analyst

Location: Remote - United States
Salary: $120,000 - $145,000 per year
Benefits: Health insurance, 401(k), PTO, gym membership, and flexible holidays.

About Us:
We are a fast-paced equal opportunity employer committed to diversity and inclusion.
Our mission is to transform healthcare delivery worldwide.

Responsibilities:
- Gather and document business requirements from stakeholders
- Write user stories and acceptance criteria in Jira
- Facilitate UAT and defect triage with QA and engineering
- Create process flows and BRDs for regulated healthcare programs
- Partner with product owners on backlog prioritization
- Analyze SQL datasets to validate business rules

Required Qualifications:
- 5+ years as a Business Analyst
- Strong experience with Jira, Confluence, SQL, and Agile
- Experience writing BRDs and facilitating UAT
- Stakeholder management in cross-functional teams
- Visio or similar process mapping tools

Preferred Qualifications:
- Power BI dashboards
- Tableau reporting
- Healthcare domain experience
- Familiarity with SDLC and compliance

Tools: Jira, Confluence, SQL, Excel, Visio, Power BI, Tableau

How to Apply:
Please submit your resume and cover letter through our careers portal.
We are an equal opportunity employer. All qualified applicants will receive consideration
without regard to race, color, religion, sex, or national origin.
Legal disclaimer: background checks may be required.
`

function printReport(meta, comparisonBefore, comparisonAfter) {
  console.log('\n========== ENHANCE SPEED / TOKEN REPORT ==========')
  console.log(`Total time:        ${meta.durationSec}s (${meta.durationMs}ms)`)
  console.log(`LLM calls:         ${meta.llmCalls}`)
  console.log(`Resume parse:      ${meta.resumeParseMethod} (confidence=${meta.resumeParseConfidence})`)
  console.log(`JD analysis:       ${meta.jdAnalysisCached ? 'CACHE' : 'LLM'}`)
  console.log(`Plan repaired:     ${meta.planRepaired}`)
  console.log('--- Stages ---')
  for (const s of meta.stages || []) {
    console.log(`  ${String(s.name).padEnd(28)} ${String(s.ms).padStart(6)}ms  (at ${s.atMs}ms)`)
  }
  console.log('--- Token usage ---')
  const t = meta.tokenUsage || {}
  console.log(`  Prompt tokens:      ${t.promptTokens}`)
  console.log(`  Completion tokens:  ${t.completionTokens}`)
  console.log(`  Cached input:       ${t.cachedInputTokens}`)
  console.log(`  Est. cost USD:      $${t.costUsd}`)
  for (const c of t.calls || []) {
    console.log(
      `  • ${c.task}: ${c.provider}/${c.model} `
      + `in=${c.promptTokens} out=${c.completionTokens} cached=${c.cachedInputTokens} `
      + `${c.durationMs}ms $${c.costUsd}`,
    )
  }
  console.log('--- Scores ---')
  console.log(`  Before ATS: ${comparisonBefore?.atsScore}`)
  console.log(`  After ATS:  ${comparisonAfter?.atsScore}`)
  console.log('--- Acceptance ---')
  const checks = [
    ['≤2 LLM calls', meta.llmCalls <= 2, meta.llmCalls],
    ['no repair', !meta.planRepaired, meta.planRepaired],
    ['input < 6000', (t.promptTokens || 0) < 6000, t.promptTokens],
    ['completion < 1800', (t.completionTokens || 0) < 1800, t.completionTokens],
    ['time < 35s', (meta.durationSec || 99) < 35, meta.durationSec],
    ['local resume parse (or cache)', meta.resumeParseMethod === 'local' || meta.resumeParseMethod === 'cached', meta.resumeParseMethod],
  ]
  let ok = true
  for (const [label, pass, value] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}  (got: ${value})`)
    if (!pass) ok = false
  }
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  console.log('=================================================\n')
  return ok
}

async function main() {
  console.log('Building sample DOCX…')
  const buffer = await generateResumeDocx(SAMPLE_RESUME, 'classic-blue')
  const text = await extractResumeText(buffer, 'docx')
  const local = parseResumeLocally(text)
  console.log(`Local parse confidence: ${local.confidence}`)
  console.log(`Local companies: ${(local.data.experience || []).map((e) => e.company).join(' | ')}`)
  console.log(`Cleaned JD length: ${cleanJobDescription(SAMPLE_JD).length} (raw ${SAMPLE_JD.length})`)

  const session = createSession('alex-rivera-ba.docx', 'docx', buffer)
  const job = createEnhanceJob(session.sessionId)

  console.log(`Running enhance job ${job.jobId}…`)
  const wall0 = Date.now()
  await runEnhanceJob(job.jobId, session.sessionId, SAMPLE_JD)
  console.log(`Wall clock: ${Date.now() - wall0}ms`)

  const done = getEnhanceJob(job.jobId)
  if (done.status !== 'completed') {
    console.error('Job failed:', done.error)
    process.exit(1)
  }

  const sess = getSession(session.sessionId)
  const meta = done.result.processingMeta
  const ok = printReport(meta, done.result.comparisonBefore, done.result.comparison)

  // Second run with same JD should cache JD analysis (≤1 LLM call for plan only)
  console.log('\n--- Second run (JD cache expected) ---')
  const session2 = createSession('alex-rivera-ba-2.docx', 'docx', buffer)
  const job2 = createEnhanceJob(session2.sessionId)
  await runEnhanceJob(job2.jobId, session2.sessionId, SAMPLE_JD)
  const done2 = getEnhanceJob(job2.jobId)
  if (done2.status === 'completed') {
    const m2 = done2.result.processingMeta
    console.log(
      `Run2: LLM=${m2.llmCalls} jdCached=${m2.jdAnalysisCached} `
      + `in=${m2.tokenUsage.promptTokens} out=${m2.tokenUsage.completionTokens} ${m2.durationSec}s`,
    )
    if (!m2.jdAnalysisCached) {
      console.warn('WARN: expected JD cache hit on second run')
    }
    if (m2.llmCalls > 1) {
      console.warn(`WARN: expected ≤1 LLM call on cached-JD run, got ${m2.llmCalls}`)
    }
  }

  console.log(`Session ATS after: ${sess.atsScore}`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
