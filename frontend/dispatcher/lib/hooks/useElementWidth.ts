'use client'

import { useCallback, useRef, useState } from 'react'

interface ElementWidth<T extends HTMLElement> {
  /** Attach to the element being measured: `<div ref={ref} />`. */
  ref: (el: T | null) => void
  /**
   * Observed BORDER-box width in px — the space the element actually occupies in its
   * row, padding and border included. 0 before first measurement, and 0 while the
   * element is not rendered.
   */
  width: number
}

/**
 * The live content width of an element.
 *
 * A CALLBACK ref, not a RefObject: the pages using this return a loading tree first, so
 * the measured element does not exist on the render that would have set up an effect. A
 * callback ref fires when the element actually mounts, which is the only moment the
 * measurement can be wired up correctly.
 *
 * An element hidden by a responsive class measures 0, and that is load-bearing rather
 * than a degenerate case — a column that hides itself below a breakpoint must contribute
 * zero to any space calculation, and measuring it is how that stays true without
 * restating the breakpoint in JavaScript where it would silently drift from the CSS.
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

    // offsetWidth, NOT ResizeObserverEntry.contentRect.width. contentRect is the CONTENT
    // box, so a padded element under-reports by its own padding — this column is `w-304`
    // with `p-5` and measured 264, and reserving 264 where 304 was needed is precisely
    // how the neighbouring panel grew 40px past the space available to it.
    const measure = () => setWidth(el.offsetWidth)

    // observe() fires once immediately with the current box, so there is no separate
    // initial-measurement path to keep in sync with this one.
    const observer = new ResizeObserver(measure)
    observer.observe(el)

    // Backstop for the one transition a ResizeObserver is not guaranteed to report: an
    // element leaving the layout entirely via a responsive `hidden` class. Its width must
    // reach 0 or the space it gave up stays reserved against whoever could use it.
    window.addEventListener('resize', measure)

    cleanupRef.current = () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, width }
}
