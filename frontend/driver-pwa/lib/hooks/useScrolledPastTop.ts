'use client'

import { useEffect, useState } from 'react'

/**
 * True once the window has scrolled away from the very top: the moment content starts
 * passing under a sticky header. Drives the scroll-edge hairline, which iOS draws only when
 * there is something underneath the bar to separate from. Screens
 * that never scroll never get the line.
 */
export function useScrolledPastTop(): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0)
    const firstRead = window.requestAnimationFrame(update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.cancelAnimationFrame(firstRead)
      window.removeEventListener('scroll', update)
    }
  }, [])

  return scrolled
}
