import { describe, expect, it } from 'vitest'
import type { VehicleId } from '@shared/lib/types/vehicle'
import { fmtBreakdownVehicle, fmtExceptionType } from './exception'

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
