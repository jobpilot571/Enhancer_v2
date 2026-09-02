import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Hide workspace chrome when the form panel is scrolled down.
 * Returns [hidden, setScrollEl] — put setScrollEl on the scrolling aside.
 */
export default function useHideOnScrollDown(resetKey, { threshold = 14, minY = 28 } = {}) {
  const [hidden, setHidden] = useState(false)
  const [node, setNode] = useState(null)
  const lockUntilRef = useRef(0)
  const setScrollEl = useCallback((el) => {
    setNode(el)
  }, [])

  useEffect(() => {
    setHidden(false)
    lockUntilRef.current = 0
  }, [resetKey])

  useEffect(() => {
    if (!node) {
      setHidden(false)
      return undefined
    }

    let lastY = node.scrollTop

    function onScroll() {
      if (performance.now() < lockUntilRef.current) {
        lastY = node.scrollTop
        return
      }

      const y = node.scrollTop
      const dy = y - lastY
      lastY = y

      if (y <= minY) {
        setHidden((was) => {
          if (was) lockUntilRef.current = performance.now() + 220
          return false
        })
        return
      }
      if (dy > threshold) {
        setHidden((was) => {
          if (!was) lockUntilRef.current = performance.now() + 220
          return true
        })
      } else if (dy < -threshold) {
        setHidden((was) => {
          if (was) lockUntilRef.current = performance.now() + 220
          return false
        })
      }
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [node, resetKey, threshold, minY])

  return [hidden, setScrollEl]
}
