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
  return (
    <div>
      <span data-testid="exception-count">{ctx.exceptions.length}</span>
      <ul>
        {ctx.exceptions.map((e) => (
          <li key={String(e.id)}>{e.description}</li>
        ))}
      </ul>
      <button onClick={() => ctx.logException('cargo_damage', { description: 'Pallet crushed at rest stop' })}>
        log-exception
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
