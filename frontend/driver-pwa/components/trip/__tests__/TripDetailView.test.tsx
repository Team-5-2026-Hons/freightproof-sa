// frontend/driver-pwa/components/trip/__tests__/TripDetailView.test.tsx
//
// Rewritten for the overhaul (3.2 in progress, 3.3 upcoming, 3.4 record). Still renders
// against CROSS_DOCK_PHASE_PLAN and asserts N rows for an N-phase plan, so a reintroduced
// fixed-length assumption fails loudly; still pins every driving/hold rule the old view had.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TripDetailView } from '../TripDetailView'
import { currentPhase } from '@/lib/phase'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { SINGLE_LEG_PHASE_PLAN, CROSS_DOCK_PHASE_PLAN, makePhasePlan, type PlanStopInput } from '@shared/lib/mocks/phase-trips'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))

let mockSummaries: { id: string; origin_precinct_name: string | null; destination_precinct_name: string | null }[] = []
vi.mock('@/lib/hooks/useMyTrips', () => ({
  useMyTrips: () => ({ trips: mockSummaries, isLoading: false, loadError: null, reload: vi.fn() }),
}))

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

/** Completes everything before the nth (0-based) phase of a type, making it current. */
function upTo(plan: readonly PhaseDescriptor[], type: PhaseType, nth = 0): PhaseDescriptor[] {
  const target = plan.filter((p) => p.phase_type === type)[nth]
  return walk(plan, target.sequence_number - 1)
}

const HORSE = { id: 'h', registration: 'GP 12-34 ZX', vehicle_type: 'horse', make: null, model: null, year: null, licence_disc_expiry: null, gross_vehicle_mass_kg: null, length_m: null } as unknown as Vehicle

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as unknown as TripId, trip_reference: 'TRP-2026-0099', pp_manifest: null, status: 'active',
    trip_type: 'loaded', journey_lock_hash: null, idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-jhb', destination_precinct_id: 'precinct-dbn', stops: [], consignments: [],
    pulsit_trip_reference_id: null, planned_departure_at: '2026-05-09T08:00:00Z', actual_departure_at: null,
    planned_arrival_at: '2026-05-09T17:30:00Z', actual_arrival_at: null, closed_at: null, driver: null,
    horse: HORSE, trailers: [], phases, current_phase: null, current_stop: null, exceptions: [],
    blockchain_receipts: [], warnings: [], created_at: '2026-05-01T08:00:00Z', updated_at: '2026-05-01T08:00:00Z',
    ...overrides,
  }
}

function renderView(trip: Trip, extra: Partial<Parameters<typeof TripDetailView>[0]> = {}) {
  const props = {
    trip, onBack: vi.fn(), onInTransitHub: vi.fn(), onSelectPhase: vi.fn(), showAllPhases: false, ...extra,
  }
  render(<TripDetailView {...props} />)
  return props
}

function phaseRows(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Trip phases' })).getAllByRole('listitem')
}

beforeEach(() => {
  mockSummaries = []
})

describe('TripDetailView — trip in progress (3.2)', () => {
  it('test_names_the_screen_and_shows_the_reference_under_it', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    expect(screen.getByRole('heading', { name: 'Current trip' })).toBeInTheDocument()
    expect(screen.getByText('TRP-2026-0099')).toBeInTheDocument()
  })

  it('test_back_calls_onBack', () => {
    const props = renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))

    expect(props.onBack).toHaveBeenCalledOnce()
  })

  it('test_progress_comes_before_route', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    const progress = screen.getByRole('heading', { name: 'Progress' })
    const route = screen.getByRole('heading', { name: 'Route' })

    expect(progress.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('test_offers_to_start_the_current_phase_when_not_driving', () => {
    const plan = upTo(SINGLE_LEG_PHASE_PLAN, 'loading')
    const props = renderView(makeTrip(plan))

    fireEvent.click(screen.getByRole('button', { name: 'Start Loading' }))

    expect(props.onSelectPhase).toHaveBeenCalledWith(currentPhase(plan))
    expect(screen.queryByRole('button', { name: 'Continue Driving' })).toBeNull()
  })

  it('test_offers_the_driving_screen_while_in_transit_is_current', () => {
    const props = renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'in_transit')))

    fireEvent.click(screen.getByRole('button', { name: 'Continue Driving' }))

    expect(props.onInTransitHub).toHaveBeenCalledOnce()
  })

  it('test_offers_arrival_not_driving_once_in_transit_resolves', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'arrival')))

    expect(screen.getByRole('button', { name: 'Start Arrival' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue Driving' })).toBeNull()
  })

  it('test_offers_the_driving_screen_on_the_second_leg_of_a_cross_dock_plan', () => {
    renderView(makeTrip(upTo(CROSS_DOCK_PHASE_PLAN, 'in_transit', 1)))

    expect(screen.getByRole('button', { name: 'Continue Driving' })).toBeInTheDocument()
  })

  it('test_a_held_trip_offers_no_action_and_says_why_even_mid_leg', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'in_transit'), { status: 'exception_hold' }))

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue Driving' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Start / })).toBeNull()
  })

  it('test_all_steps_lists_every_phase_of_a_cross_dock_plan_only_current_tappable', () => {
    const plan = upTo(CROSS_DOCK_PHASE_PLAN, 'loading')
    renderView(makeTrip(plan), { showAllPhases: true })

    expect(phaseRows()).toHaveLength(CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation').length)
    expect(within(screen.getByRole('list', { name: 'Trip phases' })).getAllByRole('button')).toHaveLength(1)
  })

  it('test_the_third_unloading_is_the_tappable_row_once_the_first_two_are_done', () => {
    // Synthetic 4-stop plan where every stop after the first drops off cargo, so
    // `unloading` occurs three times (same fixture as before the overhaul): the UI must
    // resolve the current row by sequence_number, not by phase type.
    const stops: PlanStopInput[] = [
      { trip_stop_id: 'stop-1', sequence: 1, picks_up: true, drops_off: false },
      { trip_stop_id: 'stop-2', sequence: 2, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-3', sequence: 3, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-4', sequence: 4, picks_up: false, drops_off: true },
    ]
    const fullPlan = makePhasePlan('trip-3x-unloading', stops, '2026-01-01T00:00:00Z', 'test-3u')
    const thirdUnloading = fullPlan.filter((p) => p.phase_type === 'unloading')[2]
    const plan = upTo(fullPlan, 'unloading', 2)
    const props = renderView(makeTrip(plan), { showAllPhases: true })

    fireEvent.click(within(screen.getByRole('list', { name: 'Trip phases' })).getByRole('button'))

    expect(props.onSelectPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_event_id: thirdUnloading.phase_event_id }))
  })

  it('test_hold_makes_the_phase_list_static', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading'), { status: 'exception_hold' }), { showAllPhases: true })

    expect(within(screen.getByRole('list', { name: 'Trip phases' })).queryByRole('button')).toBeNull()
  })

  it('test_all_steps_is_a_disclosure', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))
    const toggle = screen.getByRole('button', { name: 'All steps' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(phaseRows().length).toBeGreaterThan(0)
  })

  it('test_an_anchored_phase_says_so_in_all_steps', () => {
    const plan = upTo(SINGLE_LEG_PHASE_PLAN, 'loading').map((p) =>
      p.phase_type === 'activation' ? { ...p, anchor_status: 'anchored' as const } : p)

    renderView(makeTrip(plan), { showAllPhases: true })

    expect(screen.getByLabelText('Anchored on Hedera')).toBeInTheDocument()
  })

  it('test_no_anchor_copy_when_nothing_is_anchored_yet', () => {
    const plan = upTo(SINGLE_LEG_PHASE_PLAN, 'loading').map((p) => ({ ...p, anchor_status: 'not_required' as const }))

    renderView(makeTrip(plan), { showAllPhases: true })

    expect(screen.queryByLabelText('Anchored on Hedera')).toBeNull()
    expect(screen.queryByText(/Anchoring/)).toBeNull()
  })

  it('test_route_uses_server_place_names_when_known', () => {
    mockSummaries = [{ id: 'trip-1', origin_precinct_name: 'FedEx JHB — Linbro Park', destination_precinct_name: 'FedEx DBN — Riverhorse Valley' }]

    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    const route = screen.getByRole('list', { name: 'Route' })
    expect(route).toHaveTextContent('FedEx JHB')
    expect(route).toHaveTextContent('Riverhorse Valley')
  })

  it('test_route_falls_back_to_origin_and_destination_never_a_uuid', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    const route = screen.getByRole('list', { name: 'Route' })
    expect(route).toHaveTextContent('Origin')
    expect(route).toHaveTextContent('Destination')
  })

  it('test_vehicle_row_opens_the_truck_and_trailers_sheet', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')))

    fireEvent.click(screen.getByRole('button', { name: /GP 12-34 ZX/ }))

    expect(screen.getByRole('dialog', { name: 'Vehicles on this trip' })).toBeInTheDocument()
  })

  it('test_renders_a_notice_when_given', () => {
    renderView(makeTrip(upTo(SINGLE_LEG_PHASE_PLAN, 'loading')), { notice: <p>Starting trip</p> })

    expect(screen.getByText('Starting trip')).toBeInTheDocument()
  })
})

describe('TripDetailView — upcoming trip (3.3)', () => {
  it('test_shows_what_the_trip_will_ask_for_and_offers_to_start_it', () => {
    const plan = upTo(SINGLE_LEG_PHASE_PLAN, 'activation')
    const props = renderView(makeTrip(plan, { status: 'created' }))

    expect(screen.getByRole('heading', { name: 'Upcoming trip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What you’ll record' })).toBeInTheDocument()
    expect(screen.getByText('Photo of the linehaul sheet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start Trip' }))

    expect(props.onSelectPhase).toHaveBeenCalledWith(currentPhase(plan))
  })
})

describe('TripDetailView — completed record (3.4)', () => {
  const closed = () => makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 999), {
    status: 'closed',
    actual_departure_at: '2026-05-03T09:00:00Z',
    planned_arrival_at: '2026-05-03T19:30:00Z',
    actual_arrival_at: '2026-05-03T19:30:00Z',
    closed_at: '2026-05-03T19:45:00Z',
  })

  it('test_is_a_read_only_record_with_its_outcome', () => {
    renderView(closed())

    expect(screen.getByRole('heading', { name: 'Trip record' })).toBeInTheDocument()
    expect(screen.getByText('Delivered on time')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Start |Continue Driving/ })).toBeNull()
  })

  it('test_timeline_lists_every_phase', () => {
    renderView(closed())

    expect(phaseRows()).toHaveLength(SINGLE_LEG_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation').length)
  })
})
