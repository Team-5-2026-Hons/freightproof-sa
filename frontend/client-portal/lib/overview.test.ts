import { describe, expect, it } from 'vitest'
import { cargoTotals, incidentBreakAfter } from './overview'
import { makeIncident, makeManifest, makePhase } from '@/test/factories'
import type { ConsignmentRecord } from './types'

function consignment(id: string, declaredValue: string | null, parcels: number): ConsignmentRecord {
  return {
    consignment_id: id, parcel_perfect_reference: `PP-${id}`, client_name: null, declared_value: declaredValue,
    parcel_count_expected: parcels, unit_count_expected: null, pickup_stop_id: null, delivery_stop_id: null,
    parcels: Array.from({ length: parcels }, (_, i) => ({
      barcode: `${id}-${i}`, status: 'in_transit', pp_scan_out_at: null, pp_scan_in_at: null,
    })),
  }
}

describe('cargoTotals', () => {
  it('sums declared values to the cent and counts parcels across consignments', () => {
    // Arrange
    const manifest = makeManifest({ consignments: [consignment('a', '0.10', 2), consignment('b', '0.20', 3)] })

    // Act
    const totals = cargoTotals(manifest)

    // Assert
    expect(totals).toEqual({ declaredValue: '0.30', valued: 2, consignments: 2, parcels: 5 })
  })

  it('reports a partial sum when some consignments have no declared value', () => {
    // Arrange
    const manifest = makeManifest({ consignments: [consignment('a', '1845000.00', 1), consignment('b', null, 1)] })

    // Act
    const totals = cargoTotals(manifest)

    // Assert
    expect(totals.declaredValue).toBe('1845000.00')
    expect(totals.valued).toBe(1)
    expect(totals.consignments).toBe(2)
  })

  it('returns no value when nothing was declared', () => {
    // Act
    const totals = cargoTotals(makeManifest({ consignments: [consignment('a', null, 0)] }))

    // Assert
    expect(totals.declaredValue).toBeNull()
  })
})

describe('incidentBreakAfter', () => {
  const phases = [
    makePhase(0, 'trip_creation'),
    makePhase(3, 'departure'),
    makePhase(4, 'in_transit', { status: 'pending', completed_at: null }),
  ]

  it('is the last phase completed at or before the incident was raised', () => {
    // Arrange: phase 3 completes at 09:00, the incident is at 11:00.
    const manifest = makeManifest({ phases, incident: makeIncident({ first_raised_at: '2026-09-12T11:00:00Z' }) })

    // Act / Assert
    expect(incidentBreakAfter(manifest)).toBe(3)
  })

  it('is null when the incident came before any phase was completed', () => {
    // Arrange
    const manifest = makeManifest({ phases, incident: makeIncident({ first_raised_at: '2026-09-12T05:00:00Z' }) })

    // Act / Assert
    expect(incidentBreakAfter(manifest)).toBeNull()
  })

  it('is null for a trip with no incident', () => {
    // Act / Assert
    expect(incidentBreakAfter(makeManifest({ phases }))).toBeNull()
  })
})
