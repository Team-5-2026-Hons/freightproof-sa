import { useContext } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TripContext, TripProvider } from '../TripContext'
import { AuthContext } from '../AuthContext'
import type { AuthState } from '@/lib/types/user'
import type { TripException } from '@shared/lib/types/exception'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockTrips } from '@shared/lib/mocks/trips'

// Real (non-demo) mode: IS_DEMO_MODE is a module-level constant, so the demo and
// real branches of logException need separate test files — same split as
// AuthContext.test.tsx / AuthContext.real.test.tsx. This file exists to pin the
// GPS-drop regression at the API boundary: gpsLat/gpsLng passed into logException
// MUST land in raiseException's body as gps_lat/gps_lng, because TripContext
// previously extracted only description + supporting_artifact_id and silently
// discarded the coordinates the panic page had promised the driver.

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const demoDriver = mockDrivers[0]

// Reuse the shared fixture so the trip shape stays in lockstep with the mocks the
// demo-mode tests use — only the transport (real API mocks below) differs.
const activeTrip = mockTrips.find(
  (t) => t.driver?.id === demoDriver.id && !['closed', 'cancelled'].includes(t.status),
)
if (!activeTrip) throw new Error('Fixture drift: mockDrivers[0] has no active mock trip')

const mockFetchMyActiveTrip = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyActiveTrip: (...args: unknown[]) => mockFetchMyActiveTrip(...args),
}))

const mockRaiseException = vi.fn()
vi.mock('@/lib/api/exceptions', () => ({
  raiseException: (...args: unknown[]) => mockRaiseException(...args),
}))

const authValue: AuthState = {
  user: demoDriver,
  isLoading: false,
  requestOtp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}

function createdException(overrides: Partial<TripException>): TripException {
  return {
    id: crypto.randomUUID() as unknown as TripException['id'],
    trip_id: String(activeTrip!.id),
    exception_type: 'panic_button',
    source: 'driver',
    severity: 'critical',
    description: 'Driver activated panic button.',
    handshake_event_id: null,
    checkpoint_id: null,
    supporting_artifact_id: null,
    gps_lat: null,
    gps_lng: null,
    resolved: false,
    resolved_by_user_id: null,
    resolved_at: null,
    resolver_note: null,
    merkle_batch_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function Probe() {
  const ctx = useContext(TripContext)
  if (!ctx) return null
  return (
    <div>
      <span data-testid="trip-loaded">{ctx.trip ? 'yes' : 'no'}</span>
      <button
        onClick={() =>
          ctx.logException('panic_button', {
            description: 'Driver activated panic button.',
            triggeredAt: new Date().toISOString(),
            gpsLat: -26.0942,
            gpsLng: 28.1342,
          })
        }
      >
        log-panic-with-gps
      </button>
      <button
        onClick={() =>
          ctx.logException('panic_button', {
            description: 'Driver activated panic button.',
            triggeredAt: new Date().toISOString(),
            gpsLat: null,
            gpsLng: null,
          })
        }
      >
        log-panic-no-gps
      </button>
    </div>
  )
}

async function renderAndWaitForTrip() {
  render(
    <AuthContext.Provider value={authValue}>
      <TripProvider>
        <Probe />
      </TripProvider>
    </AuthContext.Provider>,
  )
  await waitFor(() => expect(screen.getByTestId('trip-loaded')).toHaveTextContent('yes'))
}

describe('TripContext.logException (real mode) — GPS reaches raiseException', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMyActiveTrip.mockResolvedValue(activeTrip)
  })

  it('passes gpsLat/gpsLng through to raiseException as gps_lat/gps_lng', async () => {
    mockRaiseException.mockResolvedValue(
      createdException({ gps_lat: -26.0942, gps_lng: 28.1342 }),
    )
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-panic-with-gps'))
    })

    expect(mockRaiseException).toHaveBeenCalledWith(
      String(activeTrip!.id),
      expect.objectContaining({
        exception_type: 'panic_button',
        description: 'Driver activated panic button.',
        gps_lat: -26.0942,
        gps_lng: 28.1342,
      }),
    )
  })

  it('sends undefined gps fields (not a partial fix) when the capture returned null', async () => {
    mockRaiseException.mockResolvedValue(createdException({}))
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-panic-no-gps'))
    })

    // gpsLat/gpsLng of null (failed capture) must not become gps_lat: null in the
    // body — the backend treats explicit null the same as absent, but sending
    // undefined keeps the JSON payload free of the keys entirely.
    expect(mockRaiseException).toHaveBeenCalledWith(
      String(activeTrip!.id),
      expect.objectContaining({ gps_lat: undefined, gps_lng: undefined }),
    )
  })
})
