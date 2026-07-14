// frontend/driver-pwa/lib/hooks/useSealReference.ts
'use client'

import { useState, useCallback } from 'react'

const storageKey = (tripId: string): string => `fp:seal-reference:${tripId}`

// The seal number set at H2 (loading) needs to survive past the moment H2's own draft is
// cleared — H3 (exit) and H4 (destination) both compare against it, and by the time the
// driver reaches those steps the H2 draft is long gone (see HandshakeStepPageClient's
// submitAndAdvance, which clears each handshake's draft on success). This is a separate,
// durable per-trip key rather than reusing the H2 draft key so it isn't accidentally wiped
// by useHandshakeDraft's own clear — it is only cleared explicitly, when the trip closes.
export function useSealReference(
  tripId: string,
): [sealReference: string | null, setSealReference: (seal: string | null) => void, clearSealReference: () => void] {
  const key = storageKey(tripId)

  const [sealReference, setSealReferenceState] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null
    } catch {
      return null
    }
  })

  const setSealReference = useCallback(
    (seal: string | null) => {
      try {
        if (seal === null) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, seal)
        }
      } catch {
        // Quota exceeded, private browsing, or storage disabled — the reference still
        // updates in memory for this session, but a refresh at H3/H4 would lose it.
        console.warn(`useSealReference: failed to persist seal reference for key "${key}"`)
      }
      setSealReferenceState(seal)
    },
    [key],
  )

  const clearSealReference = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      console.warn(`useSealReference: failed to clear seal reference for key "${key}"`)
    }
    setSealReferenceState(null)
  }, [key])

  return [sealReference, setSealReference, clearSealReference]
}
