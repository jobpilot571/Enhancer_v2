import { useRef } from 'react'
import FormField from '../../FormField'
import {
  BULLET_OPTIONS,
  COMPANY_COUNT_OPTIONS,
  syncExperiences,
} from '../jdProjectModel'

export default function TargetRoleStep({ project, onChange }) {
  const t = project.targetRole || {}
  const companyCount = Number(t.companyCount) || 3
  const experiences = syncExperiences(project.experiences || [], companyCount)

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

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Target Role</h4>
        <p className="jd-step__desc">
          Enter the target role, years of experience, and companies for the new resume.
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
          label="Total years of experience"
          type="number"
          min={0}
          max={50}
          value={t.yearsOfExperience}
          onChange={(e) => patchTarget({ yearsOfExperience: e.target.value })}
          placeholder="e.g. 5"
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
            <FormField
              label="Start date"
              value={exp.startDate}
              onChange={(e) => patchExp(index, 'startDate', e.target.value)}
              placeholder="e.g. Jan 2022"
              required
            />
            <FormField
              label="End date"
              value={exp.endDate}
              onChange={(e) => patchExp(index, 'endDate', e.target.value)}
              placeholder="e.g. Present"
            />
            <FormField
              label="City"
              value={exp.city}
              onChange={(e) => patchExp(index, 'city', e.target.value)}
              placeholder="City"
              required
            />
            <FormField
              label="State"
              value={exp.state}
              onChange={(e) => patchExp(index, 'state', e.target.value)}
              placeholder="State / Remote"
              required
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
