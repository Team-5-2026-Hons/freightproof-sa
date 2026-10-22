import { describe, expect, it } from 'vitest'
import type { VehicleId } from '@shared/lib/types/vehicle'
import { exceptionDescriptionText, exceptionReference, matchesExceptionReference, fmtBreakdownVehicle, fmtClaimedFor, fmtExceptionRaisedParts, fmtExceptionType } from './exception'

describe('fmtExceptionType', () => {
  it('title-cases every word of a snake_case enum', () => {
    expect(fmtExceptionType('waybill_count_mismatch')).toBe('Waybill Count Mismatch')
  })

  it('handles a single-word type', () => {
    expect(fmtExceptionType('mechanical')).toBe('Mechanical')
  })

  it('handles the two-word driver types', () => {
    expect(fmtExceptionType('panic_button')).toBe('Panic Button')
    expect(fmtExceptionType('seal_broken_in_transit')).toBe('Seal Broken In Transit')
  })

  it('uses the explicit label for driver–vehicle separation instead of generic title-casing', () => {
    expect(fmtExceptionType('driver_vehicle_separation')).toBe('Driver–vehicle separation')
  })

  it('uses the explicit label for driver location mismatch instead of generic title-casing', () => {
    expect(fmtExceptionType('driver_location_mismatch')).toBe('Driver outside precinct')
  })

  it('writes the ID abbreviation in capitals', () => {
    expect(fmtExceptionType('receiver_id_mismatch')).toBe('Receiver ID Mismatch')
    expect(fmtExceptionType('receiver_id_unverified')).toBe('Receiver ID Unverified')
  })
})

describe('fmtBreakdownVehicle', () => {
  const RECORDED_ID = 'vehicle-1' as VehicleId

  it('names a trailer by kind and plate', () => {
    expect(fmtBreakdownVehicle({
      vehicle_id: RECORDED_ID, vehicle_type: 'trailer', vehicle_registration: 'TRL 222 GP',
    })).toBe('Trailer · TRL 222 GP')
  })

  it('names a horse by kind and plate', () => {
    expect(fmtBreakdownVehicle({
      vehicle_id: RECORDED_ID, vehicle_type: 'horse', vehicle_registration: 'CA 123-456',
    })).toBe('Horse · CA 123-456')
  })

  it('says "Not recorded" when no vehicle was recorded', () => {
    expect(fmtBreakdownVehicle({
      vehicle_id: null, vehicle_type: null, vehicle_registration: null,
    })).toBe('Not recorded')
  })

  it('shows a dash when the recorded vehicle can no longer be found', () => {
    // The backend returns the id but can look up neither kind nor plate.
    expect(fmtBreakdownVehicle({
      vehicle_id: RECORDED_ID, vehicle_type: null, vehicle_registration: null,
    })).toBe('—')
  })
})

describe('driver transfer exception label', () => {
  it('reads_as_a_request_for_review_not_a_bare_type_name', () => {
    expect(fmtExceptionType('driver_substitution')).toBe('Driver transfer needs review')
  })
})

describe('road exception labels', () => {
  it.each([
    ['trailer_separated_in_transit', 'Trailer separated on the road'],
    ['moved_before_departure', 'Moved before departure'],
    ['tracker_silent', 'Tracker silent'],
  ])('labels %s', (type, label) => {
    expect(fmtExceptionType(type)).toBe(label)
  })
})

describe('fmtExceptionRaisedParts', () => {
  it('returns the day and the time as separate strings, never one joined string', () => {
    const parts = fmtExceptionRaisedParts('2026-10-01T10:50:00Z')
    expect(parts).toEqual({ day: '01 Oct 2026', time: '12:50 SAST' })
    // Guards the regression: a locale that joins with " at " must not leak into either part.
    expect(parts?.day).not.toMatch(/ at /)
    expect(parts?.time).not.toMatch(/ at /)
  })
  it('uses the South African clock at the day boundary', () => {
    expect(fmtExceptionRaisedParts('2026-10-01T21:59:00Z')?.day).toBe('01 Oct 2026')
    expect(fmtExceptionRaisedParts('2026-10-01T22:00:00Z')?.day).toBe('02 Oct 2026')
  })
  it('is null for an unreadable timestamp', () => {
    expect(fmtExceptionRaisedParts('')).toBeNull()
  })
})

describe('fmtClaimedFor', () => {
  const NOW = new Date('2026-10-05T12:00:00Z')
  it('says just now inside the first minute', () => {
    expect(fmtClaimedFor('2026-10-05T11:59:40Z', NOW)).toBe('just now')
  })
  it('reads minutes and hours', () => {
    expect(fmtClaimedFor('2026-10-05T11:58:00Z', NOW)).toBe('2 min ago')
    expect(fmtClaimedFor('2026-10-05T09:00:00Z', NOW)).toBe('3 h ago')
  })
  it('is null when there is no usable claim time', () => {
    expect(fmtClaimedFor(null, NOW)).toBeNull()
    expect(fmtClaimedFor('garbage', NOW)).toBeNull()
  })
})

describe('exceptionReference', () => {
  it('is EX- plus the first eight hex characters of the id, uppercased', () => {
    expect(exceptionReference('3f9a21c4-5b6d-4e7f-8a90-b1c2d3e4f506')).toBe('EX-3F9A21C4')
  })

  it('gives the same reference for the same id and different ones for different ids', () => {
    const a = '3f9a21c4-5b6d-4e7f-8a90-b1c2d3e4f506'
    const b = '3f9a21c5-5b6d-4e7f-8a90-b1c2d3e4f506'

    expect(exceptionReference(a)).toBe(exceptionReference(a))
    expect(exceptionReference(a)).not.toBe(exceptionReference(b))
  })

  it('does not throw for a short non-UUID id', () => {
    expect(exceptionReference('abc')).toBe('EX-ABC')
  })
})

describe('matchesExceptionReference', () => {
  const id = '3f9a21c4-5b6d-4e7f-8a90-b1c2d3e4f506'

  it('matches part of the hex, with or without the EX- prefix, in any case', () => {
    for (const q of ['3f9a', '3F9A21C4', 'EX-3F9A', 'ex-3f9a21c4']) expect(matchesExceptionReference(id, q), q).toBe(true)
  })

  it('does not match on the prefix alone or on text that is not in the hex', () => {
    for (const q of ['x', 'ex', 'zz', 'ex-ffff']) expect(matchesExceptionReference(id, q), q).toBe(false)
  })
})

describe('exceptionDescriptionText', () => {
  const USER_ID = '3f2a9c1e-7b4d-4e8a-9d21-5a6c0b8e1f34'
  const note = (description: string, reviewed_by_name?: string | null) =>
    ({ exception_type: 'dispatcher_note', description, reviewed_by_name })

  it('replaces the cancelling user id with the reviewer name', () => {
    expect(exceptionDescriptionText(note(`Cancelled by user ${USER_ID}: Trip stopped by dispatch.`, 'Demo Dispatcher')))
      .toBe('Cancelled by Demo Dispatcher: Trip stopped by dispatch.')
  })

  it('falls_back_to_a_dispatcher_when_no_name_is_known', () => {
    expect(exceptionDescriptionText(note(`Cancelled by user ${USER_ID}: Stopped.`, null)))
      .toBe('Cancelled by a dispatcher: Stopped.')
    expect(exceptionDescriptionText(note(`Cancelled by user ${USER_ID}: Stopped.`)))
      .toBe('Cancelled by a dispatcher: Stopped.')
  })

  it('leaves other dispatcher notes untouched', () => {
    const description = 'Called the driver; running late.'
    expect(exceptionDescriptionText(note(description, 'Demo Dispatcher'))).toBe(description)
  })

  it('leaves other exception types untouched even when the text looks like a cancellation', () => {
    const description = `Cancelled by user ${USER_ID}: Stopped.`
    expect(exceptionDescriptionText({ exception_type: 'panic_button', description, reviewed_by_name: 'Demo Dispatcher' })).toBe(description)
  })
})
