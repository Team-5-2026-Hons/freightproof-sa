// frontend/driver-pwa/components/home/__tests__/HomeContent.test.tsx
//
// Home is the entry point to the driving screen. The rule under test: while the truck is
// on the road, the driving screen is the PRIMARY action and the arrival phase's capture
// card is not offered at all — a driver at 100 km/h cannot complete an unloading step, and
// showing it invites them to try.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { HomeContent } from '../HomeContent'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { SINGLE_LEG_PHASE_PLAN, CROSS_DOCK_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'

const mockRouterPush = vi.fn()
const mockUseTrip = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

const mockUseMyTrips = vi.fn(() => ({ trips: [], isLoading: false, loadError: null as string | null, reload: vi.fn() }))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { full_name: 'Sipho Dlamini' } }),
}))

vi.mock('@/lib/hooks/useMyTrips', () => ({
  useMyTrips: () => mockUseMyTrips(),
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as unknown as TripId,
    trip_reference: 'TRP-2026-0099',
    pp_manifest: null,
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

describe('HomeContent driving entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the arrival capture card, not the driving screen, once in_transit resolves', () => {
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 4)), isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /arrival/i })).toBeInTheDocument()
  })

  it('offers the current phase card and no driving entry when the trip is not moving', () => {
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 1)), isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument()
  })

  it('offers the driving entry while in_transit is the unresolved current phase', () => {
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 3)), isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('offers the driving entry on the SECOND leg of a cross-dock plan', () => {
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    mockUseTrip.mockReturnValue({
      trip: makeTrip(walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)),
      isLoading: false,
      exceptions: [],
    })

    render(<HomeContent />)

    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('a held trip shows the hold notice instead of the driving entry, even mid-leg', () => {
    mockUseTrip.mockReturnValue({
      trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 3), { status: 'exception_hold' }),
      isLoading: false,
      exceptions: [],
    })

    render(<HomeContent />)

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })

  it('shows the empty state with no trip at all', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.getByText('No trip assigned')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See past trips' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })
})

describe('HomeContent greeting and record', () => {
  it('greets the driver by first name', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.getByText(/, Sipho$/)).toBeInTheDocument()
  })

  it('shows the driver record once their trips have loaded', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [] })

    render(<HomeContent />)

    expect(screen.getByRole('region', { name: 'Your record' })).toBeInTheDocument()
  })

  it('stays quiet about the record when the trip list failed to load', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, exceptions: [] })
    mockUseMyTrips.mockReturnValueOnce({ trips: [], isLoading: false, loadError: 'offline', reload: vi.fn() })

    render(<HomeContent />)

    expect(screen.queryByRole('region', { name: 'Your record' })).not.toBeInTheDocument()
  })
})
