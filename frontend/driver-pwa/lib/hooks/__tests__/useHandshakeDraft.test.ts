// frontend/driver-pwa/lib/hooks/__tests__/useHandshakeDraft.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useHandshakeDraft } from '../useHandshakeDraft'
import type { H1Evidence } from '@/lib/types/evidence-draft'

// gateAddress added to H1Evidence (reverse-geocoded address, consumed by Task 7) —
// included here as null since this fixture predates that field.
const INITIAL: H1Evidence = {
  gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, gateAddress: null, capturedAt: null,
}

beforeEach(() => localStorage.clear())

describe('useHandshakeDraft', () => {
  it('returns initial state when nothing is stored', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    expect(result.current[0]).toEqual(INITIAL)
  })

  it('updateDraft merges partial patch into draft', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09, gpsLng: 28.13 }))
    expect(result.current[0].gpsLat).toBe(-26.09)
    expect(result.current[0].gpsLng).toBe(28.13)
  })

  it('persists draft to localStorage', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    const stored = JSON.parse(localStorage.getItem('fp_draft_trip-1_origin_gate_in') ?? '{}')
    expect(stored.gpsLat).toBe(-26.09)
  })

  it('clearDraft resets to initial and removes storage key', () => {
    const { result } = renderHook(() =>
      useHandshakeDraft<H1Evidence>('trip-1', 'origin_gate_in', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(INITIAL)
    expect(localStorage.getItem('fp_draft_trip-1_origin_gate_in')).toBeNull()
  })
})
