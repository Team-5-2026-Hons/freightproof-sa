import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTripRoute } from '../useTripRoute'

let mockDemoMode = false
vi.mock('@/lib/constants/env', () => ({
  get IS_DEMO_MODE() { return mockDemoMode },
  GOOGLE_MAPS_API_KEY: '',
}))

const mockFetchMyTripRoute = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyTripRoute: (tripId: string) => mockFetchMyTripRoute(tripId),
}))

const ROUTE = {
  trip_id: 'trip-1', provider: 'openrouteservice', profile: 'driving-hgv',
  distance_metres: 1000, duration_seconds: 60, legs: [], computed_at: '2026-10-14T08:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDemoMode = false
})

describe('useTripRoute', () => {
  it('test_returns_the_route_for_the_trip', async () => {
    mockFetchMyTripRoute.mockResolvedValue(ROUTE)

    const { result } = renderHook(() => useTripRoute('trip-1'))

    await waitFor(() => expect(result.current).toEqual(ROUTE))
    expect(mockFetchMyTripRoute).toHaveBeenCalledWith('trip-1')
  })

  it('test_stays_null_when_the_fetch_fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetchMyTripRoute.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useTripRoute('trip-1'))

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(result.current).toBeNull()
    warn.mockRestore()
  })

  it('test_does_not_fetch_without_a_trip_or_in_demo_mode', () => {
    renderHook(() => useTripRoute(null))
    mockDemoMode = true
    renderHook(() => useTripRoute('trip-1'))

    expect(mockFetchMyTripRoute).not.toHaveBeenCalled()
  })
})
