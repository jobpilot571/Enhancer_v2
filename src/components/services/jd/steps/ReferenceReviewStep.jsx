const CATEGORY_LABELS = {
  summary: 'Summary ideas',
  experience: 'Experience bullet ideas',
  project: 'Project bullet ideas',
  skill: 'Skills and technologies',
  achievement: 'Achievements and metrics',
  domain: 'Domain knowledge',
}

const ORDER = ['summary', 'experience', 'project', 'skill', 'achievement', 'domain']

export default function ReferenceReviewStep({ project, onChange }) {
  const items = project.referenceItems || []
  const grouped = ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    items: items.filter((i) => i.category === cat && i.relevanceLevel !== 'unrelated'),
  })).filter((g) => g.items.length)

  function patchItem(id, partial) {
    onChange({
      ...project,
      referenceItems: items.map((i) => (i.id === id ? { ...i, ...partial } : i)),
    })
  }

  function removeItem(id) {
    onChange({
      ...project,
      referenceItems: items.filter((i) => i.id !== id),
    })
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Reference Review</h4>
        <p className="jd-step__desc">
          Approve material that may inform summary, experience, projects, and skills.
          Personal data from reference files is never shown here.
        </p>
      </header>

      {!grouped.length && (
        <p className="builder-hint">
          No extracted reference items yet. Upload documents in the previous step, or continue without references.
        </p>
      )}

      {grouped.map((group) => (
        <div key={group.cat} className="jd-ref-review-group">
          <h5 className="jd-step__subtitle">{group.label}</h5>
          <ul className="jd-ref-review-list">
            {group.items.map((item) => (
              <li key={item.id} className="jd-ref-review-list__item">
                <label className="jd-check">
                  <input
                    type="checkbox"
                    checked={!!item.approved}
                    onChange={(e) => patchItem(item.id, { approved: e.target.checked })}
                  />
                  Include
                </label>
                <textarea
                  className="form-field__input form-field__textarea"
                  rows={2}
                  value={item.cleanedText}
                  onChange={(e) => patchItem(item.id, { cleanedText: e.target.value })}
                />
                <div className="jd-ref-review-list__meta">
                  <span>Source: {item.sourceFileName || '—'}</span>
                  <span className={`jd-rel is-${item.relevanceLevel}`}>{item.relevanceLevel}</span>
                  <span>Section: {item.targetSection || group.cat}</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeItem(item.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
