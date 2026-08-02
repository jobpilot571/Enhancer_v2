/**
 * Fake demo resume used for template picker previews (admin-seeded DOCX samples).
 * All details are fictional — safe for public gallery display.
 */
export const DEMO_SAMPLE_RESUME = {
  name: 'Alex Morgan',
  title: 'Business Analyst',
  role: 'Business Analyst',
  email: 'alex.morgan@email.com',
  phone: '(555) 123-4567',
  location: 'Austin, TX',
  city: 'Austin',
  state: 'TX',
  linkedin: 'linkedin.com/in/alexmorgan',
  summary:
    'Business analyst with 5+ years translating stakeholder needs into clear requirements, data models, and delivery plans across SaaS and analytics programs.',
  summaryBullets: [
    'Partnered with product and engineering to define requirements and acceptance criteria for customer facing analytics initiatives across multiple release cycles.',
    'Built SQL and Power BI reporting that improved decision speed for operations leaders while keeping data definitions consistent across teams.',
    'Led discovery workshops and process mapping sessions that reduced delivery rework and clarified ownership between business and technology partners.',
    'Translated complex data workflows into stakeholder ready documentation covering sources, transformations, quality checks, and handoff points.',
    'Supported sprint planning and backlog grooming so high impact stories stayed aligned to measurable business outcomes.',
    'Mentored junior analysts on requirements writing, stakeholder communication, and practical data validation habits.',
  ],
  skills: [
    'SQL', 'Power BI', 'Excel', 'Python', 'Jira', 'Confluence', 'Agile', 'Tableau', 'ETL', 'Requirements',
  ],
  technicalSkills: [
    'SQL', 'Power BI', 'Excel', 'Python', 'Jira', 'Confluence', 'Tableau', 'ETL',
  ],
  skillCategories: [
    { category: 'Analysis & Reporting', skills: ['SQL', 'Power BI', 'Excel', 'Tableau'] },
    { category: 'Delivery & Collaboration', skills: ['Jira', 'Confluence', 'Agile', 'Stakeholder Management'] },
    { category: 'Data & Integration', skills: ['ETL', 'Python', 'Data Validation', 'Requirements'] },
  ],
  keywords: ['SQL', 'Power BI', 'Jira', 'Agile', 'ETL'],
  experience: [
    {
      company: 'Northstar Tech',
      title: 'Business Analyst',
      location: 'Austin, TX',
      city: 'Austin',
      state: 'TX',
      dates: 'Jan 2022 - Present',
      startDate: 'Jan 2022',
      endDate: 'Present',
      bullets: [
        'Owned end to end requirements for a customer insights dashboard used by sales and success teams, coordinating SQL models, Power BI visuals, and acceptance testing with engineering partners.',
        'Facilitated weekly discovery with product managers and domain leads to prioritize backlog items, clarify edge cases, and keep releases tied to measurable adoption goals.',
        'Designed process maps and data contracts for an ETL handoff that cut reporting defects and shortened monthly close review cycles for operations stakeholders.',
        'Created user stories, acceptance criteria, and test scenarios in Jira that improved sprint predictability and reduced clarification churn during development.',
        'Partnered with analytics engineering to document source systems, transformation rules, and quality checks so self service reporting stayed trustworthy.',
        'Presented roadmap tradeoffs and delivery risks to leadership with clear options, impact estimates, and recommended next steps.',
        'Coached stakeholders on reading dashboards and interpreting KPI definitions so teams acted on the same trusted metrics.',
        'Supported UAT and production readiness reviews, tracking open issues through resolution before each major release.',
      ],
    },
    {
      company: 'BrightPath Inc',
      title: 'Junior Analyst',
      location: 'Dallas, TX',
      city: 'Dallas',
      state: 'TX',
      dates: 'Jun 2020 - Dec 2021',
      startDate: 'Jun 2020',
      endDate: 'Dec 2021',
      bullets: [
        'Built recurring Excel and SQL reports for finance and operations stakeholders, improving turnaround time for weekly KPI packages.',
        'Documented as is and to be workflows for onboarding and billing support processes used by cross functional delivery teams.',
        'Assisted senior analysts with requirements workshops, note taking, and follow up actions that kept vendors and internal owners aligned.',
        'Validated report outputs against source extracts and flagged data quality issues before leadership reviews.',
        'Maintained Confluence pages for glossary terms, ownership contacts, and reporting schedules used by new team members.',
        'Supported Agile ceremonies by preparing backlog notes and clarifying acceptance details for assigned stories.',
      ],
    },
  ],
  education: [
    {
      school: 'State University',
      degree: 'B.S. in Information Systems',
      dates: '2016 - 2020',
      startDate: 'Aug 2016',
      endDate: 'May 2020',
      location: 'Austin, TX',
    },
  ],
}

/** Templates that get auto-seeded demo samples (same catalog as admin). */
export const JD_DEMO_TEMPLATE_IDS = [
  'classic-blue',
  'classic-serif',
  'modern-data',
  'analyst-blue',
  'technical-black',
  'teal-banner',
  'navy-executive',
  'minimal-gray',
  'emerald-accent',
  'compact-ats',
  'indigo-modern',
  'charcoal-pro',
  'jd-classic',
]
