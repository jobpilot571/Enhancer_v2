export default function FormField({ label, type = 'text', placeholder, options, rows }) {
  if (options) {
    return (
      <div className="form-field">
        <label className="form-field__label">{label}</label>
        <select className="form-field__input">
          <option value="">{placeholder || 'Select...'}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    )
  }
  if (rows) {
    return (
      <div className="form-field">
        <label className="form-field__label">{label}</label>
        <textarea className="form-field__input form-field__textarea" rows={rows} placeholder={placeholder} />
      </div>
    )
  }
  return (
    <div className="form-field">
      <label className="form-field__label">{label}</label>
      <input type={type} className="form-field__input" placeholder={placeholder} />
    </div>
  )
}
