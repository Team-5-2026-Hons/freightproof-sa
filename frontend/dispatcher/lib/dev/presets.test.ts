import { describe, expect, it } from 'vitest'
import { barcodesForPreset, describeRoadCheck, ppDate, ppRequestForPreset, DEMO_FAILURE_REASON } from './presets'
import type { DevConsignment, RoadCheckResponse } from '@/lib/types/dev'

const WB1: DevConsignment = { consignment_id: 'c1', parcel_perfect_reference: 'WB-1', barcodes: ['A', 'B', 'C'] }
const WB2: DevConsignment = { consignment_id: 'c2', parcel_perfect_reference: 'WB-2', barcodes: ['D'] }

describe('barcodesForPreset', () => {
  it('scans everything for "all"', () => {
    expect(barcodesForPreset([WB1, WB2], 'all')).toEqual({ 'WB-1': ['A', 'B', 'C'], 'WB-2': ['D'] })
  })

  it('drops exactly one parcel from the first waybill for "one_short"', () => {
    expect(barcodesForPreset([WB1, WB2], 'one_short')).toEqual({ 'WB-1': ['A', 'B'], 'WB-2': ['D'] })
  })

  it('adds one stable stray barcode for "stray", so pressing twice stages the same scan', () => {
    const once = barcodesForPreset([WB1], 'stray')

    expect(once['WB-1']).toHaveLength(4)
    expect(barcodesForPreset([WB1], 'stray')).toEqual(once)
  })
})

describe('Parcel Perfect presets', () => {
  const now = new Date('2026-09-24T10:00:00Z')

  it('formats the POD date the way PP does', () => {
    expect(ppDate(now)).toBe('24/09/2026')
  })

  it('builds a delivered request with today as POD date', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'delivered', now)).toEqual({ trip_id: 'trip-1', parcel_perfect_reference: 'WB-1', poddate: '24/09/2026' })
  })

  it('builds a failed delivery with a reason', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'delivery_failed', now).failtype).toBe(DEMO_FAILURE_REASON)
  })

  it('adds one parcel to the waybill for "parcel_added"', () => {
    expect(ppRequestForPreset('trip-1', WB1, 'parcel_added', now).parcel_count).toBe(4)
  })
})

describe('describeRoadCheck', () => {
  const base: RoadCheckResponse = { trip_id: 't', readings: [], findings: [], skipped_reason: null }

  it('says when nothing new was found', () => {
    expect(describeRoadCheck(base)).toBe('Tracker check: nothing new.')
  })

  it('counts new findings and names them', () => {
    expect(describeRoadCheck({
      ...base,
      findings: [
        { exception_type: 'trailer_separated_in_transit', severity: 'critical', vehicle_id: 'v', description: 'd', newly_recorded: true },
        { exception_type: 'tracker_silent', severity: 'warning', vehicle_id: 'w', description: 'd', newly_recorded: false },
      ],
    })).toBe('Tracker check: 1 new finding (Trailer separated on the road).')
  })

  it('reports why the check was skipped', () => {
    expect(describeRoadCheck({ ...base, skipped_reason: 'Trip is closed.' })).toBe('Tracker check skipped: Trip is closed.')
  })
})
