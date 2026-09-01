import { useEffect, useState } from 'react'
import FormField from './FormField'
import { MonthYearPicker } from './jd/MonthYearPicker'

function emptyWorkedDate(index = 0) {
  return { startDate: '', endDate: index === 0 ? 'Present' : '' }
}

/**
 * Shared AI / Auto Fill modal for Resume Builder and JD-Tailored Resume.
 */
export default function AiCompanyModeModal({
  open,
  onClose,
  onSubmit,
  loading,
  error,
  defaults = {},
  title = 'AI / Auto Fill',
  description = "We'll pick an industry-fit company history (USA + India) and set dates from present → past. Each company gets its own JD-matched bullet count at build time.",
}) {
  const [years, setYears] = useState(String(defaults.years || '5'))
  const [companyCount, setCompanyCount] = useState(String(defaults.companyCount || '3'))
  const [usaCount, setUsaCount] = useState(String(defaults.usaCount || '2'))
  const [indiaCount, setIndiaCount] = useState(String(defaults.indiaCount || '1'))
  const [includeWorkedDates, setIncludeWorkedDates] = useState(false)
  const [workedDates, setWorkedDates] = useState([emptyWorkedDate(0)])
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    setYears(String(defaults.years || '5'))
    setCompanyCount(String(defaults.companyCount || '3'))
    setUsaCount(String(defaults.usaCount || '2'))
    setIndiaCount(String(defaults.indiaCount || '1'))
    setIncludeWorkedDates(false)
    setWorkedDates(
      Array.from({ length: Math.max(1, Number(defaults.companyCount) || 3) }, (_, i) => emptyWorkedDate(i)),
    )
    setLocalError('')
  }, [open, defaults.years, defaults.companyCount, defaults.usaCount, defaults.indiaCount])

  useEffect(() => {
    const n = Math.min(6, Math.max(1, Number(companyCount) || 1))
    setWorkedDates((prev) => Array.from({ length: n }, (_, i) => prev[i] || emptyWorkedDate(i)))
  }, [companyCount])

  if (!open) return null

  const total = Number(companyCount) || 0
  const usa = Number(usaCount) || 0
  const india = Number(indiaCount) || 0

  function patchWorkedDate(index, field, value) {
    setWorkedDates((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

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
    if (includeWorkedDates) {
      for (let i = 0; i < total; i++) {
        const row = workedDates[i] || emptyWorkedDate(i)
        if (!String(row.startDate || '').trim() || !String(row.endDate || '').trim()) {
          setLocalError(`Add start and end dates for company ${i + 1}, or turn off Worked Dates.`)
          return
        }
      }
    }
    onSubmit({
      yearsOfExperience: y,
      companyCount: total,
      usaCount: usa,
      indiaCount: india,
      workedDates: includeWorkedDates
        ? workedDates.slice(0, total).map((row) => ({
          startDate: String(row.startDate || '').trim(),
          endDate: String(row.endDate || '').trim(),
        }))
        : null,
    })
  }

  return (
    <div className="jd-modal jd-modal--centered" role="dialog" aria-modal="true" aria-label="AI company mode">
      <button type="button" className="jd-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="jd-modal__panel jd-modal__panel--ai">
        <div className="jd-modal__head">
          <div>
            <h3 className="jd-modal__title">{title}</h3>
            <p className="jd-modal__sub">{description}</p>
          </div>
          <button type="button" className="jd-modal__close" onClick={onClose} disabled={loading}>
            ×
          </button>
        </div>
        <form className="jd-modal__body jd-modal__body--padded" onSubmit={handleSubmit}>
          <div className="form-grid form-grid--2">
            <FormField
              label="Years of Experience"
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

          <div className="jd-ai-optional">
            <button
              type="button"
              className={`jd-ai-optional__toggle ${includeWorkedDates ? 'is-open' : ''}`}
              aria-expanded={includeWorkedDates}
              onClick={() => setIncludeWorkedDates((v) => !v)}
            >
              <span>Do you want to add Worked Dates to each company?</span>
              <span className="jd-ai-optional__hint">{includeWorkedDates ? 'Hide' : 'Optional'}</span>
            </button>
            {includeWorkedDates && (
              <div className="jd-ai-optional__body">
                <p className="builder-hint">
                  Enter start and end dates for each of the {total || 0} companies. Leave this closed to let AI choose dates.
                </p>
                {workedDates.slice(0, Math.max(1, total)).map((row, index) => (
                  <div key={index} className="jd-ai-worked-row">
                    <h6 className="jd-ai-worked-row__title">Company {index + 1}</h6>
                    <div className="builder-dates-row form-field--full">
                      <MonthYearPicker
                        label="Start date"
                        value={row.startDate}
                        onChange={(v) => patchWorkedDate(index, 'startDate', v)}
                      />
                      <MonthYearPicker
                        label="End date"
                        value={row.endDate}
                        allowPresent
                        onChange={(v) => patchWorkedDate(index, 'endDate', v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
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
