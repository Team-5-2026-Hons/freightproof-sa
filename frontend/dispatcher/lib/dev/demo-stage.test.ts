import { describe, expect, it } from 'vitest'
import { demoStageFor, scanInOpen, scanOutOpen, sortTripsForPicker } from './demo-stage'
import type { DevTripStop, DevTripSummary } from '@/lib/types/dev'

function stop(overrides: Partial<DevTripStop> = {}): DevTripStop {
  return {
    trip_stop_id: 'stop-0', sequence: 0, precinct_name: 'Cape Town DC',
    pickup_consignments: [], delivery_consignments: [],
    loading_phase_status: null, confirmation_phase_status: null, preceding_departure_status: null,
    arrival_phase_status: null, unloading_phase_status: null,
    ...overrides,
  }
}

const ORIGIN = stop()
const MIDDLE = stop({ trip_stop_id: 'stop-1', sequence: 1, precinct_name: 'Worcester Hub' })
const DEST = stop({ trip_stop_id: 'stop-2', sequence: 2, precinct_name: 'Paarl Depot' })

function trip(overrides: Partial<DevTripSummary> = {}): DevTripSummary {
  return {
    trip_id: 'trip-1', trip_reference: 'FP-0042', status: 'active', current_phase: 'loading',
    driver_full_name: 'Driver', created_at: '2026-09-24T08:00:00Z',
    stops: [ORIGIN, DEST], current_stop_sequence: 0, vehicles: [],
    ...overrides,
  }
}

describe('demoStageFor', () => {
  it.each([
    ['activation', 'before_departure'], ['loading', 'before_departure'], ['departure', 'before_departure'],
    ['in_transit', 'on_road'], ['arrival', 'arrived'], ['unloading', 'unloading'], ['confirmation', 'confirming'],
  ])('maps %s to %s', (phase, kind) => {
    expect(demoStageFor(trip({ current_phase: phase })).kind).toBe(kind)
  })

  it('is not_started with no current phase', () => {
    expect(demoStageFor(trip({ current_phase: null })).kind).toBe('not_started')
  })

  it.each(['closed', 'cancelled'])('is closed for a %s trip whatever the phase', status => {
    expect(demoStageFor(trip({ status, current_phase: 'in_transit' })).kind).toBe('closed')
  })

  it('names the next stop and the leg on the road', () => {
    const stage = demoStageFor(trip({ current_phase: 'in_transit', current_stop_sequence: 0 }))

    expect(stage.stop?.trip_stop_id).toBe('stop-0')
    expect(stage.nextStop?.trip_stop_id).toBe('stop-2')
    expect(stage.headline).toBe('On the road to Paarl Depot · leg 1 of 1')
  })

  it('finds the second leg of a cross-dock trip', () => {
    const stage = demoStageFor(trip({ stops: [ORIGIN, MIDDLE, DEST], current_phase: 'in_transit', current_stop_sequence: 1 }))

    expect(stage.headline).toBe('On the road to Paarl Depot · leg 2 of 2')
  })

  it('addresses the stop the ledger says the trip is at', () => {
    expect(demoStageFor(trip({ current_phase: 'arrival', current_stop_sequence: 2, stops: [ORIGIN, MIDDLE, DEST] })).stop?.precinct_name)
      .toBe('Paarl Depot')
  })
})

describe('scan gating', () => {
  const consignment = { consignment_id: 'c', parcel_perfect_reference: 'WB-1', barcodes: ['B1'] }

  it('opens scan out until loading is decided', () => {
    expect(scanOutOpen(stop({ pickup_consignments: [consignment] }))).toBe(true)
    expect(scanOutOpen(stop({ pickup_consignments: [consignment], loading_phase_status: 'completed' }))).toBe(false)
  })

  it('keeps scan in closed until arrival completes', () => {
    expect(scanInOpen(stop({ delivery_consignments: [consignment], preceding_departure_status: 'completed' }))).toBe(false)
    expect(scanInOpen(stop({ delivery_consignments: [consignment], arrival_phase_status: 'completed' }))).toBe(true)
  })

  it('closes scan in once confirmation is decided', () => {
    expect(scanInOpen(stop({ delivery_consignments: [consignment], arrival_phase_status: 'completed', confirmation_phase_status: 'completed' })))
      .toBe(false)
  })
})

describe('sortTripsForPicker', () => {
  it('puts live trips before finished ones and keeps the given order within each', () => {
    const sorted = sortTripsForPicker([
      trip({ trip_id: 'a', status: 'closed' }), trip({ trip_id: 'b', status: 'active' }),
      trip({ trip_id: 'c', status: 'created' }), trip({ trip_id: 'd', status: 'cancelled' }),
    ])

    expect(sorted.map(t => t.trip_id)).toEqual(['b', 'c', 'a', 'd'])
  })
})
