'use client'

import { useState, useCallback } from 'react'

const storageKey = (tripId: string): string => `fp:visual-count-carry:${tripId}`

export function useVisualCountCarry(
  tripId: string,
): [count: number | null, setCount: (count: number | null) => void, clearCount: () => void] {
  const key = storageKey(tripId)

  const [count, setCountState] = useState<number | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null
      return raw !== null ? Number(raw) : null
    } catch {
      return null
    }
  })

  const setCount = useCallback(
    (next: number | null) => {
      try {
        if (next === null) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, String(next))
        }
      } catch {
        console.warn(`useVisualCountCarry: failed to persist visual count for key "${key}"`)
      }
      setCountState(next)
    },
    [key],
  )

  const clearCount = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      console.warn(`useVisualCountCarry: failed to clear visual count for key "${key}"`)
    }
    setCountState(null)
  }, [key])

  return [count, setCount, clearCount]
}
