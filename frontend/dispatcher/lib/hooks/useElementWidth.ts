'use client'

import { useCallback, useRef, useState } from 'react'

interface ElementWidth<T extends HTMLElement> {
  /** Attach to the element being measured: `<div ref={ref} />`. */
  ref: (el: T | null) => void
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

    const measure = () => setWidth(el.offsetWidth)

    const observer = new ResizeObserver(measure)
    observer.observe(el)

    window.addEventListener('resize', measure)

    cleanupRef.current = () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, width }
}
