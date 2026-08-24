import { useEffect, useMemo, useRef, useState } from 'react'
import { getRelatedSkills, getSkillSuggestions, getDefaultSelectedSkills } from '../../data/skillSuggestions'

export default function SkillsPicker({ role, selected = [], onChange }) {
  const [query, setQuery] = useState('')
  const [lastPicked, setLastPicked] = useState('')
  const seededForRole = useRef('')

  const suggestions = useMemo(
    () => getSkillSuggestions(role, query, selected),
    [role, query, selected],
  )

  const related = useMemo(
    () => (query.trim() ? [] : getRelatedSkills(lastPicked, selected)),
    [lastPicked, selected, query],
  )

  useEffect(() => {
    const r = role?.trim() || ''
    if (r && seededForRole.current !== r && selected.length === 0) {
      seededForRole.current = r
      onChange(getDefaultSelectedSkills(r))
    }
    if (!r) seededForRole.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  function toggle(skill) {
    const exists = selected.some((s) => s.toLowerCase() === skill.toLowerCase())
    if (exists) {
      onChange(selected.filter((s) => s.toLowerCase() !== skill.toLowerCase()))
      if (lastPicked.toLowerCase() === skill.toLowerCase()) setLastPicked('')
    } else {
      onChange([...selected, skill])
      setLastPicked(skill)
      setQuery('')
    }
  }

  function addCustom(e) {
    e.preventDefault()
    const value = query.trim()
    if (!value) return
    if (!selected.some((s) => s.toLowerCase() === value.toLowerCase())) {
      onChange([...selected, value])
      setLastPicked(value)
    }
    setQuery('')
  }

  function remove(skill) {
    onChange(selected.filter((s) => s !== skill))
    if (lastPicked === skill) setLastPicked('')
  }

  if (!role?.trim()) {
    return (
      <div className="skills-picker skills-picker--empty">
        <p className="skills-picker__hint">Enter a role name above to see suggested skills.</p>
      </div>
    )
  }

  const extraSuggestions = suggestions.filter(
    (s) => !related.some((r) => r.toLowerCase() === s.toLowerCase()),
  )

  return (
    <div className="skills-picker">
      <div className="skills-picker__header">
        <h5 className="skills-picker__title">Skills</h5>
        <p className="skills-picker__hint">
          Suggested for <strong>{role}</strong>. Click a skill to add related tools (e.g. AWS or Grafana).
        </p>
      </div>

      {selected.length > 0 && (
        <div className="skills-picker__selected">
          {selected.map((skill) => (
            <button
              key={skill}
              type="button"
              className={`skill-chip skill-chip--selected ${lastPicked === skill ? 'is-focus' : ''}`}
              onClick={() => remove(skill)}
              title="Remove"
            >
              {skill}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      <form className="skills-picker__search" onSubmit={addCustom}>
        <input
          className="form-field__input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Type to search or add — e.g. "CI/CD", "SQL", "Jenkins"'
        />
        <button type="submit" className="btn btn--outline skills-picker__add-btn" disabled={!query.trim()}>
          Add
        </button>
      </form>

      {related.length > 0 && (
        <div className="skills-picker__related">
          <p className="skills-picker__related-label">Related to {lastPicked}</p>
          <div className="skills-picker__suggestions">
            {related.map((skill) => (
              <button
                key={skill}
                type="button"
                className="skill-chip skill-chip--related"
                onClick={() => toggle(skill)}
              >
                + {skill}
              </button>
            ))}
          </div>
        </div>
      )}

      {extraSuggestions.length > 0 && (
        <div className="skills-picker__suggestions">
          {extraSuggestions.map((skill) => (
            <button
              key={skill}
              type="button"
              className="skill-chip"
              onClick={() => toggle(skill)}
            >
              + {skill}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
