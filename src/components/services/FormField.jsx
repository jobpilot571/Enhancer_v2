export default function FormField({
  label,
  type = 'text',
  placeholder,
  options,
  rows,
  value,
  onChange,
  name,
  required,
  min,
  max,
  className = '',
  disabled,
}) {
  const fieldClass = `form-field ${className}`.trim()
  const inputProps = {
    className: 'form-field__input',
    name,
    value: value ?? '',
    onChange,
    required,
    disabled,
    placeholder,
  }

  if (options) {
    return (
      <div className={fieldClass}>
        <label className="form-field__label">{label}</label>
        <select
          className="form-field__input"
          name={name}
          value={value ?? ''}
          onChange={onChange}
          required={required}
          disabled={disabled}
        >
          <option value="">{placeholder || 'Select...'}</option>
          {options.map((opt) => {
            const optValue = typeof opt === 'object' ? opt.value : opt
            const optLabel = typeof opt === 'object' ? opt.label : opt
            return (
              <option key={optValue} value={optValue}>
                {optLabel}
              </option>
            )
          })}
        </select>
      </div>
    )
  }

  if (rows) {
    return (
      <div className={fieldClass}>
        <label className="form-field__label">{label}</label>
        <textarea
          {...inputProps}
          className="form-field__input form-field__textarea"
          rows={rows}
        />
      </div>
    )
  }

  return (
    <div className={fieldClass}>
      <label className="form-field__label">{label}</label>
      <input type={type} {...inputProps} min={min} max={max} />
    </div>
  )
}
