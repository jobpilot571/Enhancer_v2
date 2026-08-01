/**
 * Server-side template styles (mirrors frontend resumeTemplates.js ids).
 */
export const TEMPLATE_STYLES = {
  'classic-blue': {
    accent: '1E40AF',
    headerStyle: 'centered',
    showTitle: false,
    experienceLayout: 'title-dates',
  },
  'classic-serif': {
    accent: '111827',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'title-company',
  },
  'modern-data': {
    accent: '1D4ED8',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'analyst-blue': {
    accent: '1E3A8A',
    headerStyle: 'centered',
    showTitle: true,
    titleBelowContact: true,
    experienceLayout: 'company-role-split',
  },
  'technical-black': {
    accent: '111827',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'teal-banner': {
    accent: '0F766E',
    headerStyle: 'banner',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'navy-executive': {
    accent: '1E3A5F',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'minimal-gray': {
    accent: '4B5563',
    headerStyle: 'centered',
    showTitle: false,
    experienceLayout: 'company-role-split',
  },
  'emerald-accent': {
    accent: '059669',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'compact-ats': {
    accent: '111827',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
    compact: true,
  },
  'indigo-modern': {
    accent: '4338CA',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'charcoal-pro': {
    accent: '1F2937',
    headerStyle: 'banner',
    showTitle: true,
    experienceLayout: 'company-role-split',
  },
  'jd-classic': {
    accent: '000000',
    headerStyle: 'centered',
    showTitle: true,
    experienceLayout: 'company-role-split',
    contactStyle: 'phone-email',
    headingStyle: 'underline-colon',
    skillsAsBullets: true,
    showResponsibilitiesLabel: true,
    pageBorder: true,
    nameColor: '000000',
  },
}

export function getTemplateStyle(templateId) {
  return TEMPLATE_STYLES[templateId] || TEMPLATE_STYLES['classic-blue']
}
