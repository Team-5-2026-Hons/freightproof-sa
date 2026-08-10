// frontend/driver-pwa/lib/context/__tests__/LocationContext.test.tsx
//
// The trail replaced three manual "Capture GPS Location" steps, so these tests cover the
// promises that replacement makes: it records without being asked, it only does so while
// a trip is open, and a failure — of the fix or of the network — never surfaces to the
// driver or costs them the fix.
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocationProvider } from '../LocationContext'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

let pathname = '/trips'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

let tripState: { trip: { id: string } | null } = { trip: { id: 'trip-1' } }
vi.mock('@/lib/hooks/useTrip', () => ({ useTrip: () => tripState }))

const mockCapture = vi.fn()
vi.mock('@/lib/hooks/useLocation', () => ({ useLocation: () => ({ capture: mockCapture }) }))

const mockEnqueueLocation = vi.fn()
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueLocation: mockEnqueueLocation }),
}))

const mockRecordLocations = vi.fn()
vi.mock('@/lib/api/locations', () => ({
  recordLocations: (...args: unknown[]) => mockRecordLocations(...args),
}))

const FIX = { latitude: -26.0942, longitude: 28.1342, accuracy: 8.5 }

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
  pathname = '/trips'
  tripState = { trip: { id: 'trip-1' } }
  mockCapture.mockResolvedValue(FIX)
  mockRecordLocations.mockResolvedValue({ recorded: 1 })
})

describe('LocationProvider', () => {
  it('records a fix against the open trip when the driver opens a screen', async () => {
    renderTrail()

    await waitFor(() => expect(mockRecordLocations).toHaveBeenCalledWith('trip-1', [
      expect.objectContaining({
        lat: FIX.latitude, lng: FIX.longitude, accuracy_m: FIX.accuracy, context: '/trips',
      }),
    ]))
  })

  it('records nothing at all when no trip is open', async () => {
    // The app does not follow a driver around between jobs — no trip, no tracking.
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
    ]))
  })

  it('does not record when the phone cannot produce a fix', async () => {
    // A denied permission or a warehouse roof. Nothing is sent, and nothing is queued —
    // there is no position to queue, and the driver is never told about it.
    mockCapture.mockResolvedValue(null)

    renderTrail()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockRecordLocations).not.toHaveBeenCalled()
    expect(mockEnqueueLocation).not.toHaveBeenCalled()
  })

  it('omits accuracy rather than sending a zero when the platform reports none', async () => {
    // 0 would claim a centimetre-perfect fix, which is the opposite of what a missing
    // accuracy estimate means.
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
