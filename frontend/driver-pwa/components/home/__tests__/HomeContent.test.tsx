// frontend/driver-pwa/components/home/__tests__/HomeContent.test.tsx
//
// Home is the entry point to the driving screen. The rule under test: while the truck is
// on the road, the driving screen is the PRIMARY action and the arrival phase's capture
// card is not offered at all — a driver at 100 km/h cannot complete an unloading step, and
// showing it invites them to try.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { HomeContent } from '../HomeContent'
import { ROUTES } from '@/lib/constants/routes'
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

// jsdom has no scrollIntoView; PhaseProgressBar calls it on the current phase's cell.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Marks every phase up to and including `through` (by sequence_number) as completed —
// mirrors the identical local helper in lib/phase/__tests__/derive.test.ts.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as unknown as TripId,
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

describe('HomeContent driving entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers the driving screen, not the arrival phase card, while on the road', () => {
    // in_transit resolved, unloading current — the shape a real trip is in for the whole
    // leg, because the backend closes in_transit the instant departure advances.
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 4)), isLoading: false })

    render(<HomeContent />)

    fireEvent.click(screen.getByRole('button', { name: /continue driving/i }))
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(screen.queryByRole('button', { name: /unloading/i })).not.toBeInTheDocument()
  })

  it('offers the current phase card and no driving entry when the trip is not moving', () => {
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 1)), isLoading: false })

    render(<HomeContent />)

    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument()
  })

  it('offers the driving entry while in_transit is the unresolved current phase', () => {
    // With the backend keeping in_transit pending during the drive, isDriving returns
    // true while the driver is actively en route. This is exactly when the driving button
    // should appear to take them to the map and checkpoint/exception screens.
    mockUseTrip.mockReturnValue({ trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 3)), isLoading: false })

    render(<HomeContent />)

    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('offers the driving entry on the SECOND leg of a cross-dock plan', () => {
    // Regression guard for a plan-length or phase_type assumption: the entry has to fire
    // per leg, not once per trip.
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')[1]
    mockUseTrip.mockReturnValue({
      trip: makeTrip(walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number)),
      isLoading: false,
    })

    render(<HomeContent />)

    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('a held trip shows the hold notice instead of the driving entry, even mid-leg', () => {
    mockUseTrip.mockReturnValue({
      trip: makeTrip(walk(SINGLE_LEG_PHASE_PLAN, 4), { status: 'exception_hold' }),
      isLoading: false,
    })

    render(<HomeContent />)

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })

  it('shows the empty state with no trip at all', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false })

    render(<HomeContent />)

    expect(screen.getByText('No active trip right now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })
})
