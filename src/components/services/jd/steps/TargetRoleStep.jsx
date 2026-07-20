import FormField from '../../FormField'
import { MonthYearPicker } from '../MonthYearPicker'
import UsCityStateFields from '../UsCityStateFields'
import {
  BULLET_OPTIONS,
  COMPANY_COUNT_OPTIONS,
  syncExperiences,
  computeYearsOfExperience,
} from '../jdProjectModel'

export default function TargetRoleStep({ project, onChange }) {
  const t = project.targetRole || {}
  const companyCount = Number(t.companyCount) || 3
  const experiences = syncExperiences(project.experiences || [], companyCount)
  const computedYears = computeYearsOfExperience(experiences)

  function patchTarget(partial) {
    onChange({
      ...project,
      targetRole: { ...t, ...partial },
    })
  }

  function updateCompanyCount(e) {
    const count = Math.min(6, Math.max(1, Number(e.target.value) || 1))
    onChange({
      ...project,
      targetRole: { ...t, companyCount: String(count) },
      experiences: syncExperiences(project.experiences || [], count),
    })
  }

  function patchExp(index, field, value) {
    const next = experiences.map((exp, i) =>
      i === index ? { ...exp, [field]: value } : exp,
    )
    onChange({ ...project, experiences: next })
  }

  function patchExpLoc(index, { city, state }) {
    const next = experiences.map((exp, i) =>
      i === index ? { ...exp, city, state } : exp,
    )
    onChange({ ...project, experiences: next })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Target Role</h4>
        <p className="jd-step__desc">
          Enter the target role and companies. Total experience is calculated from your company dates.
        </p>
      </header>

      <div className="form-grid">
        <FormField
          label="Role"
          value={t.jobTitle}
          onChange={(e) => patchTarget({ jobTitle: e.target.value })}
          placeholder="e.g. Data Analyst"
          required
        />
        <FormField
          label="How many companies?"
          name="companyCount"
          options={COMPANY_COUNT_OPTIONS}
          placeholder="Select count"
          value={t.companyCount || '3'}
          onChange={updateCompanyCount}
          required
        />
        <div className="form-field">
          <span className="form-field__label">Total years of experience</span>
          <p className="builder-hint" style={{ margin: '8px 0 0' }}>
            {computedYears > 0
              ? `≈ ${computedYears} year${computedYears === 1 ? '' : 's'} (from company start/end dates)`
              : 'Fill company start and end dates below to calculate.'}
          </p>
        </div>
      </div>

      <h5 className="jd-step__subtitle">Companies</h5>
      <p className="builder-hint">
        Add {companyCount} compan{companyCount === 1 ? 'y' : 'ies'}. We sort present → past by dates when building.
      </p>

      {experiences.map((exp, index) => (
        <div key={exp.id || index} className="builder-company">
          <h4 className="builder-company__title">Company {index + 1}</h4>
          <div className="form-grid">
            <FormField
              label="Company name"
              value={exp.companyName}
              onChange={(e) => patchExp(index, 'companyName', e.target.value)}
              placeholder="e.g. Acme Corp"
              required
            />
            <FormField
              label="Role"
              value={exp.jobTitle}
              onChange={(e) => patchExp(index, 'jobTitle', e.target.value)}
              placeholder="e.g. Data Analyst"
              required
            />
            <div className="form-field--full">
              <MonthYearPicker
                label="Start date"
                value={exp.startDate}
                required
                onChange={(v) => patchExp(index, 'startDate', v)}
              />
            </div>
            <div className="form-field--full">
              <MonthYearPicker
                label="End date"
                value={exp.endDate}
                allowPresent
                onChange={(v) => patchExp(index, 'endDate', v)}
              />
            </div>
            <UsCityStateFields
              city={exp.city}
              state={exp.state}
              required
              onChange={(loc) => patchExpLoc(index, loc)}
            />
            <FormField
              label="Required bullets"
              options={BULLET_OPTIONS}
              placeholder="Select 3–15"
              value={exp.bulletCount || '8'}
              onChange={(e) => patchExp(index, 'bulletCount', e.target.value)}
              required
            />
          </div>
        </div>
      ))}
    </div>
  )
}
