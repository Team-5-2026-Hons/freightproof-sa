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
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  const updateDraft = useCallback(
    (patch: Partial<T>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch }
        try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage full */ }
        return next
      })
    },
    [key],
  )

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    setDraft(initial)
  }, [key, initial])

  return [draft, updateDraft, clearDraft]
}
