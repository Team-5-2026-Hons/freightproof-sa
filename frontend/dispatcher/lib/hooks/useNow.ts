'use client'

import { useEffect, useState } from 'react'

/** The current time, refreshed on an interval, so relative labels ("2 min ago") keep
 *  counting without every row owning a timer. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
