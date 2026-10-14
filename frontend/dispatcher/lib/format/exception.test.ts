import { describe, expect, it } from 'vitest'
import type { VehicleId } from '@shared/lib/types/vehicle'
import { fmtBreakdownVehicle, fmtClaimedFor, fmtExceptionRaisedParts, fmtExceptionType } from './exception'

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
