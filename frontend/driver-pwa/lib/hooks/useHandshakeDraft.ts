// frontend/driver-pwa/lib/hooks/useHandshakeDraft.ts
'use client'

import { useState, useCallback } from 'react'
import type { HandshakeType } from '@shared/lib/types/handshake'

const storageKey = (tripId: string, type: HandshakeType): string =>
  `fp_draft_${tripId}_${type}`

export function useHandshakeDraft<T extends object>(
  tripId: string,
  handshakeType: HandshakeType,
  initial: T,
): [draft: T, updateDraft: (patch: Partial<T>) => void, clearDraft: () => void] {
  const key = storageKey(tripId, handshakeType)

  const [draft, setDraft] = useState<T>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null
      // Shallow-merge over `initial` rather than returning the parsed value raw —
      // a draft saved under an older shape of T (e.g. before a field existed) would
      // otherwise silently omit that field despite the return type claiming it exists.
      return raw ? { ...initial, ...(JSON.parse(raw) as Partial<T>) } : initial
    } catch {
      return initial
    }
  })

  const updateDraft = useCallback(
    (patch: Partial<T>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch }
        try {
          // Synchronous write here (inside the updater, not a useEffect keyed on `draft`)
          // is load-bearing: every step component calls onUpdate(patch) then immediately
          // calls onComplete()/navigates in the same tick. If this write moved to a
          // useEffect, that call-then-navigate pattern would silently lose the last patch
          // on fast navigation, since the effect wouldn't have flushed yet.
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          // Quota exceeded, private browsing, or storage disabled — draft still
          // updates in memory, but won't survive a refresh. Surface this since the
          // hook's entire purpose is persistence across navigation/refresh.
          console.warn(`useHandshakeDraft: failed to persist draft for key "${key}"`)
        }
        return next
      })
    },
    [key],
  )

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      console.warn(`useHandshakeDraft: failed to clear stored draft for key "${key}"`)
    }
    setDraft(initial)
  }, [key, initial])

  return [draft, updateDraft, clearDraft]
}
