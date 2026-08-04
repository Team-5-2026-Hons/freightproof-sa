// frontend/driver-pwa/lib/hooks/useVisualCountCarry.ts
'use client'

import { useState, useCallback } from 'react'

const storageKey = (tripId: string): string => `fp:visual-count-carry:${tripId}`

// The visual count captured at unloading's last step (4-visual-count, see
// components/phase/steps/unloading/VisualCount.tsx) has no field on
// UnloadingCompleteRequest — only confirmation's driver_visual_count carries it on the
// wire (lib/types/evidence-draft.ts's header comment). `unloading` and `confirmation`
// are separate phase_event_id rows with separate usePhaseDraft-backed drafts, and
// unloading's draft is cleared the moment it submits successfully — so this count needs
// the same durable, per-trip carry-forward mechanism lib/hooks/useSealReference.ts
// already built for the seal (departure -> unloading).
//
// Mirrors that hook's shape exactly rather than generalising it into one parametrised
// hook: the two carried values have different underlying types (string vs number) and
// are read/written by different phase pairs — forcing a shared generic would only hide
// that they're two independent one-off bridges, not one reusable capability, for the
// sake of a few lines saved.
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
        // Quota exceeded, private browsing, or storage disabled — the carried count
        // still updates in memory for this session, but a refresh at confirmation
        // would lose it.
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
