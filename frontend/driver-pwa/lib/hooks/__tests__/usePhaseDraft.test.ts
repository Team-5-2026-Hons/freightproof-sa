import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { usePhaseDraft } from '../usePhaseDraft'
import type { ActivationEvidence, ArrivalEvidence } from '@/lib/types/evidence-draft'

// Activation's draft is down to capturedAt (its GPS fields moved out when the manual
// capture step was removed), so the patch/persist cases below exercise ARRIVAL_INITIAL
// instead — this one still proves the "nothing stored yet" path.
const INITIAL: ActivationEvidence = { capturedAt: null }

// The seal check moved from unloading to its own arrival phase — this suite's
// string-field draft now exercises ArrivalEvidence, the current home of that evidence.
const ARRIVAL_INITIAL: ArrivalEvidence = {
  sealCondition: null, sealNumberAtArrival: null,
  sealPhotoDataUrl: null, sealPhotoArtifactId: null, capturedAt: null,
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
      usePhaseDraft<ArrivalEvidence>('trip-1', 'phase-event-1', ARRIVAL_INITIAL)
    )
    act(() => result.current[1]({ sealNumberAtArrival: 'AB-1234', sealCondition: 'intact' }))
    expect(result.current[0].sealNumberAtArrival).toBe('AB-1234')
    expect(result.current[0].sealCondition).toBe('intact')
  })

  it('persists draft to localStorage keyed by phase_event_id', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ArrivalEvidence>('trip-1', 'phase-event-1', ARRIVAL_INITIAL)
    )
    act(() => result.current[1]({ sealNumberAtArrival: 'AB-1234' }))
    const stored = JSON.parse(localStorage.getItem('fp_draft_trip-1_phase-event-1') ?? '{}')
    expect(stored.sealNumberAtArrival).toBe('AB-1234')
  })

  it('clearDraft resets to initial and removes storage key', () => {
    const { result } = renderHook(() =>
      usePhaseDraft<ArrivalEvidence>('trip-1', 'phase-event-1', ARRIVAL_INITIAL)
    )
    act(() => result.current[1]({ sealNumberAtArrival: 'AB-1234' }))
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(ARRIVAL_INITIAL)
    expect(localStorage.getItem('fp_draft_trip-1_phase-event-1')).toBeNull()
  })

  it('falls back to initial value for keys missing from a stale stored draft', () => {
    // Simulates a draft saved under an older ArrivalEvidence shape, before
    // sealCondition existed. This is not hypothetical for the current release: a
    // driver mid-trip when the shape changed has drafts on disk written under the
    // previous shapes, and they must not resurrect fields the type no longer has.
    const staleDraft = {
      sealNumberAtArrival: 'AB-1234', capturedAt: '2026-01-01T00:00:00Z',
    }
    localStorage.setItem('fp_draft_trip-1_phase-event-1', JSON.stringify(staleDraft))

    const { result } = renderHook(() =>
      usePhaseDraft<ArrivalEvidence>('trip-1', 'phase-event-1', ARRIVAL_INITIAL)
    )

    expect(result.current[0].sealCondition).toBe(ARRIVAL_INITIAL.sealCondition)
    expect(result.current[0].sealNumberAtArrival).toBe('AB-1234')
  })

  // The rename's whole reason to exist: the old useHandshakeDraft keyed storage on
  // (tripId, handshakeType), which collides every occurrence of a repeated phase type
  // onto one key. A three-stop cross-dock visits `arrival` more than once — this
  // proves two such occurrences (different phase_event_id, same phase_type) get
  // independent drafts instead of one clobbering the other.
  it('drafts for two different arrival phase_event_ids in one trip do not collide', () => {
    const first = renderHook(() =>
      usePhaseDraft<ArrivalEvidence>('trip-1', 'arrival-event-1', ARRIVAL_INITIAL)
    )
    const second = renderHook(() =>
      usePhaseDraft<ArrivalEvidence>('trip-1', 'arrival-event-2', ARRIVAL_INITIAL)
    )

    act(() => first.result.current[1]({ sealNumberAtArrival: 'AB-1111', sealCondition: 'intact' }))
    act(() => second.result.current[1]({ sealNumberAtArrival: 'CD-2222', sealCondition: 'damaged' }))

    expect(first.result.current[0].sealNumberAtArrival).toBe('AB-1111')
    expect(first.result.current[0].sealCondition).toBe('intact')
    expect(second.result.current[0].sealNumberAtArrival).toBe('CD-2222')
    expect(second.result.current[0].sealCondition).toBe('damaged')

    const storedFirst = JSON.parse(localStorage.getItem('fp_draft_trip-1_arrival-event-1') ?? '{}')
    const storedSecond = JSON.parse(localStorage.getItem('fp_draft_trip-1_arrival-event-2') ?? '{}')
    expect(storedFirst.sealNumberAtArrival).toBe('AB-1111')
    expect(storedSecond.sealNumberAtArrival).toBe('CD-2222')
  })
})
