'use client'

import { useEffect, useState } from 'react'

/**
 * True once the window has scrolled away from the very top: the moment content starts
 * passing under a sticky header. Drives the scroll-edge hairline, which iOS draws only when
 * there is something underneath the bar to separate from (emil-apple-design §12). Screens
 * that never scroll never get the line.
 */
export function useScrolledPastTop(): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0)
    update()
    // Passive: a listener that can't call preventDefault never delays the scroll itself.
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return scrolled
}
