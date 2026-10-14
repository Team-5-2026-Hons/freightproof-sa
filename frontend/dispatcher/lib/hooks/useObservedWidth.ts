'use client'

import { useCallback, useRef, useState } from 'react'

interface ObservedWidth<T extends HTMLElement> {
  /** Attach to the element being measured. */
  ref: (el: T | null) => void
  /** The element's content-box width in px, or null until the first measurement. */
  width: number | null
}

/**
 * The live content width of one element, from a ResizeObserver on that element alone: not a
 * viewport query, because what matters is the room the card actually has (it shrinks when the
 * exceptions panel docks, with no change to the window). Null until measured, so a caller can
 * pick its safe layout rather than guess from a zero.
 */
export function useObservedWidth<T extends HTMLElement>(): ObservedWidth<T> {
  const [width, setWidth] = useState<number | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  const ref = useCallback((el: T | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (el === null) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    cleanup.current = () => observer.disconnect()
  }, [])

  return { ref, width }
}
