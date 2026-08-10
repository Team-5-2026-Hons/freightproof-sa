// frontend/driver-pwa/lib/context/__tests__/TripContext.autorefresh.test.tsx
//
// refreshQuietly's own contract — see docs/superpowers/specs/
// 2026-08-10-driver-pwa-trip-auto-refresh-design.md "Required properties" 1 and 2, plus
// the offline-safe/never-throw guarantee useTripAutoRefresh.ts depends on. Real (non-demo)
// mode, same split as TripContext.real.test.tsx: IS_DEMO_MODE is a module-level constant,
// and refreshQuietly is a documented no-op in demo mode (property 7), so these three
// properties can only be exercised with it mocked false.
import { useContext } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TripContext, TripProvider } from '../TripContext'
import { AuthContext } from '../AuthContext'
import { ToastContext, type ToastState } from '../ToastContext'
import type { AuthState } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseEventId } from '@shared/lib/types/phase'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const mockFetchMyActiveTrip = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyActiveTrip: (...args: unknown[]) => mockFetchMyActiveTrip(...args),
  fetchMyTrip: vi.fn(),
}))

const demoDriver = mockDrivers[0]

const authValue: AuthState = {
  user: demoDriver,
  isLoading: false,
  requestOtp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}

// A single-phase trip with the phase still open ('pending') server-side — the fixture
// tests below flip to 'syncing' locally and rely on the server's own answer never moving
// that phase past pending, so a re-fetch reflecting THAT is the mid-submission poll the
// optimistic layer is supposed to survive.
const OPEN_PHASE_ID = 'phase-event-open' as PhaseEventId
// A second, unrelated phase id — used to prove the unblock toast keys off phase IDENTITY
// and not just the gate value (see the gate-transition describe block at the bottom).
const OTHER_PHASE_ID = 'phase-event-other' as PhaseEventId

interface BuildTripOptions {
  phaseEventId?: PhaseEventId
  blockedOn?: string | null
}

function buildTrip({ phaseEventId = OPEN_PHASE_ID, blockedOn = null }: BuildTripOptions = {}): Trip {
  return {
    id: 'trip-autorefresh-1' as unknown as Trip['id'],
    trip_reference: 'TRP-AR-0001',
    order_number: 'ORD-AR-1',
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
    phases: [makePhase('loading', { phase_event_id: phaseEventId, status: 'pending', blocked_on: blockedOn })],
    current_phase: 'loading',
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function Probe() {
  const ctx = useContext(TripContext)
  if (!ctx) return null
  const phase = ctx.trip?.phases.find((p) => p.phase_event_id === OPEN_PHASE_ID)
  return (
    <div>
      {/* The only reliable "the mount fetch actually landed" signal — mirrors every
          other TripContext test file's Probe (see TripContext.real.test.tsx). */}
      <span data-testid="trip-loaded">{ctx.trip ? 'yes' : 'no'}</span>
      <span data-testid="is-loading">{String(ctx.isLoading)}</span>
      <span data-testid="is-refreshing">{String(ctx.isRefreshing)}</span>
      <span data-testid="last-refreshed">{ctx.lastRefreshedAt ?? ''}</span>
      <span data-testid="phase-status">{phase?.status ?? ''}</span>
      <button onClick={() => ctx.markPhaseSyncing(OPEN_PHASE_ID)}>mark-syncing</button>
      <button onClick={() => { void ctx.refreshQuietly() }}>refresh-quietly</button>
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

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TripContext.refreshQuietly — quiet (property 1)', () => {
  it('never sets isLoading, even while a refresh is in flight', async () => {
    let resolveSecondFetch: (trip: Trip) => void = () => {}
    mockFetchMyActiveTrip
      .mockResolvedValueOnce(buildTrip())
      .mockImplementationOnce(() => new Promise<Trip>((resolve) => { resolveSecondFetch = resolve }))

    await renderAndWaitForTrip()
    expect(screen.getByTestId('is-loading')).toHaveTextContent('false')

    // Fires refreshQuietly and lets its synchronous portion (setIsRefreshing(true), the
    // call into loadTrip()) flush, without resolving the underlying fetch yet.
    act(() => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })
    expect(screen.getByTestId('is-refreshing')).toHaveTextContent('true')
    // The property under test: isLoading never moves, even mid-refresh — none of the
    // six screens gated on it may blank to a spinner for this fetch.
    expect(screen.getByTestId('is-loading')).toHaveTextContent('false')

    await act(async () => {
      resolveSecondFetch(buildTrip())
      await Promise.resolve()
    })

    expect(screen.getByTestId('is-refreshing')).toHaveTextContent('false')
    expect(screen.getByTestId('is-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('last-refreshed')).not.toHaveTextContent('')
  })
})

describe('TripContext.refreshQuietly — optimistic layer preserved (property 2)', () => {
  it('a refresh landing while a phase is syncing leaves that phase resolved', async () => {
    // Every fetch (mount + refresh) returns the SAME server state — the phase is still
    // 'pending' server-side, exactly what a poll landing mid-submission looks like.
    mockFetchMyActiveTrip.mockResolvedValue(buildTrip())

    await renderAndWaitForTrip()
    expect(screen.getByTestId('phase-status')).toHaveTextContent('pending')

    act(() => {
      fireEvent.click(screen.getByText('mark-syncing'))
    })
    expect(screen.getByTestId('phase-status')).toHaveTextContent('completed')

    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })

    // The server's own answer (still pending) landed in serverTrip, but
    // withOptimisticResolution re-layers syncingPhaseIds on top of it — the phase must
    // not un-complete out from under a submission still in flight.
    expect(screen.getByTestId('phase-status')).toHaveTextContent('completed')
  })
})

describe('TripContext.refreshQuietly — rejected refresh', () => {
  it('is logged and does not throw or clear the trip', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchMyActiveTrip
      .mockResolvedValueOnce(buildTrip())
      .mockRejectedValueOnce(new Error('network down'))

    await renderAndWaitForTrip()

    // No try/catch here on purpose — a throw out of refreshQuietly would fail this test
    // via an unhandled rejection, which is exactly the "never throws" contract under test.
    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })

    expect(screen.getByTestId('trip-loaded')).toHaveTextContent('yes')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Quiet trip refresh failed', expect.any(Error))
  })
})

describe('TripContext — unblock toast fires on a real gate transition only', () => {
  const BLOCKED_ON_SCAN = 'warehouse_scan'

  function renderWithToast(notify: ToastState['notify']) {
    const toastValue: ToastState = { toasts: [], notify, dismiss: vi.fn() }
    render(
      <ToastContext.Provider value={toastValue}>
        <AuthContext.Provider value={authValue}>
          <TripProvider>
            <Probe />
          </TripProvider>
        </AuthContext.Provider>
      </ToastContext.Provider>,
    )
  }

  // A mutable "what the server currently says" instead of an ordered mock queue. Mounting
  // on a BLOCKED trip switches polling on, which fires a leading-edge refresh immediately
  // (useTripAutoRefresh.ts) — so the number of fetches before the assertions is an
  // implementation detail, and a .mockResolvedValueOnce chain silently ran off the end of
  // its queue the moment that leading check was added.
  function serveTrip(initial: Trip): (next: Trip) => void {
    let current = initial
    mockFetchMyActiveTrip.mockImplementation(() => Promise.resolve(current))
    return (next: Trip) => { current = next }
  }

  it('notifies when the actionable phase goes from blocked to unblocked', async () => {
    const notify = vi.fn()
    const serveNext = serveTrip(buildTrip({ blockedOn: BLOCKED_ON_SCAN }))

    renderWithToast(notify)
    await waitFor(() => expect(screen.getByTestId('trip-loaded')).toHaveTextContent('yes'))
    // Every observation so far has been blocked — seeding, never a transition.
    expect(notify).not.toHaveBeenCalled()

    serveNext(buildTrip({ blockedOn: null }))
    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'You can continue' }))
  })

  it('stays silent when a DIFFERENT phase becomes actionable while unblocked', async () => {
    // Regression: the first implementation remembered only the last gate VALUE, so any
    // later unblocked plan read as "the warehouse finished" — including a driver simply
    // switching to their other assignment, which had never been blocked at all.
    const notify = vi.fn()
    const serveNext = serveTrip(buildTrip({ blockedOn: BLOCKED_ON_SCAN }))

    renderWithToast(notify)
    await waitFor(() => expect(screen.getByTestId('trip-loaded')).toHaveTextContent('yes'))

    // One more refresh while STILL blocked. Load-bearing: this is what seeded the old
    // value-only implementation's ref, so without it the old code would also stay silent
    // below and this test would pass against the very bug it exists to guard.
    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })
    expect(notify).not.toHaveBeenCalled()

    // The driver opens their OTHER assignment, which was never blocked.
    serveNext(buildTrip({ phaseEventId: OTHER_PHASE_ID, blockedOn: null }))
    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })

    expect(notify).not.toHaveBeenCalled()
  })

  it('stays silent when the trip was never blocked', async () => {
    const notify = vi.fn()
    mockFetchMyActiveTrip.mockResolvedValue(buildTrip({ blockedOn: null }))

    renderWithToast(notify)
    await waitFor(() => expect(screen.getByTestId('trip-loaded')).toHaveTextContent('yes'))

    await act(async () => {
      fireEvent.click(screen.getByText('refresh-quietly'))
    })

    expect(notify).not.toHaveBeenCalled()
  })
})
