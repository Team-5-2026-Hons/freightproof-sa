import { describe, it, expect } from 'vitest'
import { handshakeProgress, currentHandshakeNumber } from '../handshake-progress'
import type { HandshakeEvent, HandshakeEventId, HandshakeNumber, HandshakeStatus, HandshakeType } from '@shared/lib/types/handshake'

const HANDSHAKE_TYPE_BY_SEQ: Record<1 | 2 | 3 | 4 | 5, HandshakeType> = {
  1: 'origin_gate_in',
  2: 'loading',
  3: 'origin_gate_out',
  4: 'dest_gate_in',
  5: 'unloading',
}

function makeEvent(sequence: 1 | 2 | 3 | 4 | 5, status: HandshakeStatus): HandshakeEvent {
  return {
    id: `he-${sequence}` as HandshakeEventId,
    trip_id: 'trip-1',
    handshake_type: HANDSHAKE_TYPE_BY_SEQ[sequence],
    sequence_number: sequence as HandshakeNumber,
    status,
    dispatcher_override_user_id: null,
    dispatcher_override_note: null,
    driver_phone_lat: null,
    driver_phone_lng: null,
    horse_gps_lat: null,
    horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null,
    seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null,
    gate_photo_artifact_id: null,
    pod_photo_artifact_id: null,
    parcel_count_origin: null,
    parcel_count_destination: null,
    driver_visual_count: null,
    event_hash: null,
    blockchain_receipt_id: null,
    completed_at: null,
    created_at: '2026-06-20T07:00:00Z',
    updated_at: '2026-06-20T07:00:00Z',
  }
}

describe('handshakeProgress', () => {
  it('marks a stage with no matching event as upcoming', () => {
    const result = handshakeProgress([])

    expect(result).toEqual({ 1: 'upcoming', 2: 'upcoming', 3: 'upcoming', 4: 'upcoming', 5: 'upcoming' })
  })

  it('marks a pending event as upcoming', () => {
    const result = handshakeProgress([makeEvent(1, 'pending')])

    expect(result[1]).toBe('upcoming')
  })

  it('marks an in_progress event as current', () => {
    const result = handshakeProgress([makeEvent(2, 'in_progress')])

    expect(result[2]).toBe('current')
  })

  it('marks completed and overridden events as completed', () => {
    const result = handshakeProgress([makeEvent(1, 'completed'), makeEvent(2, 'overridden')])

    expect(result[1]).toBe('completed')
    expect(result[2]).toBe('completed')
  })

  it('marks an exception event as exception', () => {
    const result = handshakeProgress([makeEvent(3, 'exception')])

    expect(result[3]).toBe('exception')
  })

  it('reflects a trip in transit between H3 and H4 — H1-3 completed, H4-5 upcoming, none current', () => {
    const result = handshakeProgress([
      makeEvent(1, 'completed'),
      makeEvent(2, 'completed'),
      makeEvent(3, 'completed'),
      makeEvent(4, 'pending'),
      makeEvent(5, 'pending'),
    ])

    expect(result).toEqual({ 1: 'completed', 2: 'completed', 3: 'completed', 4: 'upcoming', 5: 'upcoming' })
  })
})

describe('currentHandshakeNumber', () => {
  it('returns H1 before any handshake has started', () => {
    const progress = handshakeProgress([])

    expect(currentHandshakeNumber(progress)).toBe(1)
  })

  it('returns H1 while it is in progress', () => {
    const progress = handshakeProgress([makeEvent(1, 'in_progress')])

    expect(currentHandshakeNumber(progress)).toBe(1)
  })

  it('returns H2 once H1 is completed and H2 has not started', () => {
    const progress = handshakeProgress([makeEvent(1, 'completed')])

    expect(currentHandshakeNumber(progress)).toBe(2)
  })

  it('returns H3 once H1 and H2 are completed and H3 is in progress', () => {
    const progress = handshakeProgress([
      makeEvent(1, 'completed'),
      makeEvent(2, 'completed'),
      makeEvent(3, 'in_progress'),
    ])

    expect(currentHandshakeNumber(progress)).toBe(3)
  })

  it('returns the exception stage rather than skipping past it', () => {
    const progress = handshakeProgress([
      makeEvent(1, 'completed'),
      makeEvent(2, 'exception'),
    ])

    expect(currentHandshakeNumber(progress)).toBe(2)
  })

  it('returns null once every handshake is completed', () => {
    const progress = handshakeProgress([
      makeEvent(1, 'completed'),
      makeEvent(2, 'completed'),
      makeEvent(3, 'completed'),
      makeEvent(4, 'completed'),
      makeEvent(5, 'completed'),
    ])

    expect(currentHandshakeNumber(progress)).toBeNull()
  })
})
