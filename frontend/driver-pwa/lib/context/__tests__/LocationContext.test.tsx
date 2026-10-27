// frontend/driver-pwa/lib/context/__tests__/LocationContext.test.tsx
//
// The trail replaced three manual "Capture GPS Location" steps, so these tests cover the
// promises that replacement makes: it records without being asked, it only does so while
// a trip is open, and a failure — of the fix or of the network — never surfaces to the
// driver or costs them the fix.
import { createElement, useContext } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocationContext, LocationProvider } from '../LocationContext'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

let pathname = '/trips'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

let tripState: { trip: { id: string } | null } = { trip: { id: 'trip-1' } }
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => tripState }))

const mockCapture = vi.fn()
vi.mock('@/lib/hooks/useLocation', () => ({ useLocation: () => ({ captureResult: async () => { const coords = await mockCapture(); return { coords, errorReason: coords === null ? 'permission_denied' : null } } }) }))

const mockEnqueueLocation = vi.fn()
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueLocation: mockEnqueueLocation }),
}))

const mockRecordLocations = vi.fn()
vi.mock('@/lib/api/locations', () => ({
  recordLocations: (...args: unknown[]) => mockRecordLocations(...args),
}))

const FIX = { latitude: -26.0942, longitude: 28.1342, accuracy: 8.5, capturedAt: '2026-10-20T12:00:00Z' }

function Consumer() {
  const { capturePosition } = useLocationTrail()
  return (
    <button onClick={() => { void capturePosition() }}>capture</button>
  )
}

function renderTrail() {
  return render(<LocationProvider><Consumer /></LocationProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  bindActorLease('driver-a', invalidateActorLease())
  pathname = '/trips'
  tripState = { trip: { id: 'trip-1' } }
  mockCapture.mockResolvedValue(FIX)
  mockRecordLocations.mockResolvedValue({ recorded: 1 })
})

it.each([false, true])('retains_a_navigation_fix_without_sending_after_account_change_return=%s', async (returnToA) => {
  let deliver!: (value: typeof FIX) => void
  mockCapture.mockImplementationOnce(() => new Promise<typeof FIX>(resolve => { deliver = resolve }))
  renderTrail()
  await waitFor(() => expect(mockCapture).toHaveBeenCalledOnce())
  bindActorLease('driver-b', invalidateActorLease())
  if (returnToA) bindActorLease('driver-a', invalidateActorLease())
  await act(async () => { deliver(FIX) })

  expect(mockRecordLocations).not.toHaveBeenCalled()
  expect(mockEnqueueLocation).toHaveBeenCalledWith('trip-1', [expect.objectContaining({ lat: FIX.latitude })],
    expect.objectContaining({ actorId: 'driver-a', custodySequence: null }))
})

describe('LocationProvider', () => {
  it('records a fix against the open trip when the driver opens a screen', async () => {
    renderTrail()

    await waitFor(() => expect(mockRecordLocations).toHaveBeenCalledWith('trip-1', [
      expect.objectContaining({
        lat: FIX.latitude, lng: FIX.longitude, accuracy_m: FIX.accuracy, context: '/trips',
      }),
    ], null))
  })

  it('records nothing at all when no trip is open', async () => {
    tripState = { trip: null }

    renderTrail()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockCapture).not.toHaveBeenCalled()
    expect(mockRecordLocations).not.toHaveBeenCalled()
  })

  it('queues the ping when the request cannot land, keeping the device timestamp', async () => {
    mockRecordLocations.mockRejectedValue(new TypeError('network unreachable'))

    renderTrail()

    await waitFor(() => expect(mockEnqueueLocation).toHaveBeenCalledWith('trip-1', [
      expect.objectContaining({ lat: FIX.latitude, recorded_at: expect.any(String) }),
    ], expect.objectContaining({ custodySequence: null })))
  })

  it('does not record when the phone cannot produce a fix', async () => {
    mockCapture.mockResolvedValue(null)

    renderTrail()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockRecordLocations).not.toHaveBeenCalled()
    expect(mockEnqueueLocation).not.toHaveBeenCalled()
  })

  it('omits accuracy rather than sending a zero when the platform reports none', async () => {
    mockCapture.mockResolvedValue({ ...FIX, accuracy: null })

    renderTrail()

    await waitFor(() => expect(mockRecordLocations).toHaveBeenCalled())
    const [, pings] = mockRecordLocations.mock.calls[0] as [string, Record<string, unknown>[]]
    expect(pings[0]).not.toHaveProperty('accuracy_m')
  })

  it('hands a submission the fix as a DriverPosition', async () => {
    renderTrail()
    await waitFor(() => expect(mockRecordLocations).toHaveBeenCalled())
    mockCapture.mockClear()

    screen.getByText('capture').click()

    await waitFor(() => expect(mockCapture).toHaveBeenCalled())
  })
})


it('opening_the_transfer_page_does_not_capture_background_gps_for_the_outgoing_driver', () => {
  pathname = '/trips/substitution'
  renderTrail()
  expect(mockCapture).not.toHaveBeenCalled()
})

it('adapter_preserves_sample_time_and_returns_current_error_reason', async () => {
  tripState = { trip: null }
  mockCapture.mockResolvedValueOnce(FIX).mockResolvedValueOnce(null)
  const { result } = renderHook(() => useContext(LocationContext)!, { wrapper: ({ children }) => createElement(LocationProvider, null, children) })
  let observed: unknown
  await act(async () => { observed = await result.current.captureObservation() })
  expect(observed).toEqual({ position: { lat: FIX.latitude, lng: FIX.longitude, accuracyM: FIX.accuracy, capturedAt: FIX.capturedAt }, unavailableReason: null })
  await act(async () => { observed = await result.current.captureObservation() })
  expect(observed).toEqual({ position: null, unavailableReason: 'permission_denied' })
})
