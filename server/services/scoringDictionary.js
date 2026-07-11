/**
 * Controlled synonym / normalization dictionary for deterministic Resume↔JD scoring.
 * Canonical form is always lowercase, punctuation-stripped where noted.
 */

/** Map alias → canonical term */
export const SKILL_ALIASES = {
  jira: 'jira',
  'atlassian jira': 'jira',
  powerbi: 'power bi',
  'power-bi': 'power bi',
  'power bi': 'power bi',
  'ms power bi': 'power bi',
  brd: 'business requirements document',
  brds: 'business requirements document',
  'business requirement document': 'business requirements document',
  'business requirement documents': 'business requirements document',
  'business requirements documents': 'business requirements document',
  'business requirements document': 'business requirements document',
  frd: 'functional requirements document',
  frds: 'functional requirements document',
  'functional requirement document': 'functional requirements document',
  'functional requirements document': 'functional requirements document',
  uat: 'user acceptance testing',
  'user acceptance testing': 'user acceptance testing',
  'acceptance testing': 'user acceptance testing',
  'requirements elicitation': 'requirements gathering',
  'requirements gathering': 'requirements gathering',
  'elicit requirements': 'requirements gathering',
  'gather requirements': 'requirements gathering',
  'stakeholder management': 'stakeholder engagement',
  'stakeholder engagement': 'stakeholder engagement',
  'stakeholder communication': 'stakeholder engagement',
  'user stories': 'user stories',
  'user story': 'user stories',
  'product backlog': 'product backlog',
  backlog: 'product backlog',
  'agile methodology': 'agile',
  'agile methodologies': 'agile',
  scrum: 'scrum',
  'process flows': 'process flow',
  'process flow': 'process flow',
  'process mapping': 'process flow',
  'process maps': 'process flow',
  'workflow diagrams': 'process flow',
  'workflow diagram': 'process flow',
  'business process modeling': 'process flow',
  bpmn: 'process flow',
  sql: 'sql',
  'ms sql': 'sql',
  'sql server': 'sql',
  't-sql': 'sql',
  excel: 'excel',
  'microsoft excel': 'excel',
  'ms excel': 'excel',
  confluence: 'confluence',
  sharepoint: 'sharepoint',
  'share point': 'sharepoint',
  visio: 'visio',
  'microsoft visio': 'visio',
  'ms visio': 'visio',
  tableau: 'tableau',
  'azure devops': 'azure devops',
  azdo: 'azure devops',
  'ado': 'azure devops',
  postman: 'postman',
  'gap analysis': 'gap analysis',
  'as-is to-be': 'gap analysis',
  'wireframes': 'wireframing',
  wireframing: 'wireframing',
  'mockups': 'wireframing',
  sdlc: 'sdlc',
  'software development life cycle': 'sdlc',
  'software development lifecycle': 'sdlc',
  'defect management': 'defect investigation',
  'defect investigation': 'defect investigation',
  'bug triage': 'defect investigation',
  'business rules': 'business rules',
  'document business rules': 'business rules',
  'data analysis': 'data analysis',
  'data analytics': 'data analysis',
  'api': 'api',
  'rest api': 'api',
  'restful api': 'api',
  'ms office': 'microsoft office',
  'microsoft office': 'microsoft office',
  'office 365': 'microsoft office',
  'microsoft 365': 'microsoft office',
}

/** Responsibility phrase → related concept tokens / aliases for semantic coverage */
export const RESPONSIBILITY_ALIASES = [
  {
    concepts: ['gather requirements', 'requirements gathering', 'elicit requirements', 'requirements elicitation'],
    evidence: ['gathered requirements', 'elicited requirements', 'requirements gathering', 'requirement elicitation', 'collected requirements', 'captured requirements'],
  },
  {
    concepts: ['create user stories', 'write user stories', 'user stories'],
    evidence: ['user stories', 'user story', 'acceptance criteria', 'story mapping'],
  },
  {
    concepts: ['facilitate stakeholder meetings', 'stakeholder meetings', 'stakeholder engagement'],
    evidence: ['stakeholder', 'facilitated meetings', 'workshop', 'cross-functional', 'business partners'],
  },
  {
    concepts: ['manage product backlog', 'product backlog', 'backlog grooming', 'backlog refinement'],
    evidence: ['product backlog', 'backlog', 'prioritized', 'grooming', 'refinement'],
  },
  {
    concepts: ['perform uat', 'user acceptance testing', 'lead acceptance testing', 'assist with acceptance testing'],
    evidence: ['uat', 'user acceptance', 'acceptance testing', 'test scenarios', 'test cases'],
  },
  {
    concepts: ['document business rules', 'business rules documentation'],
    evidence: ['business rules', 'business rule', 'documented rules', 'rule documentation'],
  },
  {
    concepts: ['support defect investigation', 'defect investigation', 'defect management'],
    evidence: ['defect', 'bug', 'triage', 'root cause', 'issue resolution', 'defect closure'],
  },
  {
    concepts: ['create process flows', 'process flow modeling', 'process maps', 'workflow diagrams', 'story mapping'],
    evidence: ['process flow', 'process map', 'workflow', 'bpmn', 'visio', 'diagram', 'story mapping'],
  },
  {
    concepts: ['create brd', 'prepare brd', 'business requirements document', 'document business and functional requirements'],
    evidence: ['brd', 'frd', 'business requirements', 'functional requirements', 'requirements document'],
  },
  {
    concepts: ['gap analysis', 'as-is to-be analysis'],
    evidence: ['gap analysis', 'as-is', 'to-be', 'current state', 'future state'],
  },
]

/** Known tools / technologies (canonical) */
export const KNOWN_TOOLS = new Set([
  'jira', 'confluence', 'sql', 'power bi', 'tableau', 'excel', 'sharepoint', 'visio',
  'azure devops', 'postman', 'microsoft office', 'salesforce', 'servicenow', 'slack',
  'teams', 'figma', 'miro', 'draw.io', 'lucidchart', 'snowflake', 'databricks',
  'python', 'r', 'alteryx', 'qlik', 'looker', 'google analytics', 'selenium',
  'cucumber', 'testrail', 'zephyr', 'hp alm', 'jenkins', 'git', 'github', 'gitlab',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'splunk', 'dynatrace',
])

/** Stop / filler words to exclude from keyword extraction */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'will', 'can', 'may',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'you', 'our', 'your', 'they',
  'their', 'have', 'has', 'had', 'do', 'does', 'did', 'not', 'no', 'yes', 'all',
  'any', 'some', 'such', 'than', 'then', 'also', 'into', 'over', 'after', 'before',
  'about', 'up', 'out', 'if', 'when', 'while', 'who', 'what', 'which', 'how', 'why',
  'equal', 'opportunity', 'employer', 'salary', 'benefits', 'remote', 'hybrid',
  'location', 'based', 'please', 'apply', 'join', 'team', 'company', 'role', 'job',
  'position', 'candidate', 'candidates', 'looking', 'seeking', 'ideal', 'must',
  'should', 'including', 'include', 'etc', 'using', 'used', 'use', 'work', 'working',
  'experience', 'years', 'year', 'strong', 'ability', 'able', 'knowledge', 'understanding',
])

/** Marketing / benefits phrases to strip from JD keyword extraction */
export const JD_NOISE_PATTERNS = [
  /equal opportunity[\s\S]{0,120}/gi,
  /competitive salary[\s\S]{0,80}/gi,
  /benefits (include|package)[\s\S]{0,200}/gi,
  /we are (an? )?(equal|eeo)[\s\S]{0,120}/gi,
  /401\s*\(?k\)?/gi,
  /health (insurance|benefits)/gi,
  /paid time off|pto\b/gi,
  /work from home|remote[- ]friendly/gi,
]
