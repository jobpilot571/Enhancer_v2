import { useEffect, useState } from 'react'
import FormField from '../FormField'

const MONTHS = [
  { value: 'Jan', label: 'January' },
  { value: 'Feb', label: 'February' },
  { value: 'Mar', label: 'March' },
  { value: 'Apr', label: 'April' },
  { value: 'May', label: 'May' },
  { value: 'Jun', label: 'June' },
  { value: 'Jul', label: 'July' },
  { value: 'Aug', label: 'August' },
  { value: 'Sep', label: 'September' },
  { value: 'Oct', label: 'October' },
  { value: 'Nov', label: 'November' },
  { value: 'Dec', label: 'December' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1969 }, (_, i) => {
  const y = String(CURRENT_YEAR - i)
  return { value: y, label: y }
})

/** Parse "Jan 2020" / "Present" into parts. */
export function parseMonthYear(raw) {
  const text = String(raw || '').trim()
  if (!text) return { month: '', year: '', present: false }
  if (/^present$|^current$|^now$/i.test(text)) {
    return { month: '', year: '', present: true }
  }
  const m = text.match(/^([A-Za-z]{3,9})\s+(\d{4})$/)
  if (m) {
    const short = m[1].slice(0, 3)
    const month = MONTHS.find((x) => x.value.toLowerCase() === short.toLowerCase())?.value || ''
    return { month, year: m[2], present: false }
  }
  const monthOnly = MONTHS.find(
    (x) => x.value.toLowerCase() === text.toLowerCase() || x.label.toLowerCase() === text.toLowerCase(),
  )
  if (monthOnly) return { month: monthOnly.value, year: '', present: false }
  const yearOnly = text.match(/^(\d{4})$/)
  if (yearOnly) return { month: '', year: yearOnly[1], present: false }
  return { month: '', year: '', present: false }
}

export function formatMonthYear(month, year, present = false) {
  if (present) return 'Present'
  if (!month || !year) return ''
  return `${month} ${year}`
}

/** True when value is Present (if allowed) or a full "Mon YYYY". */
export function isCompleteMonthYear(value, { allowPresent = false } = {}) {
  const p = parseMonthYear(value)
  if (allowPresent && p.present) return true
  return Boolean(p.month && p.year)
}

export function MonthYearPicker({
  label,
  value,
  onChange,
  allowPresent = false,
  required,
}) {
  const initial = parseMonthYear(value)
  const [month, setMonth] = useState(initial.month)
  const [year, setYear] = useState(initial.year)
  const [present, setPresent] = useState(allowPresent && initial.present)

  // Sync from parent only when it has a complete value (or Present).
  // Incomplete parent '' must not wipe in-progress month/year selections.
  useEffect(() => {
    const p = parseMonthYear(value)
    if (allowPresent && p.present) {
      setPresent(true)
      setMonth('')
      setYear('')
      return
    }
    if (p.month && p.year) {
      setPresent(false)
      setMonth(p.month)
      setYear(p.year)
    }
  }, [value, allowPresent])

  function commit(nextMonth, nextYear, nextPresent) {
    if (nextPresent) {
      onChange('Present')
      return
    }
    if (nextMonth && nextYear) {
      onChange(formatMonthYear(nextMonth, nextYear, false))
      return
    }
    // Keep local UI; clear parent so validation still requires both parts.
    onChange('')
  }

  return (
    <div className="month-year-picker">
      <span className="form-field__label">{label}{required ? ' *' : ''}</span>
      {allowPresent && (
        <label className="month-year-picker__present">
          <input
            type="checkbox"
            checked={present}
            onChange={(e) => {
              const checked = e.target.checked
              setPresent(checked)
              if (checked) {
                setMonth('')
                setYear('')
                onChange('Present')
              } else {
                onChange('')
              }
            }}
          />
          Present
        </label>
      )}
      <div className="form-grid form-grid--2 month-year-picker__row">
        <FormField
          label="Month"
          options={MONTHS}
          placeholder="Month"
          value={present ? '' : month}
          disabled={present}
          required={false}
          onChange={(e) => {
            const next = e.target.value
            setMonth(next)
            setPresent(false)
            commit(next, year, false)
          }}
        />
        <FormField
          label="Year"
          options={YEARS}
          placeholder="Year"
          value={present ? '' : year}
          disabled={present}
          required={false}
          onChange={(e) => {
            const next = e.target.value
            setYear(next)
            setPresent(false)
            commit(month, next, false)
          }}
        />
      </div>
    </div>
  )
}

export { MONTHS, YEARS }
