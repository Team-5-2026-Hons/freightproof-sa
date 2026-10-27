import { useContext } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TripContext, TripProvider } from '../TripContext'
import { AuthContext } from '../AuthContext'
import type { AuthState } from '@/lib/types/user'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockTrips } from '@shared/lib/mocks/trips'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const demoDriver = mockDrivers[0]

const activeTrip = mockTrips.find(
  (t) => t.driver?.id === demoDriver.id && !['closed', 'cancelled'].includes(t.status),
)
if (!activeTrip) throw new Error('Fixture drift: mockDrivers[0] has no active mock trip')

const authValue: AuthState = {
  user: demoDriver,
  isLoading: false,
  connectionFault: false,
  retryProfile: vi.fn(),
  requestOtp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}

const openPhase = activeTrip.phases.find((p) => p.status === 'pending' || p.status === 'in_progress')
if (!openPhase) throw new Error('Fixture drift: mockDrivers[0]\'s active trip has no open phase')

if (activeTrip.trailers.length < 2) throw new Error('Fixture drift: mockDrivers[0]\'s active trip is not an interlink')
const namedTrailer = activeTrip.trailers[activeTrip.trailers.length - 1]

function Probe() {
  const ctx = useContext(TripContext)
  if (!ctx) return null
  const last = ctx.exceptions[ctx.exceptions.length - 1]
  return (
    <div>
      <span data-testid="trip-loaded">{ctx.trip ? 'yes' : 'no'}</span>
      <span data-testid="exception-count">{ctx.exceptions.length}</span>
      <span data-testid="last-gps">{last ? JSON.stringify([last.gps_lat, last.gps_lng]) : ''}</span>
      <span data-testid="last-vehicle">{last ? JSON.stringify(last.vehicle_id) : ''}</span>
      <span data-testid="open-phase-status">
        {ctx.trip?.phases.find((p) => p.phase_event_id === openPhase!.phase_event_id)?.status ?? ''}
      </span>
      <span data-testid="syncing-ids">{ctx.syncingPhaseIds.join(',')}</span>
      <button onClick={() => ctx.markPhaseSyncing(openPhase!.phase_event_id)}>mark-syncing</button>
      <button onClick={() => ctx.clearPhaseSyncing(openPhase!.phase_event_id)}>clear-syncing</button>
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
          ctx.logException('mechanical', { description: 'Warning light on the dash.', vehicleType: 'horse' })
        }
      >
        log-truck-breakdown
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

  it('demo logException records the named trailer as the breakdown vehicle', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-trailer-breakdown'))
    })

    expect(screen.getByTestId('last-vehicle')).toHaveTextContent(JSON.stringify(namedTrailer.id))
  })

  it('demo logException records the truck when the driver answers Truck', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-truck-breakdown'))
    })

    expect(screen.getByTestId('last-vehicle')).toHaveTextContent(JSON.stringify(activeTrip.horse?.id ?? null))
  })

  it('demo logException records no vehicle for a report that is not a breakdown', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('log-exception'))
    })

    expect(screen.getByTestId('last-vehicle')).toHaveTextContent(JSON.stringify(null))
  })
})

describe('TripContext optimistic phase advance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a marked phase as resolved without touching the server plan, and reports it as syncing', async () => {
    await renderAndWaitForTrip()
    expect(screen.getByTestId('open-phase-status')).toHaveTextContent(openPhase.status)

    await act(async () => {
      fireEvent.click(screen.getByText('mark-syncing'))
    })

    expect(screen.getByTestId('open-phase-status')).toHaveTextContent('completed')
    expect(screen.getByTestId('syncing-ids')).toHaveTextContent(openPhase.phase_event_id)
  })

  it('rolls the advance back when the marker is cleared without a server answer having landed', async () => {
    await renderAndWaitForTrip()

    await act(async () => {
      fireEvent.click(screen.getByText('mark-syncing'))
    })
    expect(screen.getByTestId('open-phase-status')).toHaveTextContent('completed')

    await act(async () => {
      fireEvent.click(screen.getByText('clear-syncing'))
    })

    expect(screen.getByTestId('open-phase-status')).toHaveTextContent(openPhase.status)
    expect(screen.getByTestId('syncing-ids')).toHaveTextContent('')
  })
})
