import { useContext } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TripContext, TripProvider } from '../TripContext'
import { AuthContext } from '../AuthContext'
import type { AuthState } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockTrips } from '@shared/lib/mocks/trips'

// These tests run in demo mode (NEXT_PUBLIC_DEMO_MODE unset in vitest), so
// TripProvider resolves the mock trip for mockDrivers[0] and logException
// appends locally — the exact path the in-transit hub's exception list (5b)
// depends on: a session-logged exception must land in ctx.exceptions.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const demoDriver = mockDrivers[0]

// Mirror TripProvider's own active-trip selection so the expected baseline
// exception count comes from the fixture, not a hardcoded number.
const activeTrip = mockTrips.find(
  (t) => t.driver?.id === demoDriver.id && !['closed', 'cancelled'].includes(t.status),
)
if (!activeTrip) throw new Error('Fixture drift: mockDrivers[0] has no active mock trip')

const authValue: AuthState = {
  user: demoDriver,
  isLoading: false,
  requestOtp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}

function Probe() {
  const ctx = useContext(TripContext)
  if (!ctx) return null
  const last = ctx.exceptions[ctx.exceptions.length - 1]
  return (
    <div>
      {/* Mirrors TripContext.real.test.tsx's own Probe: the ONLY reliable signal that
          TripProvider's async trip load (a Promise.resolve().then() microtask, even in
          demo mode — see TripContext.tsx's mount effect) has actually landed. The
          buttons below are static and mount immediately regardless of load state, so
          waiting on their mere presence is not enough — see renderAndWaitForTrip. */}
      <span data-testid="trip-loaded">{ctx.trip ? 'yes' : 'no'}</span>
      <span data-testid="exception-count">{ctx.exceptions.length}</span>
      {/* JSON.stringify keeps null ("null") distinguishable from undefined ("") so the
          GPS tests below can tell "explicitly no fix" apart from "field missing". */}
      <span data-testid="last-gps">{last ? JSON.stringify([last.gps_lat, last.gps_lng]) : ''}</span>
      <ul>
        {ctx.exceptions.map((e) => (
          <li key={String(e.id)}>{e.description}</li>
        ))}
      </ul>
      <button onClick={() => ctx.logException('cargo_damage', { description: 'Pallet crushed at rest stop' })}>
        log-exception
      </button>
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
    </div>
  )
}

// Root cause of the intermittent "demo logException carries the GPS pair" failure:
// TripProvider seeds `trip` asynchronously (a microtask, even in demo mode — see
// TripContext.tsx's mount effect), but Probe's buttons render unconditionally from
// the very first paint, before that microtask has necessarily run. The old
// `await waitFor(() => screen.getByText('log-panic-with-gps'))` only proved the
// STATIC button existed — true on every render, load state notwithstanding — so a
// click could race ahead of the trip load. logException's demo branch starts with
// `if (!trip) return`, so a premature click silently no-ops: no exception is
// appended, and the GPS assertion fails against an empty list. Under the full suite
// (more concurrent microtask/scheduler activity in the same worker) that race lands
// unfavourably often enough to be visible; in isolation it usually doesn't. The fix
// is to wait on a signal that actually reflects `ctx.trip` being set — exactly what
// TripContext.real.test.tsx's renderAndWaitForTrip already does correctly — rather
// than a retry, a skip, or a longer timeout.
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

describe('TripContext session exceptions (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds exceptions from the active trip fixture', async () => {
    await renderAndWaitForTrip()

    expect(screen.getByTestId('exception-count')).toHaveTextContent(String(activeTrip.exceptions.length))
  })

  it('logException appends the new exception to the context value', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-exception'))
    })

    expect(screen.getByTestId('exception-count')).toHaveTextContent(String(activeTrip.exceptions.length + 1))
    expect(screen.getByText('Pallet crushed at rest stop')).toBeInTheDocument()
  })

  // GPS-drop regression (demo branch): the panic page passes gpsLat/gpsLng into
  // logException — the demo record must carry them so demo mode exercises the same
  // shape the real backend now persists. The real-mode raiseException-body assertion
  // lives in TripContext.real.test.tsx (IS_DEMO_MODE is a module-level mock, so
  // demo and real branches need separate files — same split as AuthContext).
  it('demo logException carries the GPS pair into the local exception record', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-panic-with-gps'))
    })

    expect(screen.getByTestId('last-gps')).toHaveTextContent(JSON.stringify([-26.0942, 28.1342]))
  })

  it('demo logException records null GPS (not a partial fix) when no coordinates are passed', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-exception'))
    })

    expect(screen.getByTestId('last-gps')).toHaveTextContent(JSON.stringify([null, null]))
  })
})
