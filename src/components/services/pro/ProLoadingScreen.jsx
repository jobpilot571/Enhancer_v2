export default function ProLoadingScreen({
  title = 'Please wait…',
  subtitle = '',
  steps = [],
  currentStep = '',
}) {
  const idx = steps.findIndex((s) => s.key === currentStep)
  const currentIdx = idx >= 0 ? idx : 0

  return (
    <div className="pro-load" role="status" aria-live="polite" aria-busy="true">
      <div className="pro-load__inner">
        <p className="pro-load__kicker">{title}</p>
        {subtitle ? <p className="pro-load__sub">{subtitle}</p> : null}
        <ul className="pro-load__steps">
          {steps.map((step, i) => {
            const done = i < currentIdx
            const active = i === currentIdx
            return (
              <li
                key={step.key}
                className={done ? 'is-done' : active ? 'is-active' : 'is-pending'}
              >
                <span className="pro-load__mark" aria-hidden="true">
                  {done ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12.5l2.5 2.5L16 9" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  )}
                </span>
                <span>{step.label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
