import { describe, expect, it } from 'vitest'
import type { BusyEntry } from '@shared/lib/types/availability'
import {
  availabilityWindow, busyById, busyNote, fmtFreeAt, NOBODY_BUSY, pickedBusyError, validateCrewAvailability,
} from './crew-availability'
import { EMPTY_CREW, NO_TIMES } from './manifest-form'

const FRI_1600 = '2026-10-16T14:00:00Z'

function entry(overrides: Partial<BusyEntry> = {}): BusyEntry {
  return {
    resource_type: 'horse', resource_id: 'h-1', label: 'CA 441 892', trip_id: 't-1', trip_reference: 'TRP-0038',
    trip_status: 'created', busy_from: '2026-10-16T06:00:00Z', busy_until: FRI_1600, planned_until: FRI_1600,
    ...overrides,
  }
}

describe('availabilityWindow', () => {
  it('asks nothing until both times are entered', () => {
    expect(availabilityWindow(NO_TIMES)).toBeNull()
    expect(availabilityWindow({ departure: '2026-10-16T08:00', arrival: '' })).toBeNull()
  })

  it('asks nothing for an arrival before the departure', () => {
    expect(availabilityWindow({ departure: '2026-10-16T08:00', arrival: '2026-10-16T07:00' })).toBeNull()
  })

  it('reads the inputs as SAST and asks in UTC', () => {
    expect(availabilityWindow({ departure: '2026-10-16T08:00', arrival: '2026-10-16T16:00' })).toEqual({
      startIso: '2026-10-16T06:00:00.000Z', endIso: FRI_1600.replace('Z', '.000Z'),
    })
  })
})

describe('busyById', () => {
  it('keeps the trip that frees a resource last', () => {
    const early = entry({ trip_reference: 'TRP-1', busy_until: '2026-10-16T10:00:00Z' })
    const late = entry({ trip_reference: 'TRP-2', busy_until: FRI_1600 })

    expect(busyById([late, early]).get('h-1')?.trip_reference).toBe('TRP-2')
    expect(busyById([early, late]).get('h-1')?.trip_reference).toBe('TRP-2')
  })

  it('treats "until it closes" as later than any time', () => {
    const open = entry({ trip_reference: 'TRP-LIVE', busy_until: null, trip_status: 'active' })

    expect(busyById([entry(), open]).get('h-1')?.trip_reference).toBe('TRP-LIVE')
    expect(busyById([open, entry()]).get('h-1')?.trip_reference).toBe('TRP-LIVE')
  })
})

describe('wording', () => {
  it('formats the free time in SAST, like the server', () => {
    expect(fmtFreeAt(FRI_1600)).toBe('Fri 16 Oct, 16:00')
  })

  it('says when a planned trip frees the option', () => {
    expect(busyNote(entry())).toBe('On TRP-0038 · free after Fri 16 Oct, 16:00')
  })

  it('says a live overrunning trip frees it only when it closes', () => {
    expect(busyNote(entry({ trip_status: 'exception_hold', busy_until: null })))
      .toBe('On TRP-0038 · under way, free when it closes')
  })

  it('says an old trip with no arrival frees it only when closed', () => {
    expect(busyNote(entry({ busy_until: null, planned_until: null })))
      .toBe('On TRP-0038 · no planned arrival, free when it is closed')
  })

  it('names the picked crew, the trip and the time in the field error', () => {
    expect(pickedBusyError(entry())).toBe(
      'CA 441 892 is busy in this window: on TRP-0038 until Fri 16 Oct, 16:00. Pick another, or change the times.',
    )
  })
})

describe('validateCrewAvailability', () => {
  it('flags each picked driver, horse and trailer that is busy', () => {
    const busy = busyById([
      entry({ resource_type: 'driver', resource_id: 'd-1', label: 'Sipho' }),
      entry({ resource_id: 'h-1' }),
      entry({ resource_type: 'trailer', resource_id: 't-9', label: 'CA 789 013' }),
    ])

    const errors = validateCrewAvailability({ driverId: 'd-1', horseId: 'h-1', trailerIds: ['t-2', 't-9'] }, busy)

    expect(errors.driver).toMatch(/^Sipho is busy/)
    expect(errors.horse).toMatch(/^CA 441 892 is busy/)
    expect(errors.trailers).toMatch(/^CA 789 013 is busy/)
  })

  it('says nothing when the picks are free or nothing is known', () => {
    expect(validateCrewAvailability({ ...EMPTY_CREW, horseId: 'h-2' }, busyById([entry()]))).toEqual({})
    expect(validateCrewAvailability({ ...EMPTY_CREW, horseId: 'h-1' }, NOBODY_BUSY)).toEqual({})
  })
})
