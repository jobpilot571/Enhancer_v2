/** Role-based skill catalogs + keyword expansions for typeahead. */

const ROLE_SKILLS = {
  'business analyst': [
    'Jira', 'Confluence', 'Azure DevOps', 'SQL', 'Power BI', 'Tableau', 'Excel',
    'BRD', 'FRD', 'User Stories', 'Agile', 'Scrum', 'UAT', 'MS Visio', 'Lucidchart',
    'Stakeholder Management', 'Gap Analysis', 'BPMN', 'SharePoint', 'Requirements Gathering',
  ],
  'data analyst': [
    'SQL', 'Python', 'Power BI', 'Tableau', 'Excel', 'Pandas', 'NumPy', 'R',
    'DAX', 'Looker', 'Google Data Studio', 'Statistics', 'A/B Testing', 'ETL',
  ],
  'data engineer': [
    'Python', 'SQL', 'Spark', 'Airflow', 'AWS', 'Azure', 'Snowflake', 'Databricks',
    'Kafka', 'dbt', 'ETL', 'ELT', 'Docker', 'Kubernetes', 'CI/CD', 'Jenkins', 'GitHub Actions',
  ],
  'software engineer': [
    'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL',
    'Git', 'Docker', 'Kubernetes', 'CI/CD', 'Jenkins', 'GitHub Actions', 'AWS', 'REST APIs',
  ],
  'devops': [
    'CI/CD', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'Docker', 'Kubernetes',
    'Terraform', 'Ansible', 'AWS', 'Azure', 'Prometheus', 'Grafana', 'Linux', 'Bash',
  ],
  'project manager': [
    'Jira', 'Confluence', 'MS Project', 'Agile', 'Scrum', 'Kanban', 'Risk Management',
    'Stakeholder Management', 'Roadmapping', 'Budgeting', 'Slack', 'Asana',
  ],
  'product manager': [
    'Jira', 'Confluence', 'Figma', 'A/B Testing', 'SQL', 'Analytics', 'Roadmapping',
    'User Stories', 'PRD', 'Stakeholder Management', 'Agile', 'Mixpanel',
  ],
  'qa': [
    'Selenium', 'Cypress', 'Postman', 'Jira', 'TestRail', 'API Testing', 'UAT',
    'Regression Testing', 'SQL', 'CI/CD', 'Jenkins', 'GitHub Actions',
  ],
  default: [
    'Microsoft Office', 'Excel', 'PowerPoint', 'Communication', 'Problem Solving',
    'Jira', 'Confluence', 'Agile', 'SQL', 'Git',
  ],
}

/** When user types a keyword, expand to related tools. */
const KEYWORD_EXPANSIONS = {
  'ci/cd': ['Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'Azure Pipelines', 'Travis CI', 'Argo CD'],
  cicd: ['Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'Azure Pipelines'],
  jenkins: ['Jenkins', 'Pipeline as Code', 'Blue Ocean', 'Groovy'],
  github: ['GitHub', 'GitHub Actions', 'GitHub Packages', 'Pull Requests'],
  docker: ['Docker', 'Docker Compose', 'Containerization', 'Dockerfile'],
  kubernetes: ['Kubernetes', 'Helm', 'kubectl', 'Pods', 'Services'],
  aws: ['AWS', 'S3', 'Lambda', 'EC2', 'CloudWatch', 'IAM', 'RDS'],
  azure: ['Azure', 'Azure DevOps', 'Azure Data Factory', 'Azure Synapse', 'Azure Functions'],
  sql: ['SQL', 'PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'CTEs', 'Joins'],
  python: ['Python', 'Pandas', 'NumPy', 'Flask', 'FastAPI', 'Django'],
  powerbi: ['Power BI', 'DAX', 'Power Query', 'Power Pivot'],
  'power bi': ['Power BI', 'DAX', 'Power Query', 'Power Pivot'],
  tableau: ['Tableau', 'Tableau Prep', 'Calculated Fields', 'Dashboards'],
  jira: ['Jira', 'Jira Align', 'Jira Workflows', 'Jira Boards'],
  agile: ['Agile', 'Scrum', 'Kanban', 'Sprint Planning', 'Retrospectives'],
  testing: ['UAT', 'Functional Testing', 'Regression Testing', 'Integration Testing', 'Selenium', 'Cypress'],
  api: ['REST APIs', 'Postman', 'OpenAPI', 'GraphQL', 'Swagger'],
  etl: ['ETL', 'ELT', 'Airflow', 'Informatica', 'Talend', 'dbt'],
  cloud: ['AWS', 'Azure', 'GCP', 'CloudFormation', 'Terraform'],
  ml: ['Machine Learning', 'Scikit-learn', 'TensorFlow', 'PyTorch', 'Feature Engineering'],
  genai: ['GenAI', 'LLMs', 'RAG', 'Prompt Engineering', 'LangChain', 'OpenAI'],
  ai: ['AI', 'GenAI', 'LLMs', 'Machine Learning', 'NLP'],
}

function normalizeRole(role) {
  return String(role || '').toLowerCase().trim()
}

export function getSkillsForRole(role) {
  const r = normalizeRole(role)
  if (!r) return [...ROLE_SKILLS.default]

  for (const [key, skills] of Object.entries(ROLE_SKILLS)) {
    if (key === 'default') continue
    if (r.includes(key) || key.split(' ').every((w) => r.includes(w))) {
      return [...skills]
    }
  }

  // Partial matches
  if (r.includes('analyst') && r.includes('data')) return [...ROLE_SKILLS['data analyst']]
  if (r.includes('analyst') && (r.includes('business') || r.includes('systems'))) {
    return [...ROLE_SKILLS['business analyst']]
  }
  if (r.includes('engineer') && r.includes('data')) return [...ROLE_SKILLS['data engineer']]
  if (r.includes('engineer') || r.includes('developer')) return [...ROLE_SKILLS['software engineer']]
  if (r.includes('devops') || r.includes('sre')) return [...ROLE_SKILLS.devops]
  if (r.includes('product')) return [...ROLE_SKILLS['product manager']]
  if (r.includes('project')) return [...ROLE_SKILLS['project manager']]
  if (r.includes('qa') || r.includes('quality') || r.includes('test')) return [...ROLE_SKILLS.qa]

  return [...ROLE_SKILLS.default]
}

export function getSkillSuggestions(role, query, selected = []) {
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()))
  const q = String(query || '').trim().toLowerCase()
  const roleSkills = getSkillsForRole(role)

  let pool = [...roleSkills]

  if (q) {
    // Keyword expansions first
    for (const [key, tools] of Object.entries(KEYWORD_EXPANSIONS)) {
      if (key.includes(q) || q.includes(key)) {
        pool = [...tools, ...pool]
      }
    }
    // Also filter by substring match
    const filtered = pool.filter((s) => s.toLowerCase().includes(q))
    const expansions = []
    for (const [key, tools] of Object.entries(KEYWORD_EXPANSIONS)) {
      if (key.includes(q) || q.includes(key)) expansions.push(...tools)
    }
    pool = [...new Set([...expansions, ...filtered])]
  }

  return [...new Set(pool)]
    .filter((s) => !selectedSet.has(s.toLowerCase()))
    .slice(0, 16)
}

export function getDefaultSelectedSkills(role) {
  return getSkillsForRole(role).slice(0, 8)
}
