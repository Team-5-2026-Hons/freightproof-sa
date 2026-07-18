import { useContext } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TripContext, TripProvider, handshakeFromStatus } from '../TripContext'
import { AuthContext } from '../AuthContext'
import type { AuthState } from '@/lib/types/user'
import type { TripStatus } from '@shared/lib/types/trip'
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

function renderWithProviders() {
  return render(
    <AuthContext.Provider value={authValue}>
      <TripProvider>
        <Probe />
      </TripProvider>
    </AuthContext.Provider>,
  )
}

describe('TripContext session exceptions (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds exceptions from the active trip fixture', async () => {
    renderWithProviders()

    await waitFor(() =>
      expect(screen.getByTestId('exception-count')).toHaveTextContent(String(activeTrip.exceptions.length)),
    )
  })

  it('logException appends the new exception to the context value', async () => {
    renderWithProviders()
    await waitFor(() => screen.getByText('log-exception'))

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
    renderWithProviders()
    await waitFor(() => screen.getByText('log-panic-with-gps'))

    await act(async () => {
      fireEvent.click(screen.getByText('log-panic-with-gps'))
    })

    expect(screen.getByTestId('last-gps')).toHaveTextContent(JSON.stringify([-26.0942, 28.1342]))
  })

  it('demo logException records null GPS (not a partial fix) when no coordinates are passed', async () => {
    renderWithProviders()
    await waitFor(() => screen.getByText('log-exception'))

    await act(async () => {
      fireEvent.click(screen.getByText('log-exception'))
    })

    expect(screen.getByTestId('last-gps')).toHaveTextContent(JSON.stringify([null, null]))
  })
})

// Trip.status records the handshake that was just COMPLETED (confirmed in
// backend/app/orchestration/handshake_service.py), so handshakeFromStatus must map
// each status to the NEXT actionable handshake — one past the one already done —
// not to "that handshake in progress". Covers every TripStatus value, including the
// two the backend currently never persists ('origin_gate_out', 'unloading') and the
// terminal/off-path statuses that fall through to the default.
describe('handshakeFromStatus', () => {
  it.each<[TripStatus, 1 | 2 | 3 | 4 | 5]>([
    ['created', 1],
    ['origin_gate_in', 2],
    ['loading', 3],
    ['origin_gate_out', 4],
    ['in_transit', 4],
    ['dest_gate_in', 5],
    ['unloading', 5],
  ])('maps %s -> H%i', (status, expected) => {
    expect(handshakeFromStatus(status)).toBe(expected)
  })

  it.each<TripStatus>(['closed', 'cancelled', 'exception_hold'])(
    'falls back to H1 for the terminal/off-path status %s',
    (status) => {
      expect(handshakeFromStatus(status)).toBe(1)
    },
  )
})
