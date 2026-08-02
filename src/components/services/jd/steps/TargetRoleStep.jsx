import { useEffect, useState } from 'react'
import FormField from '../../FormField'
import { MonthYearPicker } from '../MonthYearPicker'
import UsCityStateFields from '../UsCityStateFields'
import {
  BULLET_OPTIONS,
  bulletRangeForCompanyIndex,
  defaultBulletCountForCompanyIndex,
  emptyExperience,
  computeYearsOfExperience,
  newId,
} from '../jdProjectModel'
import { suggestCompaniesFromJd } from '../../../../api/jdBuilder'

function AiCompanyModeModal({
  open,
  onClose,
  onSubmit,
  loading,
  error,
  defaults = {},
}) {
  const [years, setYears] = useState(String(defaults.years || '5'))
  const [companyCount, setCompanyCount] = useState(String(defaults.companyCount || '3'))
  const [usaCount, setUsaCount] = useState(String(defaults.usaCount || '2'))
  const [indiaCount, setIndiaCount] = useState(String(defaults.indiaCount || '1'))
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    setYears(String(defaults.years || '5'))
    setCompanyCount(String(defaults.companyCount || '3'))
    setUsaCount(String(defaults.usaCount || '2'))
    setIndiaCount(String(defaults.indiaCount || '1'))
    setLocalError('')
  }, [open, defaults.years, defaults.companyCount, defaults.usaCount, defaults.indiaCount])

  if (!open) return null

  const total = Number(companyCount) || 0
  const usa = Number(usaCount) || 0
  const india = Number(indiaCount) || 0

  function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')
    if (!Number.isFinite(total) || total < 1 || total > 6) {
      setLocalError('Choose 1–6 companies total.')
      return
    }
    if (usa + india !== total) {
      setLocalError(`USA (${usa}) + India (${india}) must equal total companies (${total}).`)
      return
    }
    const y = Number(years)
    if (!Number.isFinite(y) || y < 1 || y > 40) {
      setLocalError('Enter years of experience between 1 and 40.')
      return
    }
    onSubmit({
      yearsOfExperience: y,
      companyCount: total,
      usaCount: usa,
      indiaCount: india,
    })
  }

  return (
    <div className="jd-modal jd-modal--centered" role="dialog" aria-modal="true" aria-label="AI company mode">
      <button type="button" className="jd-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="jd-modal__panel jd-modal__panel--ai">
        <div className="jd-modal__head">
          <div>
            <h3 className="jd-modal__title">AI / Auto company mode</h3>
            <p className="jd-modal__sub">
              We&apos;ll read the JD, pick an industry-fit company history (USA + India), and set dates from present → past.
              Each company gets 10–12 JD-matched bullets at build time.
            </p>
          </div>
          <button type="button" className="jd-modal__close" onClick={onClose} disabled={loading}>
            ×
          </button>
        </div>
        <form className="jd-modal__body jd-modal__body--padded" onSubmit={handleSubmit}>
          <div className="form-grid form-grid--2">
            <FormField
              label="Years of experience needed"
              type="number"
              min={1}
              max={40}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              required
            />
            <FormField
              label="How many companies?"
              type="number"
              min={1}
              max={6}
              value={companyCount}
              onChange={(e) => {
                const next = e.target.value
                setCompanyCount(next)
                const n = Number(next) || 0
                const u = Math.min(n, Number(usaCount) || 0)
                setUsaCount(String(u))
                setIndiaCount(String(Math.max(0, n - u)))
              }}
              required
            />
            <FormField
              label="Companies in USA"
              type="number"
              min={0}
              max={6}
              value={usaCount}
              onChange={(e) => setUsaCount(e.target.value)}
              required
            />
            <FormField
              label="Companies in India"
              type="number"
              min={0}
              max={6}
              value={indiaCount}
              onChange={(e) => setIndiaCount(e.target.value)}
              required
            />
          </div>
          {(localError || error) && (
            <p className="builder-error" role="alert">{localError || error}</p>
          )}
          <div className="jd-modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? 'Generating companies…' : 'Generate with AI'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TargetRoleStep({ project, onChange }) {
  const t = project.targetRole || {}
  const experiences = Array.isArray(project.experiences) && project.experiences.length
    ? project.experiences.slice(0, 6)
    : [emptyExperience()]
  const computedYears = computeYearsOfExperience(experiences)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiNotice, setAiNotice] = useState('')

  function patchTarget(partial) {
    onChange({
      ...project,
      targetRole: { ...t, ...partial },
    })
  }

  function setExperiences(next, targetPartial = {}) {
    const clipped = next.slice(0, 6)
    onChange({
      ...project,
      experiences: clipped,
      targetRole: {
        ...t,
        ...targetPartial,
        companyCount: String(clipped.length || 1),
      },
    })
  }

  function patchExp(index, field, value) {
    setExperiences(experiences.map((exp, i) =>
      i === index ? { ...exp, [field]: value } : exp,
    ))
  }

  function patchExpLoc(index, { city, state }) {
    setExperiences(experiences.map((exp, i) =>
      i === index ? { ...exp, city, state } : exp,
    ))
  }

  function addCompany() {
    if (experiences.length >= 6) return
    const index = experiences.length
    setExperiences([
      ...experiences,
      {
        ...emptyExperience(index),
        jobTitle: t.jobTitle || '',
        bulletCount: defaultBulletCountForCompanyIndex(index),
      },
    ])
  }

  function removeCompany(index) {
    if (experiences.length <= 1) return
    setExperiences(experiences.filter((_, i) => i !== index))
  }

  async function handleAiGenerate(answers) {
    const jdText = String(t.jobDescription || '').trim()
    if (jdText.length < 80) {
      setAiError('Add a job description in the JD step first (at least a few sentences).')
      return
    }
    setAiLoading(true)
    setAiError('')
    setAiNotice('')
    try {
      const result = await suggestCompaniesFromJd({
        jdText,
        roleTitle: t.jobTitle || '',
        ...answers,
      })
      const companies = Array.isArray(result?.companies) ? result.companies : []
      if (!companies.length) {
        throw new Error('AI did not return companies. Try again.')
      }
      const next = companies.slice(0, 6).map((c, i) => {
        const range = bulletRangeForCompanyIndex(i)
        const raw = Number(c.bulletCount) || Number(range.default)
        const bulletCount = String(Math.min(range.max, Math.max(range.min, raw)))
        return {
          ...emptyExperience(i),
          id: newId('exp'),
          companyName: String(c.companyName || c.name || '').trim(),
          jobTitle: String(c.jobTitle || c.role || t.jobTitle || '').trim(),
          city: String(c.city || '').trim(),
          state: String(c.state || '').trim(),
          startDate: String(c.startDate || '').trim(),
          endDate: String(c.endDate || '').trim() || 'Present',
          bulletCount,
          summary: String(c.bulletGuidance || c.summary || '').trim(),
          country: String(c.country || '').trim(),
        }
      })
      setExperiences(next, {
        yearsRequired: String(answers.yearsOfExperience),
        aiMode: true,
        aiIndustry: result.industry || '',
      })
      setAiNotice(
        `AI filled ${next.length} compan${next.length === 1 ? 'y' : 'ies'}`
        + (result.industry ? ` for ${result.industry}` : '')
        + '. Review and edit anything you want.',
      )
      setAiOpen(false)
    } catch (err) {
      setAiError(err.message || 'AI company generation failed.')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Target Role</h4>
        <p className="jd-step__desc">
          Confirm the role from the JD, then fill companies manually — or use AI mode to auto-build a JD-fit history.
        </p>
      </header>

      <section className="jd-panel-card" aria-label="Target role">
        <h5 className="jd-panel-card__title">Target information</h5>
        <div className="form-grid form-grid--2">
          <FormField
            label="Target role"
            value={t.jobTitle}
            onChange={(e) => patchTarget({ jobTitle: e.target.value })}
            placeholder="e.g. Data Analyst"
            required
          />
          <FormField
            label="Required experience (from JD)"
            type="number"
            min={0}
            max={50}
            value={t.yearsRequired ?? ''}
            onChange={(e) => patchTarget({ yearsRequired: e.target.value })}
            placeholder="e.g. 5"
          />
          <div className="form-field form-field--full">
            <span className="form-field__label">Total years (from company dates)</span>
            <p className="builder-hint" style={{ margin: '8px 0 0' }}>
              {computedYears > 0
                ? `≈ ${computedYears} year${computedYears === 1 ? '' : 's'}`
                : 'Fill company start and end dates below to calculate.'}
            </p>
          </div>
        </div>
      </section>

      <section className="jd-panel-card jd-panel-card--companies" aria-label="Companies">
        <div className="jd-step__row-head">
          <h5 className="jd-panel-card__title">Companies</h5>
          <div className="jd-step__row-actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                setAiError('')
                setAiOpen(true)
              }}
            >
              AI mode / Auto fill
            </button>
          </div>
        </div>
        <p className="builder-hint">
          One company by default. Use <strong>Add company</strong> for more, or <strong>AI mode</strong> to generate a full present→past history from the JD.
        </p>
        {aiNotice && <p className="builder-hint" role="status">{aiNotice}</p>}

        <div className="jd-company-cards">
          {experiences.map((exp, index) => (
            <div key={exp.id || index} className="jd-company-card">
              <div className="jd-step__row-head">
                <h4 className="builder-company__title">
                  Company {index + 1}
                  {exp.country ? ` · ${exp.country}` : ''}
                </h4>
                {experiences.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeCompany(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="form-grid form-grid--2">
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
                <MonthYearPicker
                  label="Start date"
                  value={exp.startDate}
                  required
                  onChange={(v) => patchExp(index, 'startDate', v)}
                />
                <MonthYearPicker
                  label="End date"
                  value={exp.endDate}
                  allowPresent
                  onChange={(v) => patchExp(index, 'endDate', v)}
                />
                <UsCityStateFields
                  city={exp.city}
                  state={exp.state}
                  required
                  onChange={(loc) => patchExpLoc(index, loc)}
                />
                <FormField
                  label={`Required bullets (${bulletRangeForCompanyIndex(index).min}–${bulletRangeForCompanyIndex(index).max})`}
                  options={BULLET_OPTIONS.filter((o) => {
                    const n = Number(o.value)
                    const r = bulletRangeForCompanyIndex(index)
                    return n >= r.min && n <= r.max
                  })}
                  placeholder={`Select ${bulletRangeForCompanyIndex(index).min}–${bulletRangeForCompanyIndex(index).max}`}
                  value={exp.bulletCount || defaultBulletCountForCompanyIndex(index)}
                  onChange={(e) => patchExp(index, 'bulletCount', e.target.value)}
                  required
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="btn btn--outline jd-add-company-btn"
        onClick={addCompany}
        disabled={experiences.length >= 6}
      >
        {experiences.length >= 6
          ? 'Company limit reached (6)'
          : `Add company ${experiences.length + 1}`}
      </button>

      <AiCompanyModeModal
        open={aiOpen}
        onClose={() => !aiLoading && setAiOpen(false)}
        onSubmit={handleAiGenerate}
        loading={aiLoading}
        error={aiError}
        defaults={{
          years: t.yearsRequired || '5',
          companyCount: '3',
          usaCount: '2',
          indiaCount: '1',
        }}
      />
    </div>
  )
}
