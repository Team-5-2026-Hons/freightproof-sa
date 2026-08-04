import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { usePhaseDraft } from '../usePhaseDraft'
import type { ActivationEvidence, UnloadingEvidence } from '@/lib/types/evidence-draft'

const INITIAL: ActivationEvidence = {
  gpsLat: null, gpsLng: null, gateAddress: null, capturedAt: null,
}

const UNLOADING_INITIAL: UnloadingEvidence = {
  waybillHandedOver: null, sealNumberAtDestination: null, sealVerifiedMatch: null,
  sealBrokenPhotoDataUrl: null, driverVisualCount: null, capturedAt: null,
}

beforeEach(() => localStorage.clear())

describe('usePhaseDraft', () => {
  it('returns initial state when nothing is stored', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ActivationEvidence>('trip-1', 'phase-event-1', INITIAL)
    )
    expect(result.current[0]).toEqual(INITIAL)
  })

  it('updateDraft merges partial patch into draft', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ActivationEvidence>('trip-1', 'phase-event-1', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09, gpsLng: 28.13 }))
    expect(result.current[0].gpsLat).toBe(-26.09)
    expect(result.current[0].gpsLng).toBe(28.13)
  })

  it('persists draft to localStorage keyed by phase_event_id', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ActivationEvidence>('trip-1', 'phase-event-1', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    const stored = JSON.parse(localStorage.getItem('fp_draft_trip-1_phase-event-1') ?? '{}')
    expect(stored.gpsLat).toBe(-26.09)
  })

  it('clearDraft resets to initial and removes storage key', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ActivationEvidence>('trip-1', 'phase-event-1', INITIAL)
    )
    act(() => result.current[1]({ gpsLat: -26.09 }))
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(INITIAL)
    expect(localStorage.getItem('fp_draft_trip-1_phase-event-1')).toBeNull()
  })

  it('falls back to initial value for keys missing from a stale stored draft', () => {
    // Simulates a draft saved under an older ActivationEvidence shape, before gateAddress existed.
    const staleDraft = {
      gpsLat: -26.09, gpsLng: 28.13, capturedAt: '2026-01-01T00:00:00Z',
    }
    localStorage.setItem('fp_draft_trip-1_phase-event-1', JSON.stringify(staleDraft))

    const { result } = renderHook(() =>
      usePhaseDraft<ActivationEvidence>('trip-1', 'phase-event-1', INITIAL)
    )

    expect(result.current[0].gateAddress).toBe(INITIAL.gateAddress)
    expect(result.current[0].gpsLat).toBe(-26.09)
  })

  // The rename's whole reason to exist: the old useHandshakeDraft keyed storage on
  // (tripId, handshakeType), which collides every occurrence of a repeated phase type
  // onto one key. A three-stop cross-dock visits `unloading` more than once — this
  // proves two such occurrences (different phase_event_id, same phase_type) get
  // independent drafts instead of one clobbering the other.
  it('drafts for two different unloading phase_event_ids in one trip do not collide', () => {
    const first = renderHook(() =>
      usePhaseDraft<UnloadingEvidence>('trip-1', 'unloading-event-1', UNLOADING_INITIAL)
    )
    const second = renderHook(() =>
      usePhaseDraft<UnloadingEvidence>('trip-1', 'unloading-event-2', UNLOADING_INITIAL)
    )

    act(() => first.result.current[1]({ sealNumberAtDestination: 'AB-1111', driverVisualCount: 12 }))
    act(() => second.result.current[1]({ sealNumberAtDestination: 'CD-2222', driverVisualCount: 40 }))

    expect(first.result.current[0].sealNumberAtDestination).toBe('AB-1111')
    expect(first.result.current[0].driverVisualCount).toBe(12)
    expect(second.result.current[0].sealNumberAtDestination).toBe('CD-2222')
    expect(second.result.current[0].driverVisualCount).toBe(40)

    const storedFirst = JSON.parse(localStorage.getItem('fp_draft_trip-1_unloading-event-1') ?? '{}')
    const storedSecond = JSON.parse(localStorage.getItem('fp_draft_trip-1_unloading-event-2') ?? '{}')
    expect(storedFirst.sealNumberAtDestination).toBe('AB-1111')
    expect(storedSecond.sealNumberAtDestination).toBe('CD-2222')
  })
})
