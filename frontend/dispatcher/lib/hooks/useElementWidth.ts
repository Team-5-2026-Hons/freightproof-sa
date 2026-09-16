'use client'

import { useCallback, useRef, useState } from 'react'

interface ElementWidth<T extends HTMLElement> {
  /** Attach to the element being measured: `<div ref={ref} />`. */
  ref: (el: T | null) => void
  /** Observed BORDER-box width in px (padding/border included). 0 before first
   *  measurement or while unmounted. */
  width: number
}

/**
 * The live content width of an element.
 *
 * A CALLBACK ref, not a RefObject: pages using this render a loading tree first, so the
 * element doesn't exist yet on the render that would set up an effect-based observer.
 */
export function useElementWidth<T extends HTMLElement>(): ElementWidth<T> {
  const [width, setWidth] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  const ref = useCallback((el: T | null) => {
    cleanupRef.current?.()

    if (el === null) {
      cleanupRef.current = null
      return
    }

    // offsetWidth (border box), not contentRect.width, which under-reports by padding.
    const measure = () => setWidth(el.offsetWidth)

    const observer = new ResizeObserver(measure)
    observer.observe(el)

    // Backstop: a ResizeObserver isn't guaranteed to report an element leaving layout
    // entirely via a responsive `hidden` class.
    window.addEventListener('resize', measure)

    cleanupRef.current = () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, width }
}
