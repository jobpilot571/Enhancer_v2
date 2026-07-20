import FormField from '../FormField'
import { citiesForState, US_STATE_OPTIONS } from '../../../data/usLocations'

/** State dropdown + city dropdown filtered by state, with Other free-text. */
export default function UsCityStateFields({
  city,
  state,
  onChange,
  required,
}) {
  const stateVal = String(state || '').trim()
  const cityVal = String(city || '').trim()
  const knownStates = new Set(US_STATE_OPTIONS.map((s) => s.value))
  const stateSelect = !stateVal ? '' : (knownStates.has(stateVal) ? stateVal : 'Other')
  const cityOpts = [
    ...citiesForState(stateSelect === 'Other' ? '' : stateSelect),
    { value: 'Other', label: 'Other' },
  ]
  const knownCities = new Set(cityOpts.map((c) => c.value).filter((v) => v !== 'Other'))
  const citySelect = !cityVal ? '' : (knownCities.has(cityVal) ? cityVal : 'Other')

  return (
    <>
      <FormField
        label="State"
        options={US_STATE_OPTIONS}
        placeholder="Select state"
        value={stateSelect}
        required={required}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'Other') {
            onChange({ state: stateSelect === 'Other' ? stateVal : '', city: '' })
          } else {
            onChange({ state: next, city: '' })
          }
        }}
      />
      {stateSelect === 'Other' && (
        <FormField
          label="State (other)"
          value={knownStates.has(stateVal) ? '' : stateVal}
          onChange={(e) => onChange({ state: e.target.value, city })}
          placeholder="Enter state"
          required={required}
        />
      )}
      <FormField
        label="City"
        options={cityOpts}
        placeholder={stateSelect && stateSelect !== 'Other' ? 'Select city' : 'Select state first'}
        value={citySelect}
        required={required}
        disabled={!stateSelect || (stateSelect === 'Other' && !String(stateVal).trim())}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'Other') {
            onChange({ state, city: citySelect === 'Other' ? cityVal : '' })
          } else {
            onChange({ state, city: next })
          }
        }}
      />
      {citySelect === 'Other' && (
        <FormField
          label="City (other)"
          value={knownCities.has(cityVal) ? '' : cityVal}
          onChange={(e) => onChange({ state, city: e.target.value })}
          placeholder="Enter city"
          required={required}
        />
      )}
    </>
  )
}
