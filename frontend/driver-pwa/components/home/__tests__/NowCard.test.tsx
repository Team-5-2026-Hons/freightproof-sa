import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NowCard } from '../NowCard'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'

// Marks every phase up to and including `through` (by sequence_number) as completed.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: crypto.randomUUID() as unknown as TripId,
    trip_reference: 'TRP-2026-0099',
    order_number: 'ORD-99',
    status: 'active',
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-jhb',
    destination_precinct_id: 'precinct-dbn',
    stops: [],
    consignments: [],
    pulsit_trip_reference_id: null,
    planned_departure_at: null,
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    phases,
    current_phase: null,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-06-12T08:00:00Z',
    updated_at: '2026-06-12T08:00:00Z',
    ...overrides,
  }
}

function renderCard(trip: Trip) {
  const handlers = { onStartPhase: vi.fn(), onContinueDriving: vi.fn(), onViewTrip: vi.fn() }
  render(<NowCard trip={trip} {...handlers} />)
  return handlers
}

const inTransit = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'in_transit')!

describe('NowCard', () => {
  it('names the current phase, where it happens, and offers to start it', () => {
    // Arrange — trip_creation done, activation is current.
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0))

    // Act
    const { onStartPhase } = renderCard(trip)
    fireEvent.click(screen.getByRole('button', { name: 'Start Activation' }))

    // Assert
    expect(screen.getByRole('heading', { name: 'Activation' })).toBeInTheDocument()
    expect(screen.getByText('Origin')).toBeInTheDocument()
    expect(onStartPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_type: 'activation' }))
  })

  it('shows how far through the trip the driver is', () => {
    // Arrange
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0))

    // Act
    renderCard(trip)

    // Assert — activation is the driver's first phase; trip_creation is the system's and
    // isn't counted, so this matches the "1" on activation's timeline dot.
    expect(screen.getByText(`Phase 1 of ${SINGLE_LEG_PHASE_PLAN.length - 1}`)).toBeInTheDocument()
  })

  it('while driving, offers the driving screen and where the truck is heading', () => {
    // Arrange — everything before in_transit done; in_transit is the open row.
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, inTransit.sequence_number - 1), {
      planned_arrival_at: '2026-06-12T17:30:00Z',
    })

    // Act
    const { onContinueDriving } = renderCard(trip)
    fireEvent.click(screen.getByRole('button', { name: /continue driving/i }))

    // Assert
    expect(screen.getByText(/^To Destination · ETA /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start /i })).not.toBeInTheDocument()
    expect(onContinueDriving).toHaveBeenCalledTimes(1)
  })

  it('offers no phase action on an exception hold, only the hold notice', () => {
    // Arrange
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0), { status: 'exception_hold' })

    // Act
    renderCard(trip)

    // Assert
    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start /i })).not.toBeInTheDocument()
  })

  it('says so when every phase is complete, with no action left to take', () => {
    // Arrange
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, Number.MAX_SAFE_INTEGER))

    // Act
    renderCard(trip)

    // Assert
    expect(screen.getByRole('heading', { name: 'All Phases Complete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start /i })).not.toBeInTheDocument()
  })

  it('links through to the full trip', () => {
    // Arrange
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0))

    // Act
    const { onViewTrip } = renderCard(trip)
    fireEvent.click(screen.getByRole('button', { name: 'View Trip' }))

    // Assert
    expect(onViewTrip).toHaveBeenCalledTimes(1)
  })
})
