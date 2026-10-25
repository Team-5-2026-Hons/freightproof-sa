// frontend/driver-pwa/components/trip/__tests__/LeaveEndedTripScreen.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockReplace, path, tripState, submissions } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  path: { value: '/trip/in-transit' },
  tripState: { value: null as { trip: unknown; isLoading: boolean } | null },
  submissions: { value: { inFlight: [] as string[], failures: [] } },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => path.value,
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}))
vi.mock('@/lib/hooks/useOptionalTrip', () => ({ useOptionalTrip: () => tripState.value }))
vi.mock('@/lib/submission/phase-submitter', () => ({ usePhaseSubmissions: () => submissions.value }))

import { LeaveEndedTripScreen, isTripBoundRoute } from '../LeaveEndedTripScreen'
import { RESUME_SCREEN_KEY } from '@/lib/navigation/resume'

const A_TRIP = { id: 'trip-1' }

beforeEach(() => {
  vi.clearAllMocks()
  path.value = '/trip/in-transit'
  tripState.value = { trip: null, isLoading: false }
  submissions.value = { inFlight: [], failures: [] }
  window.localStorage.clear()
})

describe('isTripBoundRoute', () => {
  it('test_trip_screens_are_trip_bound', () => {
    expect(isTripBoundRoute('/trip/in-transit')).toBe(true)
    expect(isTripBoundRoute('/trip/in-transit/checkpoint')).toBe(true)
    expect(isTripBoundRoute('/trip/phase/loading/step/seal')).toBe(true)
    expect(isTripBoundRoute('/trips/active')).toBe(true)
  })

  it('test_home_panic_and_substitution_are_not_trip_bound', () => {
    expect(isTripBoundRoute('/')).toBe(false)
    expect(isTripBoundRoute('/trip/panic')).toBe(false)
    expect(isTripBoundRoute('/trips/substitution')).toBe(false)
    expect(isTripBoundRoute('/trips/active-history')).toBe(false)
  })
})

describe('LeaveEndedTripScreen', () => {
  it('test_ended_trip_on_in_transit_goes_home_and_forgets_resume', () => {
    window.localStorage.setItem(RESUME_SCREEN_KEY, JSON.stringify({ url: '/trip/in-transit', actorId: 'd1', savedAt: new Date().toISOString() }))

    render(<LeaveEndedTripScreen />)

    expect(mockReplace).toHaveBeenCalledWith('/')
    expect(window.localStorage.getItem(RESUME_SCREEN_KEY)).toBeNull()
  })

  it('test_trip_present_stays', () => {
    tripState.value = { trip: A_TRIP, isLoading: false }

    render(<LeaveEndedTripScreen />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('test_still_loading_stays', () => {
    tripState.value = { trip: null, isLoading: true }

    render(<LeaveEndedTripScreen />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('test_submission_in_flight_stays', () => {
    path.value = '/trip/phase/confirmation/step/pod'
    submissions.value = { inFlight: ['phase-1'], failures: [] }

    render(<LeaveEndedTripScreen />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('test_no_trip_on_home_stays', () => {
    path.value = '/'

    render(<LeaveEndedTripScreen />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('test_trip_dropped_while_on_screen_goes_home', () => {
    tripState.value = { trip: A_TRIP, isLoading: false }
    const { rerender } = render(<LeaveEndedTripScreen />)

    tripState.value = { trip: null, isLoading: false }
    rerender(<LeaveEndedTripScreen />)

    expect(mockReplace).toHaveBeenCalledWith('/')
  })
})
