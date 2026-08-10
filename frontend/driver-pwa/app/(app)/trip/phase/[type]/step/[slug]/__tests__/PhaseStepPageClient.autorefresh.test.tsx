// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.autorefresh.test.tsx
//
// The one test the other three page-client suites CANNOT be: they all
// `vi.mock('@/lib/hooks/useTrip')` and hand the page a hand-built trip object, so nothing
// in them exercises the real chain from a poll landing in TripContext through to what the
// driver is looking at. This file mounts the REAL TripProvider and mocks only the API
// boundary, which is the only way to catch "the context went fresh and the step page kept
// rendering the stale plan".
//
// Scenario under test is the field report verbatim: a driver stands on the blocked loading
// step and does not touch anything. The warehouse closes its scan session. The wait card
// must clear on its own — no navigation away and back, no app relaunch.
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PhaseStepPageClient from '../PhaseStepPageClient'
import { TripProvider } from '@/lib/context/TripContext'
import { AuthContext } from '@/lib/context/AuthContext'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { TRIP_POLL_INTERVAL_MS } from '@/lib/constants/app'
import type { AuthState } from '@/lib/types/user'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseEventId } from '@shared/lib/types/phase'

const LOADING_PE = 'pe-loading-blocked' as PhaseEventId

// Real (non-demo) mode: refreshQuietly is a documented no-op in demo mode, so the whole
// mechanism is unreachable with the default flag.
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false, GOOGLE_MAPS_API_KEY: '' }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ type: 'loading', slug: '1-linehaul' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const mockFetchMyActiveTrip = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyActiveTrip: () => mockFetchMyActiveTrip(),
  fetchMyTrip: vi.fn(),
  fetchMyTrips: vi.fn(),
}))

const mockFetchLinehaul = vi.fn()
vi.mock('@/lib/api/manifest', () => ({ fetchLinehaul: (id: string) => mockFetchLinehaul(id) }))

// Leaf-level device/IO concerns, stubbed so the test exercises the data chain and not the
// camera. CameraCapture only renders in the UNBLOCKED branch, which is exactly the branch
// this test asserts we reach.
vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: () => ({ uploadNow: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label }: { label: string }) => <div>{label} capture</div>,
}))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueuePhase: vi.fn(), pending: [], failures: [] }),
}))
vi.mock('@/lib/api/phases', () => ({ submitPhase: vi.fn() }))

const authValue: AuthState = {
  user: mockDrivers[0],
  isLoading: false,
  requestOtp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}

function buildTrip(blockedOn: string | null): Trip {
  return {
    id: 'trip-autorefresh-page' as unknown as Trip['id'],
    trip_reference: 'TRP-AR-PAGE',
    order_number: 'ORD-AR-PAGE',
    status: 'active',
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-1',
    destination_precinct_id: 'precinct-2',
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
    phases: [
      makePhase('loading', {
        phase_event_id: LOADING_PE,
        sequence_number: 2,
        status: 'in_progress',
        blocked_on: blockedOn,
      }),
    ],
    current_phase: 'loading',
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
  mockFetchLinehaul.mockResolvedValue(null)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PhaseStepPageClient — the blocked step clears itself while the driver waits on it', () => {
  it('drops the wait card one poll interval after the warehouse closes its session', async () => {
    // First read: blocked. Every read after: the warehouse has finished.
    mockFetchMyActiveTrip
      .mockResolvedValueOnce(buildTrip('warehouse_scan'))
      .mockResolvedValue(buildTrip(null))

    render(
      <AuthContext.Provider value={authValue}>
        <TripProvider>
          <PhaseStepPageClient />
        </TripProvider>
      </AuthContext.Provider>,
    )

    await waitFor(() => expect(screen.getByText('Waiting for the warehouse')).toBeInTheDocument())

    // The driver touches NOTHING. No navigation, no remount, no foreground event —
    // only time passing, which is the whole complaint.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRIP_POLL_INTERVAL_MS + 1_000)
    })

    expect(screen.queryByText('Waiting for the warehouse')).not.toBeInTheDocument()
    expect(screen.getByText('Confirm linehaul')).toBeInTheDocument()
  })

  it('checks immediately on arriving at a blocked step, not a full interval later', async () => {
    // The field case this covers: the warehouse finished BEFORE the driver walked up to
    // the step. The plan the page renders from is then already stale on arrival, and
    // waiting a whole interval to ask reads exactly like "it never refreshes" to a driver
    // standing at the gate — which is what a trailing-edge-only interval does.
    mockFetchMyActiveTrip
      .mockResolvedValueOnce(buildTrip('warehouse_scan'))
      .mockResolvedValue(buildTrip(null))

    render(
      <AuthContext.Provider value={authValue}>
        <TripProvider>
          <PhaseStepPageClient />
        </TripProvider>
      </AuthContext.Provider>,
    )

    await waitFor(() => expect(screen.getByText('Waiting for the warehouse')).toBeInTheDocument())

    // Nowhere near a full poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.queryByText('Waiting for the warehouse')).not.toBeInTheDocument()
  })
})
