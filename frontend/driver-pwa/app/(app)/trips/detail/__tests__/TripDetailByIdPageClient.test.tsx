// frontend/driver-pwa/app/(app)/trips/detail/__tests__/TripDetailByIdPageClient.test.tsx
//
// Covers the rules this screen enforces: a trip is only 'active' once the DRIVER has
// activated it (so a 'created' trip opens with an Activation CTA, not as an active trip),
// the phase flow must be pointed at THIS trip before navigating into it, and a trip that
// the server would refuse to activate says so BEFORE the driver captures any evidence.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { mockTrips, TRIP_0041_ID } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { substitutionErrorFixtures, substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import TripDetailByIdPageClient from '../TripDetailByIdPageClient'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPush = vi.fn()
const mockSearchParams = { get: vi.fn() }
vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('@/lib/hooks/useMyTrips', () => ({ useMyTrips: () => ({ trips: [], isLoading: false, loadError: null, reload: () => {} }) }))
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

const mockFetchDriverParticipation = vi.fn()
vi.mock('@/lib/api/driver-substitutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/driver-substitutions')>()),
  fetchDriverParticipation: (id: string) => mockFetchDriverParticipation(id),
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const NOW = new Date('2026-08-05T08:00:00Z')
const SAME_DAY_08H00 = '2026-08-05T06:00:00Z'
const SAME_DAY_05H00 = '2026-08-05T03:00:00Z'
const SAME_DAY_16H00 = '2026-08-05T14:00:00Z'
const NEXT_DAY_08H00 = '2026-08-06T06:00:00Z'
const LAST_WEEK_08H00 = '2026-07-29T06:00:00Z'

const baseTrip = mockTrips.find((t) => (t.id as string) === (TRIP_0041_ID as unknown as string))!

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
    mockFetchMyTrips.mockResolvedValue([SELF_ROW])
    mockUseTrip.mockReturnValue({ selectTrip: vi.fn().mockResolvedValue(createdTrip) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the trip named in the id query param', async () => {
    render(<TripDetailByIdPageClient />)

    await waitFor(() => expect(mockFetchMyTrip).toHaveBeenCalledWith('trip-created'))
    expect(await screen.findByText('FP-UPCOMING-1')).toBeInTheDocument()
  })

  it('tells the driver an un-activated trip has not started yet', async () => {
    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/Start the trip when you’re at the/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upcoming trip' })).toBeInTheDocument()
  })

  it('shows only the current phase, not the whole plan', async () => {
    render(<TripDetailByIdPageClient />)
    await screen.findByText('FP-UPCOMING-1')

    expect(screen.queryByRole('list', { name: 'Trip phases' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Start Trip' })).toBeInTheDocument()
  })

  it('points the phase flow at this trip before navigating into a phase', async () => {
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ selectTrip })
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

    fireEvent.click(phaseCta)

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
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

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
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

    await waitFor(() => expect(screen.getByText(/isn’t due until 6 August 2026/i)).toBeInTheDocument())
    fireEvent.click(phaseCta)

    expect(selectTrip).not.toHaveBeenCalled()
  })

  it('allows a trip whose departure day has already passed', async () => {
    const selectTrip = vi.fn().mockResolvedValue(createdTrip)
    mockUseTrip.mockReturnValue({ selectTrip })
    mockFetchMyTrip.mockResolvedValue({ ...createdTrip, planned_departure_at: LAST_WEEK_08H00 })
    mockFetchMyTrips.mockResolvedValue([
      sibling('trip-created', 'FP-UPCOMING-1', 'created', LAST_WEEK_08H00),
    ])
    render(<TripDetailByIdPageClient />)
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

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
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

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
    const phaseCta = await screen.findByRole('button', { name: 'Start Trip' })

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

    await screen.findByText('FP-UPCOMING-1')
    expect(screen.queryByText(/hasn’t started yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Finish/i)).not.toBeInTheDocument()
  })

  it('still renders the trip when the sibling list fails to load', async () => {
    mockFetchMyTrips.mockRejectedValue(new Error('offline'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText('FP-UPCOMING-1')).toBeInTheDocument()
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

  it('keeps the header and a back control when the trip fails to load', async () => {
    mockFetchMyTrip.mockRejectedValue(new Error('offline'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/Could not load this trip/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Trip' })).toBeInTheDocument()
    const header = document.querySelector('header')
    expect(header).not.toBeNull()
    expect(within(header as HTMLElement).getByRole('button', { name: /back to trips/i })).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('reports a missing id instead of fetching undefined', async () => {
    mockSearchParams.get.mockReturnValue(null)

    render(<TripDetailByIdPageClient />)

    expect(await screen.findByText(/No trip was specified/i)).toBeInTheDocument()
    expect(mockFetchMyTrip).not.toHaveBeenCalled()
  })

  describe('a trip this driver handed over', () => {
    const history = substitutionFixturePack.formerParticipantHistory.history

    async function handedOver() {
      const { ApiError } = await import('@/lib/api/client')
      const fixture = substitutionErrorFixtures.TRIP_HANDED_OVER
      return new ApiError(fixture.http_status, fixture.body.detail.message, undefined, {
        code: fixture.body.detail.code, requestId: null, currentVersion: null, evidenceId: null,
      })
    }

    beforeEach(async () => {
      mockSearchParams.get.mockReturnValue(history.trip_id)
      mockFetchMyTrip.mockRejectedValue(await handedOver())
      mockFetchDriverParticipation.mockResolvedValue(history)
    })

    it('test_handed_over_trip_shows_participation_history', async () => {
      render(<TripDetailByIdPageClient />)

      expect(await screen.findByRole('heading', { name: 'Your record' })).toBeInTheDocument()
      expect(mockFetchDriverParticipation).toHaveBeenCalledWith(history.trip_id)
      expect(screen.getByText(/Trip status now: Active/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Start|Continue Driving/ })).not.toBeInTheDocument()
    })

    it('test_reading_history_never_makes_the_trip_working_context', async () => {
      const selectTrip = vi.fn()
      const noteTripHandedOver = vi.fn()
      mockUseTrip.mockReturnValue({ selectTrip, trip: null, noteTripHandedOver })

      render(<TripDetailByIdPageClient />)
      await screen.findByRole('heading', { name: 'Your record' })

      expect(selectTrip).not.toHaveBeenCalled()
      expect(noteTripHandedOver).not.toHaveBeenCalled()
    })

    it('test_handed_over_working_trip_is_dropped_from_the_phase_flow', async () => {
      const noteTripHandedOver = vi.fn()
      mockUseTrip.mockReturnValue({ selectTrip: vi.fn(), trip: { id: history.trip_id }, noteTripHandedOver })

      render(<TripDetailByIdPageClient />)

      await waitFor(() => expect(noteTripHandedOver).toHaveBeenCalledWith(history.trip_id))
    })

    it('test_history_failure_still_says_the_trip_was_handed_over', async () => {
      mockFetchDriverParticipation.mockRejectedValue(new Error('offline'))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      render(<TripDetailByIdPageClient />)

      expect(await screen.findByText(/You handed this trip over/)).toBeInTheDocument()
      consoleError.mockRestore()
    })
  })
})
