import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevTriggerPanel } from '../DevTriggerPanel'
import { useDevTriggers, type UseDevTriggersResult } from '@/lib/hooks/useDevTriggers'
import type { DevTripStop, DevTripSummary } from '@/lib/types/dev'

vi.mock('@/lib/hooks/useDevTriggers', () => ({ useDevTriggers: vi.fn() }))
vi.mock('@/lib/realtime/useLiveResource', () => ({ useLiveResource: vi.fn() }))

const consignment = { consignment_id: 'c1', parcel_perfect_reference: 'WB-1', barcodes: ['B1', 'B2'] }

function stop(overrides: Partial<DevTripStop>): DevTripStop {
  return {
    trip_stop_id: 'stop-0', sequence: 0, precinct_name: 'Cape Town DC',
    pickup_consignments: [], delivery_consignments: [],
    loading_phase_status: null, confirmation_phase_status: null, preceding_departure_status: null,
    arrival_phase_status: null, unloading_phase_status: null,
    ...overrides,
  }
}

function trip(overrides: Partial<DevTripSummary> = {}): DevTripSummary {
  return {
    trip_id: 'trip-1', trip_reference: 'FP-0042', status: 'active', current_phase: 'in_transit',
    driver_full_name: 'Driver', created_at: '2026-09-24T08:00:00Z', current_stop_sequence: 0,
    stops: [
      stop({ pickup_consignments: [consignment], loading_phase_status: 'completed' }),
      stop({ trip_stop_id: 'stop-1', sequence: 1, precinct_name: 'Paarl Depot', delivery_consignments: [consignment] }),
    ],
    vehicles: [
      { vehicle_id: 'h', registration: 'CA 100', role: 'horse' },
      { vehicle_id: 't1', registration: 'TRL 222', role: 'trailer' },
      { vehicle_id: 't2', registration: 'TRL 333', role: 'trailer' },
    ],
    ...overrides,
  }
}

function controls(overrides: Partial<UseDevTriggersResult> = {}): UseDevTriggersResult {
  return {
    trips: [trip()], waypoints: [], isLoading: false, error: null, lastResult: null, activity: [],
    loadTrips: vi.fn().mockResolvedValue(undefined), triggerScan: vi.fn().mockResolvedValue(null),
    closeScanSession: vi.fn().mockResolvedValue(null), triggerPpChange: vi.fn().mockResolvedValue(null),
    triggerException: vi.fn().mockResolvedValue(null), flushMockState: vi.fn().mockResolvedValue(null),
    loadWaypoints: vi.fn().mockResolvedValue(undefined), moveTruck: vi.fn().mockResolvedValue(null),
    runRigScenario: vi.fn().mockResolvedValue(null), runRoadCheck: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function renderWith(value: UseDevTriggersResult, tripId = 'trip-1') {
  vi.mocked(useDevTriggers).mockReturnValue(value)
  render(<DevTriggerPanel heading="Demo panel" />)
  fireEvent.change(screen.getByLabelText('Trip'), { target: { value: tripId } })
}

beforeEach(() => { vi.mocked(useDevTriggers).mockReset() })

describe('DevTriggerPanel — follows the trip', () => {
  it('shows where the trip is', () => {
    renderWith(controls())

    expect(screen.getByTestId('demo-stage-headline')).toHaveTextContent('On the road to Paarl Depot · leg 1 of 1')
  })

  it('offers one uncoupled-trailer scenario per trailer on the road, and fires it in one click', () => {
    const value = controls()
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'Trailer TRL 333 uncoupled' }))

    expect(value.runRigScenario).toHaveBeenCalledWith({ trip_id: 'trip-1', scenario: 'trailer_uncoupled', vehicle_id: 't2' })
    expect(screen.getByRole('button', { name: 'Trailer TRL 222 uncoupled' })).toBeInTheDocument()
  })

  it('moves the rig to the next stop so arrival passes its location check', () => {
    const value = controls()
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'Truck reaches Paarl Depot' }))

    expect(value.runRigScenario).toHaveBeenCalledWith({ trip_id: 'trip-1', scenario: 'at_stop', trip_stop_id: 'stop-1' })
  })

  it('offers no warehouse scans on the road', () => {
    renderWith(controls())

    expect(screen.queryByRole('button', { name: 'All parcels' })).not.toBeInTheDocument()
  })

  it('offers scan-out presets at the origin before departure', () => {
    const value = controls({ trips: [trip({ current_phase: 'loading', stops: [stop({ pickup_consignments: [consignment] })] })] })
    renderWith(value)

    fireEvent.click(screen.getByRole('button', { name: 'One parcel short' }))

    expect(value.triggerScan).toHaveBeenCalledWith({
      trip_id: 'trip-1', trip_stop_id: 'stop-0', direction: 'out', barcodes_by_reference: { 'WB-1': ['B1'] },
    })
  })

  it('explains why scanning in is locked at arrival', () => {
    renderWith(controls({ trips: [trip({ current_phase: 'arrival', current_stop_sequence: 1 })] }))

    expect(screen.getByText(/Scanning in opens once the driver completes arrival/)).toBeInTheDocument()
  })

  it('shows the activity log, newest first', () => {
    renderWith(controls({ activity: [
      { id: 2, at: '2026-09-24T10:01:00Z', tone: 'ok', text: 'Second', findings: [] },
      { id: 1, at: '2026-09-24T10:00:00Z', tone: 'ok', text: 'First', findings: [] },
    ] }))

    const items = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual([expect.stringContaining('Second'), expect.stringContaining('First')])
  })

  it('keeps the raw controls collapsed until asked', () => {
    renderWith(controls())

    expect(screen.getByText('All controls').closest('details')).not.toHaveAttribute('open')
  })
})
