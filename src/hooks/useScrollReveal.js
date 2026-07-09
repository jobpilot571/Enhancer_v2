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
    const els = Array.from(document.querySelectorAll(REVEAL_SELECTOR))

    if (prefersReduced || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('reveal--visible'))
      return
    }

    els.forEach((el) => {
      el.classList.remove('reveal--visible')
      el.classList.add('reveal')
    })

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )

    els.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${(i % 4) * 70}ms`)
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
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
      return () => clearTimeout(timer)
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])
}
