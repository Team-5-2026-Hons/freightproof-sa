'use client'

import { useEffect, useRef, useState } from 'react'

export const RECENT_KEY_MS = 2500

/**
 * The keys that have appeared since the first render, for `durationMs` each, while `enabled`.
 *
 * The first render marks nothing (everything already there is not "new"), and a key that
 * arrives while `enabled` is false is learned silently: a late upload or receipt on a
 * resolved phase updates the card without drawing the eye to it (live = only what is live).
 */
export function useRecentKeys(keys: readonly string[], enabled: boolean, durationMs: number = RECENT_KEY_MS): ReadonlySet<string> {
  const [recent, setRecent] = useState<ReadonlySet<string>>(() => new Set())
  const known = useRef<ReadonlySet<string> | null>(null)
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const signature = keys.join('\u0000')

  useEffect(() => {
    const previous = known.current
    const current = new Set(signature === '' ? [] : signature.split('\u0000'))
    known.current = current
    if (previous === null || !enabled) return
    const fresh = [...current].filter(key => !previous.has(key))
    if (fresh.length === 0) return
    setRecent(existing => new Set([...existing, ...fresh]))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setRecent(existing => new Set([...existing].filter(key => !fresh.includes(key))))
    }, durationMs)
    timers.current.add(timer)
  }, [signature, enabled, durationMs])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return recent
}
