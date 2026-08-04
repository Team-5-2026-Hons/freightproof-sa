// frontend/driver-pwa/app/(app)/trips/detail/__tests__/TripDetailByIdPageClient.test.tsx
//
// Covers the two rules this screen enforces: a trip is only 'active' once the DRIVER has
// activated it (so a 'created' trip opens with an Activation CTA, not as an active trip),
// and the phase flow must be pointed at THIS trip before navigating into it.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
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
vi.mock('@/lib/api/trips', () => ({ fetchMyTrip: (id: string) => mockFetchMyTrip(id) }))

// jsdom has no scrollIntoView; TripDetailView's PhaseProgressBar calls it on the current
// phase's cell. Same stub as ActiveTripPageClient.test.tsx — a jsdom gap, not an app bug.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const baseTrip = mockTrips.find((t) => (t.id as string) === (TRIP_0041_ID as unknown as string))!

// A trip the dispatcher has assigned but the driver has NOT activated. Its Activation
// phase is the first unresolved one, so it is what TripDetailView offers as current.
const createdTrip: Trip = {
  ...baseTrip,
  id: 'trip-created' as Trip['id'],
  trip_reference: 'FP-UPCOMING-1',
  status: 'created',
  phases: baseTrip.phases.map((p) =>
    p.phase_type === 'trip_creation'
      ? { ...p, status: 'completed' as const }
      : { ...p, status: 'pending' as const },
  ),
}

const otherUnderwayTrip: Trip = {
  ...baseTrip,
  id: 'trip-other' as Trip['id'],
  trip_reference: 'FP-ALREADY-RUNNING',
  status: 'active',
}

describe('trips/detail TripDetailByIdPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.get.mockReturnValue('trip-created')
    mockFetchMyTrip.mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ trip: null, selectTrip: vi.fn().mockResolvedValue(createdTrip) })
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

  it('points the phase flow at this trip before navigating into a phase', async () => {
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ trip: null, selectTrip })
    render(<TripDetailByIdPageClient />)
    // The phase name also appears in the progress bar and the plan list; only the CURRENT
    // phase's row is interactive (Card gets role="button" when given an onClick), so the
    // role query is what isolates the actual CTA.
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    fireEvent.click(phaseCta)

    // Selection first, navigation second — the step pages read the trip from context, so
    // navigating before selecting would submit evidence against the wrong trip.
    await waitFor(() => expect(selectTrip).toHaveBeenCalledWith('trip-created'))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
  })

  it('refuses to start a second trip while another one is underway', async () => {
    const selectTrip = vi.fn()
    mockUseTrip.mockReturnValue({ trip: otherUnderwayTrip, selectTrip })
    render(<TripDetailByIdPageClient />)
    // The phase name also appears in the progress bar and the plan list; only the CURRENT
    // phase's row is interactive (Card gets role="button" when given an onClick), so the
    // role query is what isolates the actual CTA.
    const phaseCta = await screen.findByRole('button', { name: /Activation/i })

    fireEvent.click(phaseCta)

    expect(selectTrip).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Finish your active trip/i) }),
    )
  })

  it('names the blocking trip so the driver knows what to finish', async () => {
    mockUseTrip.mockReturnValue({ trip: otherUnderwayTrip, selectTrip: vi.fn() })

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/Finish FP-ALREADY-RUNNING/i)).toBeInTheDocument()
  })

  it('does not block a trip that is already the one underway', async () => {
    const underwayTrip: Trip = { ...createdTrip, status: 'active' }
    mockFetchMyTrip.mockResolvedValue(underwayTrip)
    mockUseTrip.mockReturnValue({
      trip: underwayTrip,
      selectTrip: vi.fn().mockResolvedValue(underwayTrip),
    })

    render(<TripDetailByIdPageClient />)

    await screen.findByRole('heading', { name: 'FP-UPCOMING-1' })
    expect(screen.queryByText(/hasn’t started yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Finish/i)).not.toBeInTheDocument()
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
