import { describe, expect, it } from 'vitest'
import { BACKOFF_MAX_MS, backoffMs, parseFrame } from './sse'
import type { RealtimeEvent } from './types'

describe('parseFrame', () => {
  const event: RealtimeEvent = {
    resource: 'trip',
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'phase_completed',
    ts: '2026-08-05T10:00:00Z',
  }

  it('parses a data frame into an event', () => {
    expect(parseFrame(`data: ${JSON.stringify(event)}`)).toEqual(event)
  })

  it('tolerates a data line with no space after the colon', () => {
    expect(parseFrame(`data:${JSON.stringify(event)}`)).toEqual(event)
  })

  it('ignores comment/heartbeat frames', () => {
    expect(parseFrame(': heartbeat')).toBeNull()
    expect(parseFrame(': connected')).toBeNull()
  })

  it('ignores empty frames', () => {
    expect(parseFrame('')).toBeNull()
  })

  it('returns null for a data line that is not valid JSON', () => {
    expect(parseFrame('data: not-json')).toBeNull()
  })

  it('joins multi-line data payloads before parsing', () => {
    const framed = `data: ${'{"resource":"trip",'}\ndata: ${'"id":"x","kind":"trip_created","ts":"t"}'}`
    expect(parseFrame(framed)).toEqual({ resource: 'trip', id: 'x', kind: 'trip_created', ts: 't' })
  })
})

describe('backoffMs', () => {
  it('grows exponentially with the attempt number', () => {
    // rng() = 0 removes the jitter, leaving the deterministic floor (capped / 2).
    expect(backoffMs(1, () => 0)).toBe(500) // 1000/2
    expect(backoffMs(2, () => 0)).toBe(1_000) // 2000/2
    expect(backoffMs(3, () => 0)).toBe(2_000) // 4000/2
  })

  it('never exceeds the cap, even at high attempt counts', () => {
    // rng() = 1 gives the maximum jitter; the total must still not exceed the cap.
    expect(backoffMs(50, () => 1)).toBeLessThanOrEqual(BACKOFF_MAX_MS)
    expect(backoffMs(50, () => 0)).toBe(BACKOFF_MAX_MS / 2)
  })
})
