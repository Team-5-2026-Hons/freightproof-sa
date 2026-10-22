'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * How many fixed-height rows fit in an element right now. Lets the Trips tab show as many
 * past trips as the screen holds — no fewer on a Pro Max, no clipped half-row on an SE —
 * with the rest one tap away under "See all" (the Trips page must not scroll).
 * Uses `fallback` where layout cannot be measured (no ResizeObserver, first render).
 */
export function useRowsThatFit(ref: RefObject<HTMLElement | null>, rowHeightPx: number, fallback: number): number {
  const [count, setCount] = useState(fallback)

  useEffect(() => {
    const el = ref.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0
      // At least one row: a section that can show nothing would just look broken.
      setCount(Math.max(1, Math.floor(height / rowHeightPx)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rowHeightPx])

  return count
}
