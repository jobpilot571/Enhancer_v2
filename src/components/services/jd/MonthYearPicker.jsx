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
  const yearOnly = text.match(/^(\d{4})$/)
  if (yearOnly) return { month: 'Jan', year: yearOnly[1], present: false }
  return { month: '', year: '', present: false }
}

export function formatMonthYear(month, year, present = false) {
  if (present) return 'Present'
  if (!month || !year) return ''
  return `${month} ${year}`
}

export function MonthYearPicker({
  label,
  value,
  onChange,
  allowPresent = false,
  required,
}) {
  const parsed = parseMonthYear(value)
  const present = allowPresent && parsed.present

  function emit({ month = parsed.month, year = parsed.year, isPresent = present }) {
    onChange(formatMonthYear(month, year, isPresent))
  }

  return (
    <div className="month-year-picker">
      <span className="form-field__label">{label}{required ? ' *' : ''}</span>
      <div className="form-grid month-year-picker__row">
        {allowPresent && (
          <label className="month-year-picker__present">
            <input
              type="checkbox"
              checked={present}
              onChange={(e) => emit({ isPresent: e.target.checked })}
            />
            Present
          </label>
        )}
        <FormField
          label="Month"
          options={MONTHS}
          placeholder="Month"
          value={present ? '' : parsed.month}
          disabled={present}
          required={required && !present}
          onChange={(e) => emit({ month: e.target.value, isPresent: false })}
        />
        <FormField
          label="Year"
          options={YEARS}
          placeholder="Year"
          value={present ? '' : parsed.year}
          disabled={present}
          required={required && !present}
          onChange={(e) => emit({ year: e.target.value, isPresent: false })}
        />
      </div>
    </div>
  )
}

export { MONTHS, YEARS }
