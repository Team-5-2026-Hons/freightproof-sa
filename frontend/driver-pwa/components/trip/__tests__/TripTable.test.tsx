// frontend/driver-pwa/components/trip/__tests__/TripTable.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { TripId } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'
import { TripTable } from '../TripTable'

function makeTrip(overrides: Partial<DriverTripSummary> & { status: CoarseTripStatus }): DriverTripSummary {
  return {
    id: `trip-${overrides.trip_reference ?? overrides.status}` as TripId,
    trip_reference: 'FP-TEST-0001',
    order_number: 'ORD-0001',
    trip_type: 'loaded',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    origin_precinct_name: 'Johannesburg Depot',
    destination_precinct_name: 'Cape Town Depot',
    planned_departure_at: '2026-08-05T19:10:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-08-06T08:00:00Z',
    actual_arrival_at: null,
    open_exception_count: 0,
    created_at: '2026-08-04T19:10:00Z',
    updated_at: '2026-08-04T19:10:00Z',
    ...overrides,
  }
}

describe('TripTable', () => {
  it('renders one row per trip', () => {
    const trips = [
      makeTrip({ status: 'active', trip_reference: 'FP-ONE' }),
      makeTrip({ status: 'created', trip_reference: 'FP-TWO' }),
    ]

    render(<TripTable trips={trips} onSelect={vi.fn()} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('FP-ONE')).toBeInTheDocument()
    expect(screen.getByText('FP-TWO')).toBeInTheDocument()
  })

  it('makes the whole row one activatable control', () => {
    const onSelect = vi.fn()
    const trip = makeTrip({ status: 'created', trip_reference: 'FP-ONE' })

    render(<TripTable trips={[trip]} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith(trip)
  })

  it('keeps the route on one line so it reads as a single fact', () => {
    render(<TripTable trips={[makeTrip({ status: 'active' })]} onSelect={vi.fn()} />)

    expect(screen.getByText('Johannesburg Depot → Cape Town Depot')).toBeInTheDocument()
  })

  it('says so when no departure has been scheduled rather than rendering an empty cell', () => {
    const trip = makeTrip({ status: 'created', planned_departure_at: null })

    render(<TripTable trips={[trip]} onSelect={vi.fn()} />)

    expect(screen.getAllByText(/Departure not scheduled/).length).toBeGreaterThan(0)
  })

  it('renders the column header outside the accessibility tree', () => {
    render(<TripTable trips={[makeTrip({ status: 'active' })]} onSelect={vi.fn()} />)

    // Visible to a sighted driver as column labels; a screen reader gets each row's
    // own text instead, so "Trip"/"Status" must not be announced before every row.
    expect(screen.getByText('Trip').closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
