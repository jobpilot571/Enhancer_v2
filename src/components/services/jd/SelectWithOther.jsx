import FormField from '../FormField'

/**
 * Select from options; when "Other" is chosen, show a free-text field.
 * `value` is the stored final string (known option or custom text).
 */
export default function SelectWithOther({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  otherPlaceholder = 'Enter name',
  required,
  className = '',
}) {
  const opts = (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))
  const knownValues = new Set(opts.map((o) => o.value).filter((v) => v && v !== 'Other'))
  const hasValue = Boolean(String(value || '').trim())
  const isKnown = hasValue && knownValues.has(value)
  const selectValue = !hasValue ? '' : (isKnown ? value : 'Other')
  const showOther = selectValue === 'Other'

  return (
    <div className={`select-with-other ${className}`.trim()}>
      <FormField
        label={label}
        options={opts}
        placeholder={placeholder}
        value={selectValue}
        required={required}
        className={className}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'Other') {
            onChange(isKnown || !hasValue ? '' : value, true)
          } else {
            onChange(next, false)
          }
        }}
      />
      {showOther && (
        <FormField
          label={`${label} (other)`}
          value={isKnown ? '' : (value || '')}
          onChange={(e) => onChange(e.target.value, true)}
          placeholder={otherPlaceholder}
          required={required}
        />
      )}
    </div>
  )
}
