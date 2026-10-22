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
const CLIENT_REPORT_ID = '34d124eb-1708-42e8-9341-87f890ee16fd'

// Reuse the shared fixture so the trip shape stays in lockstep with the mocks the
// demo-mode tests use — only the transport (real API mocks below) differs.
const activeTrip = mockTrips.find(
  (t) => t.driver?.id === demoDriver.id && !['closed', 'cancelled'].includes(t.status),
)
if (!activeTrip) throw new Error('Fixture drift: mockDrivers[0] has no active mock trip')
// The trailer a driver names on an interlink breakdown — taken from the fixture so the
// id is one the trip really carries.
const namedTrailer = activeTrip.trailers[activeTrip.trailers.length - 1]
if (!namedTrailer) throw new Error('Fixture drift: mockDrivers[0]\'s active trip has no trailer')

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
  connectionFault: false,
  retryProfile: vi.fn(),
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
    phase_event_id: null,
    checkpoint_id: null,
    supporting_artifact_id: null,
    gps_lat: null,
    gps_lng: null,
    review_status: 'recorded',
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    vehicle_id: null,
    merkle_batch_id: null,
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: null,
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
            clientReportId: CLIENT_REPORT_ID,
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
      <button
        onClick={() =>
          ctx.logException('cargo_damage', {
            description: 'Pallet damaged.',
            gpsLat: -26.0942,
            gpsLng: 28.1342,
            driverCapturedAt: '2026-09-15T10:00:00Z',
            driverAccuracyMetres: 5,
          })
        }
      >
        log-exception-with-capture
      </button>
      <button
        onClick={() =>
          ctx.logException('mechanical', {
            description: 'Brake line burst on the rear trailer.',
            vehicleType: 'trailer',
            trailerId: String(namedTrailer.id),
          })
        }
      >
        log-trailer-breakdown
      </button>
      <button
        onClick={() =>
          ctx.logException('mechanical', {
            description: 'Warning light on the dash.',
            vehicleType: 'bakkie',
          })
        }
      >
        log-breakdown-unknown-kind
      </button>
      <button
        onClick={() =>
          ctx.logException('cargo_damage', {
            description: 'Pallet damaged.',
            supporting_artifact_ids: ['photo-a', 'photo-b', 'photo-c'],
          })
        }
      >
        log-exception-with-photos
      </button>
      <button
        onClick={() =>
          ctx.logException('cargo_damage', { description: 'Pallet damaged.', supporting_artifact_ids: [] })
        }
      >
        log-exception-empty-photo-list
      </button>
      <button
        onClick={() =>
          ctx.logException('cargo_damage', { description: 'Pallet damaged.' })
        }
      >
        log-exception-without-photos
      </button>
      <button
        onClick={() =>
          ctx.logException('cargo_damage', { description: 'Pallet damaged.', supporting_artifact_id: 'lone-legacy' })
        }
      >
        log-exception-lone-legacy-photo
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
        client_report_id: CLIENT_REPORT_ID,
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

  it('preserves a page-captured timestamp and accuracy on the API request', async () => {
    mockRaiseException.mockResolvedValue(createdException({}))
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-exception-with-capture'))
    })

    expect(mockRaiseException).toHaveBeenCalledWith(
      String(activeTrip!.id),
      expect.objectContaining({
        driver_captured_at: '2026-09-15T10:00:00Z',
        driver_accuracy_metres: 5,
      }),
    )
  })
})

// Trailer analytics: the page hands logException the driver's "truck or trailer" answer
// as vehicleType/trailerId; it must reach the server as vehicle_type/trailer_id.
describe('TripContext.logException (real mode) — the breakdown vehicle reaches raiseException', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMyActiveTrip.mockResolvedValue(activeTrip)
  })

  it('passes vehicleType/trailerId through as vehicle_type/trailer_id', async () => {
    mockRaiseException.mockResolvedValue(
      createdException({ exception_type: 'mechanical', vehicle_id: namedTrailer.id }),
    )
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-trailer-breakdown'))
    })

    expect(mockRaiseException).toHaveBeenCalledWith(
      String(activeTrip!.id),
      expect.objectContaining({
        exception_type: 'mechanical',
        vehicle_type: 'trailer',
        trailer_id: String(namedTrailer.id),
      }),
    )
  })

  it('sends neither field when the report carries no vehicle answer', async () => {
    mockRaiseException.mockResolvedValue(createdException({}))
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-panic-with-gps'))
    })

    const body = mockRaiseException.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('vehicle_type')
    expect(body).not.toHaveProperty('trailer_id')
  })

  it('drops a vehicle kind that is neither horse nor trailer instead of sending it', async () => {
    // The server would 422 an unknown kind, and the offline queue discards any 4xx —
    // so an unknown value is sent as no answer, and the report still lands.
    mockRaiseException.mockResolvedValue(createdException({ exception_type: 'mechanical' }))
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-breakdown-unknown-kind'))
    })

    const body = mockRaiseException.mock.calls[0][1] as Record<string, unknown>
    expect(body).toMatchObject({ exception_type: 'mechanical' })
    expect(body).not.toHaveProperty('vehicle_type')
  })
})

// FP-290: the driver can attach several photos. The page uploads them first and hands the
// complete ordered id list in; the first id also rides in the legacy single field so an
// older backend still receives the lead photo.
describe('TripContext.logException (real mode) — photo ids reach raiseException', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMyActiveTrip.mockResolvedValue(activeTrip)
    mockRaiseException.mockResolvedValue(createdException({}))
  })

  async function click(label: string) {
    await renderAndWaitForTrip()
    await act(async () => {
      fireEvent.click(screen.getByText(label))
    })
  }

  it('logException_sends_supporting_artifact_ids_and_first_as_legacy_field', async () => {
    await click('log-exception-with-photos')

    expect(mockRaiseException).toHaveBeenCalledWith(
      String(activeTrip!.id),
      expect.objectContaining({
        supporting_artifact_ids: ['photo-a', 'photo-b', 'photo-c'],
        supporting_artifact_id: 'photo-a',
      }),
    )
  })

  it('logException_omits_both_when_no_photos', async () => {
    await click('log-exception-without-photos')

    const body = mockRaiseException.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('supporting_artifact_ids')
    expect(body.supporting_artifact_id).toBeUndefined()
  })

  it('omits both when the id list is empty', async () => {
    await click('log-exception-empty-photo-list')

    const body = mockRaiseException.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('supporting_artifact_ids')
    expect(body.supporting_artifact_id).toBeUndefined()
  })

  it('still honours a lone legacy supporting_artifact_id', async () => {
    await click('log-exception-lone-legacy-photo')

    const body = mockRaiseException.mock.calls[0][1] as Record<string, unknown>
    expect(body.supporting_artifact_id).toBe('lone-legacy')
    expect(body).not.toHaveProperty('supporting_artifact_ids')
  })
})
