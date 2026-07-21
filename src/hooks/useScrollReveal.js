import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const REVEAL_SELECTOR = [
  '.section-header',
  '.step',
  '.service-card',
  '.service-card--live',
  '.service-block',
  '.upload-box',
  '.result-card',
  '.pricing-card',
  '.comparison-title',
  '.service-cta-row',
  '.form-card',
  '.contact__info',
  '.contact__form',
].join(',')

export default function useScrollReveal() {
  const location = useLocation()

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Mobile / coarse pointer: skip reveal motion — transforms feel like the page is scrolling itself
    const isCoarse = window.matchMedia('(hover: none), (pointer: coarse), (max-width: 900px)').matches
    const els = Array.from(document.querySelectorAll(REVEAL_SELECTOR)).filter(
      (el) => !el.closest('.jd-wizard') && !el.classList.contains('form-card--jd-step'),
    )

    if (prefersReduced || isCoarse || !('IntersectionObserver' in window)) {
      els.forEach((el) => {
        el.classList.remove('reveal')
        el.classList.add('reveal--visible')
        el.style.removeProperty('--reveal-delay')
      })
      return
    }

    els.forEach((el) => {
      el.classList.remove('reveal--visible')
      el.classList.add('reveal')
    })

    // threshold 0: any pixel visible counts. A tall .form-card (multi-section page)
    // never reaches 12% intersection in a normal viewport, so it stayed opacity:0.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0, rootMargin: '0px 0px -8px 0px' },
    )

    els.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${(i % 4) * 70}ms`)
      const rect = el.getBoundingClientRect()
      // Already on screen (e.g. after route change) — show immediately
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('reveal--visible')
        return
      }
      observer.observe(el)
    })

    return () => observer.disconnect()
  }, [location.pathname])
}

export function useScrollToHash() {
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.replace('#', '')
      const timer = setTimeout(() => {
        const el = document.getElementById(id)
        // Instant jump only for explicit hash links — never animate (feels like auto-scroll on mobile)
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 80)
      return () => clearTimeout(timer)
    }
    // Reset to top on route change only (not hash). Instant — smooth scroll feels like the page is "moving by itself".
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])
}
