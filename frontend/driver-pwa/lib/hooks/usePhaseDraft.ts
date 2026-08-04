// frontend/driver-pwa/lib/hooks/usePhaseDraft.ts
'use client'

import { useState, useCallback } from 'react'

const storageKey = (tripId: string, phaseEventId: string): string =>
  `fp_draft_${tripId}_${phaseEventId}`

// Renamed from useHandshakeDraft, which keyed its storage on (tripId, handshakeType) —
// a fixed 1-5 handshake enum where each type occurred at most once per trip. Under the
// phase model a trip's plan LENGTH IS DATA (parent plan §2.2) and a phase_type can
// recur: a three-stop cross-dock visits `unloading` up to three times. Keying by
// phase_type alone, as the old hook did, would collide every occurrence of that type
// onto the SAME localStorage key — a driver's seal entry at the first `unloading`
// would silently leak into (or get clobbered by) the draft for the second. Keying on
// phase_event_id — a real per-row UUID, unique even across repeated phase types —
// is exactly what this rename exists to prevent that collision.
export function usePhaseDraft<T extends object>(
  tripId: string,
  phaseEventId: string,
  initial: T,
): [draft: T, updateDraft: (patch: Partial<T>) => void, clearDraft: () => void] {
  const key = storageKey(tripId, phaseEventId)

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
          console.warn(`usePhaseDraft: failed to persist draft for key "${key}"`)
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
      console.warn(`usePhaseDraft: failed to clear stored draft for key "${key}"`)
    }
    setDraft(initial)
  }, [key, initial])

  return [draft, updateDraft, clearDraft]
}
