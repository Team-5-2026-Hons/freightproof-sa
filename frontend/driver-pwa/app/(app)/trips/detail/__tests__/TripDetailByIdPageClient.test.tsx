// frontend/driver-pwa/app/(app)/trips/detail/__tests__/TripDetailByIdPageClient.test.tsx
//
// Covers the rules this screen enforces: a trip is only 'active' once the DRIVER has
// activated it (so a 'created' trip opens with an Activation CTA, not as an active trip),
// the phase flow must be pointed at THIS trip before navigating into it, and a trip that
// the server would refuse to activate says so BEFORE the driver captures any evidence.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { mockTrips, TRIP_0041_ID } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import TripDetailByIdPageClient from '../TripDetailByIdPageClient'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPush = vi.fn()
const mockSearchParams = { get: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}))

const mockUseTrip = vi.fn()
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => mockUseTrip() }))

const mockNotify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: mockNotify }) }))

const mockFetchMyTrip = vi.fn()
const mockFetchMyTrips = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyTrip: (id: string) => mockFetchMyTrip(id),
  fetchMyTrips: () => mockFetchMyTrips(),
}))

// jsdom has no scrollIntoView; TripDetailView's PhaseProgressBar calls it on the current
// phase's cell. Same stub as ActiveTripPageClient.test.tsx — a jsdom gap, not an app bug.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Pinned "now": 10:00 in the operator's timezone (UTC+2) on 5 August 2026. Every
// departure below is expressed relative to this, so the date rules are tested against a
// fixed calendar rather than whenever the suite happens to run.
const NOW = new Date('2026-08-05T08:00:00Z')
const SAME_DAY_08H00 = '2026-08-05T06:00:00Z'
const SAME_DAY_05H00 = '2026-08-05T03:00:00Z'
const SAME_DAY_16H00 = '2026-08-05T14:00:00Z'
const NEXT_DAY_08H00 = '2026-08-06T06:00:00Z'
const LAST_WEEK_08H00 = '2026-07-29T06:00:00Z'

const baseTrip = mockTrips.find((t) => (t.id as string) === (TRIP_0041_ID as unknown as string))!

// A trip the dispatcher has assigned but the driver has NOT activated. Its Activation
// phase is the first unresolved one, so it is what TripDetailView offers as current.
const createdTrip: Trip = {
  ...baseTrip,
  id: 'trip-created' as Trip['id'],
  trip_reference: 'FP-UPCOMING-1',
  status: 'created',
  planned_departure_at: SAME_DAY_08H00,
  phases: baseTrip.phases.map((p) =>
    p.phase_type === 'trip_creation'
      ? { ...p, status: 'completed' as const }
      : { ...p, status: 'pending' as const },
  ),
}

// One row of GET /trips/me, which is what the activation gate reads. Only the four
// fields the gate actually looks at need to be real.
function sibling(
  id: string,
  trip_reference: string,
  status: Trip['status'],
  planned_departure_at: string | null,
) {
  return { id, trip_reference, status, planned_departure_at }
}

const SELF_ROW = sibling('trip-created', 'FP-UPCOMING-1', 'created', SAME_DAY_08H00)

describe('trips/detail TripDetailByIdPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    mockSearchParams.get.mockReturnValue('trip-created')
    mockFetchMyTrip.mockResolvedValue(createdTrip)
    // Default: this trip is the driver's only one, so nothing blocks it.
    mockFetchMyTrips.mockResolvedValue([SELF_ROW])
    mockUseTrip.mockReturnValue({ selectTrip: vi.fn().mockResolvedValue(createdTrip) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the trip named in the id query param', async () => {
    render(<TripDetailByIdPageClient />)

    await waitFor(() => expect(mockFetchMyTrip).toHaveBeenCalledWith('trip-created'))
    expect(await screen.findByRole('heading', { name: 'FP-UPCOMING-1' })).toBeInTheDocument()
  })

  it('tells the driver an un-activated trip has not started yet', async () => {
    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/hasn’t started yet/i)).toBeInTheDocument()
  })

  it('shows only the current phase, not the whole plan', async () => {
    render(<TripDetailByIdPageClient />)
    await screen.findByRole('heading', { name: 'FP-UPCOMING-1' })

    // The full-plan listing (its own "Phases" heading) belongs to the mock trips/[id]
    // route — on a real trip it buried the one actionable card below the fold.
    expect(screen.queryByRole('heading', { name: /^Phases$/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Activation/i })).toBeInTheDocument()
  })

  it('points the phase flow at this trip before navigating into a phase', async () => {
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ selectTrip })
    render(<TripDetailByIdPageClient />)
    // Card gets role="button" when given an onClick, which is what isolates the CTA.
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    fireEvent.click(phaseCta)

    // Selection first, navigation second — the step pages read the trip from context, so
    // navigating before selecting would submit evidence against the wrong trip.
    await waitFor(() => expect(selectTrip).toHaveBeenCalledWith('trip-created'))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
  })

  it('refuses to start a second trip while another one is underway', async () => {
    const selectTrip = vi.fn()
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrips.mockResolvedValue([
      SELF_ROW,
      sibling('trip-other', 'FP-ALREADY-RUNNING', 'active', SAME_DAY_05H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    await waitFor(() => expect(screen.getByText(/Finish FP-ALREADY-RUNNING/i)).toBeInTheDocument())
    fireEvent.click(phaseCta)

    expect(selectTrip).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Can’t start this trip yet/i) }),
    )
  })

  it('refuses a trip before the day it is scheduled to depart', async () => {
    const selectTrip = vi.fn()
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrip.mockResolvedValue({ ...createdTrip, planned_departure_at: NEXT_DAY_08H00 })
    mockFetchMyTrips.mockResolvedValue([
      sibling('trip-created', 'FP-UPCOMING-1', 'created', NEXT_DAY_08H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    await waitFor(() => expect(screen.getByText(/isn’t due until 6 August 2026/i)).toBeInTheDocument())
    fireEvent.click(phaseCta)

    expect(selectTrip).not.toHaveBeenCalled()
  })

  it('allows a trip whose departure day has already passed', async () => {
    // Late activation is deliberately never blocked — a delayed trip still needs its
    // evidence captured. Mirrors phase_service.is_before_scheduled_day.
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrip.mockResolvedValue({ ...createdTrip, planned_departure_at: LAST_WEEK_08H00 })
    mockFetchMyTrips.mockResolvedValue([
      sibling('trip-created', 'FP-UPCOMING-1', 'created', LAST_WEEK_08H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    fireEvent.click(phaseCta)

    await waitFor(() => expect(selectTrip).toHaveBeenCalledWith('trip-created'))
  })

  it('refuses the later of two trips due the same day', async () => {
    const selectTrip = vi.fn()
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrip.mockResolvedValue({ ...createdTrip, planned_departure_at: SAME_DAY_16H00 })
    mockFetchMyTrips.mockResolvedValue([
      sibling('trip-created', 'FP-UPCOMING-1', 'created', SAME_DAY_16H00),
      sibling('trip-earlier', 'FP-EARLIER-RUN', 'created', SAME_DAY_05H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    await waitFor(() =>
      expect(screen.getByText(/FP-EARLIER-RUN departs earlier today/i)).toBeInTheDocument(),
    )
    fireEvent.click(phaseCta)

    expect(selectTrip).not.toHaveBeenCalled()
  })

  it('allows the earlier of two trips due the same day', async () => {
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrips.mockResolvedValue([
      SELF_ROW,
      sibling('trip-later', 'FP-LATER-RUN', 'created', SAME_DAY_16H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    fireEvent.click(phaseCta)

    await waitFor(() => expect(selectTrip).toHaveBeenCalledWith('trip-created'))
  })

  it('does not block a trip that is already the one underway', async () => {
    const underwayTrip: Trip = { ...createdTrip, status: 'active' }
    mockFetchMyTrip.mockResolvedValue(underwayTrip)
    mockFetchMyTrips.mockResolvedValue([
      sibling('trip-created', 'FP-UPCOMING-1', 'active', SAME_DAY_08H00),
    ])
    mockUseTrip.mockReturnValue({ selectTrip: vi.fn().mockResolvedValue(underwayTrip) })

    render(<TripDetailByIdPageClient />)

    await screen.findByRole('heading', { name: 'FP-UPCOMING-1' })
    expect(screen.queryByText(/hasn’t started yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Finish/i)).not.toBeInTheDocument()
  })

  it('still renders the trip when the sibling list fails to load', async () => {
    // The gate is an explanation, not the enforcement point — the server refuses
    // regardless, so a failed list must not blank the screen.
    mockFetchMyTrips.mockRejectedValue(new Error('offline'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByRole('heading', { name: 'FP-UPCOMING-1' })).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('reports a trip that is no longer the driver’s rather than showing a blank screen', async () => {
    const { ApiError } = await import('@/lib/api/client')
    mockFetchMyTrip.mockRejectedValue(new ApiError(404, 'not found'))

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/no longer assigned to you/i)).toBeInTheDocument()
  })

  it('distinguishes a transport failure from a missing trip', async () => {
    mockFetchMyTrip.mockRejectedValue(new Error('offline'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/Could not load this trip/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('reports a missing id instead of fetching undefined', async () => {
    mockSearchParams.get.mockReturnValue(null)

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/No trip was specified/i)).toBeInTheDocument()
    expect(mockFetchMyTrip).not.toHaveBeenCalled()
  })
})
