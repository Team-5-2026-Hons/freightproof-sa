// Rewritten for the overhaul (2.1 underway, 2.2 assigned, 2.4 on hold). Every rule the
// old card pinned is still pinned: phase + place + start, progress, driving entry, hold
// suppresses actions, all-complete, link to the trip, every open exception on screen.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NowCard } from '../NowCard'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'

let mockSummaries: { id: string; origin_precinct_name: string | null; destination_precinct_name: string | null }[] = []
vi.mock('@/lib/hooks/useMyTrips', () => ({
  useMyTrips: () => ({ trips: mockSummaries, isLoading: false, loadError: null, reload: vi.fn() }),
}))

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const inTransit = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'in_transit')!

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as unknown as TripId, trip_reference: 'TRP-2026-0099', order_number: 'ORD-99', status: 'active',
    trip_type: 'loaded', journey_lock_hash: null, idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-jhb', destination_precinct_id: 'precinct-dbn', stops: [], consignments: [],
    pulsit_trip_reference_id: null, planned_departure_at: '2026-05-09T10:00:00Z', actual_departure_at: null,
    planned_arrival_at: '2026-05-09T17:30:00Z', actual_arrival_at: null, closed_at: null, driver: null,
    horse: null, trailers: [], phases, current_phase: null, current_stop: null, exceptions: [],
    blockchain_receipts: [], warnings: [], created_at: '2026-06-12T08:00:00Z', updated_at: '2026-06-12T08:00:00Z',
    ...overrides,
  }
}

function renderCard(trip: Trip, exceptions: readonly TripException[] = []) {
  const handlers = { onStartPhase: vi.fn(), onContinueDriving: vi.fn(), onViewTrip: vi.fn() }
  render(<NowCard trip={trip} exceptions={exceptions} {...handlers} />)
  return handlers
}

beforeEach(() => {
  mockSummaries = [{ id: 'trip-1', origin_precinct_name: 'FedEx JHB — Linbro Park', destination_precinct_name: 'FedEx DBN — Riverhorse Valley' }]
})

describe('NowCard — trip underway (2.1)', () => {
  it('test_names_the_current_phase_where_it_happens_and_offers_to_start_it', () => {
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0))
    const handlers = renderCard(trip)

    const card = screen.getByRole('region', { name: 'Current trip' })
    expect(within(card).getByText('Activation')).toBeInTheDocument()
    expect(within(card).getByText(/FedEx JHB/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start Activation' }))
    expect(handlers.onStartPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_type: 'activation' }))
  })

  it('test_shows_how_far_through_the_trip_the_driver_is', () => {
    renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, inTransit.sequence_number - 1)))

    expect(screen.getByText(/Phase 4 of 7/)).toBeInTheDocument()
  })

  it('test_while_driving_offers_the_driving_screen_and_where_the_truck_is_heading', () => {
    const handlers = renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, inTransit.sequence_number - 1)))

    expect(screen.getByText('FedEx DBN')).toBeInTheDocument()
    expect(screen.getByText(/ETA \d{2}:\d{2}/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue Driving' }))
    expect(handlers.onContinueDriving).toHaveBeenCalledOnce()
  })

  it('test_says_so_when_every_phase_is_complete_with_no_action_left', () => {
    renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 999)))

    expect(screen.getByText('All phases complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start |Continue Driving/ })).toBeNull()
  })

  it('test_links_through_to_the_full_trip', () => {
    const handlers = renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0)))

    fireEvent.click(screen.getByRole('button', { name: /View trip/ }))

    expect(handlers.onViewTrip).toHaveBeenCalledOnce()
  })

  it('test_shows_every_open_exception_so_a_badged_home_tab_has_its_reason', () => {
    const exceptions = [
      { id: 'e1', exception_type: 'cargo_damage', description: 'Pallet 3 crushed' },
      { id: 'e2', exception_type: 'dispatcher_note', description: 'Use gate 2' },
    ] as TripException[]

    renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0)), exceptions)

    expect(screen.getByText('Pallet 3 crushed')).toBeInTheDocument()
    expect(screen.getByText('Use gate 2')).toBeInTheDocument()
  })

  it('test_shows_no_exceptions_section_when_nothing_is_open', () => {
    renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0)))

    expect(screen.queryByRole('region', { name: 'Open exceptions' })).toBeNull()
  })
})

describe('NowCard — trip assigned, not started (2.2)', () => {
  it('test_shows_the_route_and_offers_start_trip', () => {
    const trip = makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 0), { status: 'created' })
    const handlers = renderCard(trip)

    const card = screen.getByRole('region', { name: 'Next trip' })
    expect(within(card).getByText('FedEx JHB')).toBeInTheDocument()
    expect(within(card).getByText('FedEx DBN')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start Trip' }))
    expect(handlers.onStartPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_type: 'activation' }))
  })
})

describe('NowCard — trip on hold (2.4)', () => {
  it('test_offers_no_phase_action_and_explains_the_hold', () => {
    const exceptions = [{ id: 'e1', exception_type: 'cargo_damage', description: 'Pallet 3 crushed' }] as TripException[]
    renderCard(makeTrip(walk(SINGLE_LEG_PHASE_PLAN, inTransit.sequence_number - 1), { status: 'exception_hold' }), exceptions)

    expect(screen.getByText('Waiting for dispatch')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start |Continue Driving/ })).toBeNull()
    expect(screen.getByText('Pallet 3 crushed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Trip' })).toBeInTheDocument()
  })
})
