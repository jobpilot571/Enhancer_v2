import { useEffect, useState } from 'react'

/**
 * Hide sticky workspace chrome when the user scrolls down in the form panel,
 * and show it again when they scroll up (or return to the top).
 */
export default function useHideOnScrollDown(rootRef, resetKey, { threshold = 8, minY = 20 } = {}) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(false)
  }, [resetKey])

  useEffect(() => {
    const root = rootRef?.current
    if (!root) return undefined

    const lastByTarget = new WeakMap()

    function onScroll(event) {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.classList.contains('pro-split__report')) return

      const y = target.scrollTop
      const last = lastByTarget.get(target) ?? 0
      lastByTarget.set(target, y)
      const dy = y - last

      if (y <= minY) {
        setHidden(false)
        return
      }
      if (dy > threshold) setHidden(true)
      else if (dy < -threshold) setHidden(false)
    }

    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true })
  }, [rootRef, resetKey, threshold, minY])

  return hidden
}
