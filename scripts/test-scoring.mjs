/**
 * Acceptance tests for ATS-style 40/40/20 Resume-to-JD scoring.
 * Run: node scripts/test-scoring.mjs
 */
import {
  compareResumeToJD,
  buildEnhancedResumeData,
  buildScoreComparison,
} from '../server/services/compareService.js'

const baJd = {
  roleTitle: 'Business Analyst',
  requiredSkills: [
    'Requirements Gathering',
    'User Stories',
    'JIRA',
    'User Acceptance Testing',
    'BRD',
    'Stakeholder Management',
    'SQL',
    'Agile',
  ],
  preferredSkills: ['Power BI', 'Tableau'],
  toolsTechnologies: ['Jira', 'Confluence', 'SQL', 'Excel', 'Visio', 'Power BI'],
  responsibilities: [
    'Gather requirements from stakeholders',
    'Create user stories and acceptance criteria',
    'Facilitate stakeholder meetings',
    'Manage product backlog',
    'Perform UAT and support defect investigation',
    'Document business rules',
    'Create process flows and workflow diagrams',
  ],
  mustHaveKeywords: ['requirements', 'UAT', 'user stories', 'stakeholders', 'Agile'],
  domainKeywords: ['healthcare', 'compliance', 'SDLC'],
  niceToHaveKeywords: ['Power BI', 'process improvement'],
}

const originalResume = {
  name: 'Cherpalli Shiva Kumar',
  email: 'shiva@example.com',
  phone: '555-0100',
  location: 'USA',
  summary: 'Business Analyst with 6+ years of experience in healthcare and regulated environments. Skilled in requirements gathering, stakeholder engagement, and SDLC delivery.',
  skills: ['Requirements Gathering', 'JIRA', 'SQL', 'Agile', 'Excel', 'SDLC'],
  technicalSkills: ['JIRA', 'SQL', 'Excel', 'Confluence'],
  experience: [
    {
      company: 'Cigna Healthcare',
      title: 'Business Analyst',
      startDate: '2021',
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
      startDate: '2018',
      endDate: '2021',
      bullets: [
        'Documented business rules for laboratory data products.',
        'Created process maps and workflow diagrams for operational improvements.',
      ],
    },
  ],
  education: [{ degree: 'B.S. Information Systems', school: 'University' }],
  projects: [],
}

const applied = {
  skills: [
    { skill: 'Power BI', category: 'Tools' },
    { skill: 'Visio', category: 'Tools' },
    { skill: 'Kubernetes', category: 'Tools' }, // unsupported — should not score + penalty
  ],
  summary: {
    added: [],
    rewritten: [
      {
        text: 'Business Analyst with 6+ years in healthcare delivering requirements, UAT, and Agile backlog outcomes that improve compliance and stakeholder alignment.',
      },
    ],
  },
  experience: {
    'Cigna Healthcare': {
      added: [
        'Managed product backlog prioritization with product owners to align sprint delivery to business value.',
      ],
      rewritten: [],
    },
    'Lambda Therapeutic Research': {
      added: [],
      rewritten: [],
    },
  },
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

function run() {
  console.log('=== ATS 40/40/20 scoring acceptance tests ===\n')

  const before = compareResumeToJD(originalResume, baJd)
  const before2 = compareResumeToJD(originalResume, baJd)
  assert(before.atsScore === before2.atsScore, 'same input must return same score')
  assert(JSON.stringify(before.report.categories) === JSON.stringify(before2.report.categories), 'categories must be deterministic')

  console.log(`Original score: ${before.atsScore}`)
  console.log('Categories:', before.report.categories)
  console.log('Weights:', before.scoreBreakdown.weights)
  console.log('Reasons:', before.report.scoringReasons.join('\n  '))

  assert(before.atsScore >= 0 && before.atsScore <= 100, 'score in 0–100')
  assert(before.atsScore >= 40 && before.atsScore <= 95, `original score realistic (got ${before.atsScore})`)

  // Pillar maxes
  assert(before.scoreBreakdown.skills.max === 24, 'skills max 24')
  assert(before.scoreBreakdown.keywords.max === 16, 'keywords max 16')
  assert(before.scoreBreakdown.bullets.max === 40, 'experience max 40')
  assert(before.scoreBreakdown.format.max === 20, 'format max 20')

  const catSum = Object.values(before.report.categories).reduce((s, c) => s + c.score, 0)
  const expectedRaw = Math.round(catSum * 10) / 10
  assert(
    Math.abs(before.report.rawTotal - expectedRaw) < 0.2,
    `rawTotal ${before.report.rawTotal} should equal category sum ${expectedRaw}`,
  )
  assert(
    Math.abs(catSum - (before.scoreBreakdown.skills.score
      + before.scoreBreakdown.keywords.score
      + before.scoreBreakdown.bullets.score
      + before.scoreBreakdown.format.score)) < 0.2,
    'UI pillars must sum to category total',
  )

  // Skills ∩ Keywords must be empty (ignore title-alignment row)
  const skillItems = new Set(
    (before.scoreBreakdown.details.skills || []).map((d) => String(d.item).toLowerCase()),
  )
  const kwItems = (before.scoreBreakdown.details.keywords || [])
    .filter((d) => !/job title alignment/i.test(d.item))
    .map((d) => String(d.item).toLowerCase())
  const overlap = kwItems.filter((k) => skillItems.has(k))
  assert(overlap.length === 0, `Skills/Keywords must be disjoint (overlap: ${overlap.join(', ')})`)

  // Duplicate skill adds zero points
  const dupResume = {
    ...originalResume,
    skills: [...originalResume.skills, 'JIRA', 'JIRA', 'jira'],
  }
  const dupScore = compareResumeToJD(dupResume, baJd)
  assert(dupScore.scoreBreakdown.skills.score === before.scoreBreakdown.skills.score, 'duplicate skills add zero points')

  // Rewrite without coverage change → zero increase for that bullet alone
  const rewriteOnly = {
    skills: [],
    summary: { added: [], rewritten: [] },
    experience: {
      'Cigna Healthcare': {
        added: [],
        rewritten: [
          {
            text: 'Gathered business requirements and prepared BRDs for healthcare claims workflows with clearer wording.',
          },
        ],
      },
    },
  }
  const rewriteData = buildEnhancedResumeData(originalResume, rewriteOnly)
  const rewriteScore = compareResumeToJD(rewriteData, baJd)
  assert(
    Math.abs(rewriteScore.atsScore - before.atsScore) <= 1,
    `rewrite without new coverage should not meaningfully increase score (${before.atsScore}→${rewriteScore.atsScore})`,
  )

  // Enhanced with real coverage improvements
  const enhanced = buildEnhancedResumeData(originalResume, applied)
  const after = compareResumeToJD(enhanced, baJd, { applied })
  const comparison = buildScoreComparison(before, after)

  console.log(`\nEnhanced score: ${after.atsScore} (Δ ${comparison.improvement})`)
  console.log('Breakdown:', JSON.stringify(comparison.breakdown, null, 2))
  console.log('Penalties:', after.penalties)

  assert(after.atsScore >= before.atsScore, 'enhanced score should not drop when coverage improves')
  assert(
    comparison.breakdown.experience.change >= 0,
    'backlog bullet should help experience or leave unchanged',
  )
  assert(
    after.penalties.some((p) => p.type === 'unsupported_tool'),
    'unsupported Kubernetes tool must create a penalty',
  )
  assert(
    !after.report.matchedTools.map((t) => t.toLowerCase()).includes('kubernetes'),
    'unsupported tools must not receive match credit',
  )

  // Format unchanged when structure preserved
  assert(
    comparison.breakdown.format.change === 0,
    'format should be unchanged when formatting preserved',
  )

  // Evidence present for matched items
  assert(after.report.evidence.length > 0, 'evidence list required')
  assert(after.report.scoringReasons.length >= 5, 'scoring reasons required')

  // Skills-only stuffing should not get full hard-skill credit
  const stuffed = {
    ...originalResume,
    skills: [...originalResume.skills, 'Visio', 'Power BI', 'Tableau'],
    technicalSkills: [...originalResume.technicalSkills, 'Visio', 'Power BI', 'Tableau'],
    experience: originalResume.experience.map((e) => ({
      ...e,
      bullets: (e.bullets || []).filter((b) => !/visio|power bi|tableau/i.test(b)),
    })),
  }
  const stuffedScore = compareResumeToJD(stuffed, baJd)
  const visioDetail = (stuffedScore.scoreBreakdown.details.skills || [])
    .find((d) => /visio/i.test(d.item))
  if (visioDetail?.matched) {
    assert(!visioDetail.strong, 'skills-list-only tool must not be strong/full credit')
  }

  const afterCatSum = Object.values(after.report.categories).reduce((s, c) => s + c.score, 0)
  assert(
    after.atsScore <= Math.ceil(afterCatSum) && after.atsScore >= 0,
    'final score bounded by category sum and penalties',
  )

  console.log('\nALL ACCEPTANCE CHECKS PASSED')
}

run()
