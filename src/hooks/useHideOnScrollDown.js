import { useCallback, useEffect, useState } from 'react'

/**
 * Hide workspace chrome when the form panel is scrolled down.
 * Returns [hidden, setScrollEl] — put setScrollEl on the scrolling aside.
 */
export default function useHideOnScrollDown(resetKey, { threshold = 6, minY = 16 } = {}) {
  const [hidden, setHidden] = useState(false)
  const [node, setNode] = useState(null)
  const setScrollEl = useCallback((el) => {
    setNode(el)
  }, [])

  useEffect(() => {
    setHidden(false)
  }, [resetKey])

  useEffect(() => {
    if (!node) {
      setHidden(false)
      return undefined
    }

    let lastY = node.scrollTop

    function onScroll() {
      const y = node.scrollTop
      const dy = y - lastY
      lastY = y

      if (y <= minY) {
        setHidden(false)
        return
      }
      if (dy > threshold) setHidden(true)
      else if (dy < -threshold) setHidden(false)
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [node, resetKey, threshold, minY])

  return [hidden, setScrollEl]
}
