// frontend/driver-pwa/lib/context/__tests__/TripContext.handover.test.tsx
//
// FP-83 T1: a pinned trip the driver has since handed over must stop being their working
// context. The server's coded TRIP_HANDED_OVER answer clears the pin, remembers which trip
// it was (so a screen can offer the history), and falls back to the server's own pick —
// without signing the driver out and without treating it like a 404 "never yours".
import { useContext } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { substitutionErrorFixtures } from '@shared/lib/mocks/driver-substitutions'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import type { AuthState } from '@/lib/types/user'
import { ApiError } from '@/lib/api/client'
import { AuthContext } from '../AuthContext'
import { TripContext, TripProvider } from '../TripContext'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const mockFetchMyActiveTrip = vi.fn()
const mockFetchMyTrip = vi.fn()
vi.mock('@/lib/api/trips', () => ({
  fetchMyActiveTrip: (...args: unknown[]) => mockFetchMyActiveTrip(...args),
  fetchMyTrip: (...args: unknown[]) => mockFetchMyTrip(...args),
}))

const SELECTED_TRIP_KEY = 'fp.selectedTripId'

const driver = mockDrivers[0]
const authValue: AuthState = { user: driver, isLoading: false, requestOtp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }

// Two distinct real-shaped trips: the one handed over, and whatever the server says is next.
const [handedOverTrip, nextTrip] = mockTrips.filter((t) => !['closed', 'cancelled'].includes(t.status))
if (handedOverTrip === undefined || nextTrip === undefined) throw new Error('Fixture drift: need two open mock trips')

function handedOverError(): ApiError {
  const fixture = substitutionErrorFixtures.TRIP_HANDED_OVER
  return new ApiError(fixture.http_status, fixture.body.detail.message, undefined, {
    code: fixture.body.detail.code,
    requestId: null,
    currentVersion: null,
    evidenceId: null,
  })
}

let ctx: React.ContextType<typeof TripContext> = null

function Probe() {
  ctx = useContext(TripContext)
  return (
    <div>
      <p data-testid="trip">{ctx?.trip?.id ?? 'none'}</p>
      <p data-testid="handed-over">{ctx?.handedOverTripId ?? 'none'}</p>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthContext.Provider value={authValue}>
      <TripProvider>
        <Probe />
      </TripProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  ctx = null
})

describe('TripContext handover handling', () => {
  it('drops old custody optimistic markers and an old clear cannot remove a new period marker', async () => {
    const access = { participation: 'current' as const, custody_sequence: 0, can_advance: true, can_submit_late_evidence: false }
    const original = { ...handedOverTrip, custody_sequence: 0, driver_access: access }
    const phase = original.phases.find(p => p.status === 'pending' || p.status === 'in_progress')
    if (!phase) throw new Error('Fixture needs an unresolved phase')
    mockFetchMyActiveTrip.mockResolvedValue(original)
    renderProvider()
    await waitFor(() => expect(ctx?.trip?.id).toBe(original.id))
    act(() => ctx?.markPhaseSyncing(phase.phase_event_id))
    const oldClear = ctx!.clearPhaseSyncing
    expect(ctx?.syncingPhaseIds).toEqual([phase.phase_event_id])

    act(() => ctx?.adoptTrip({ ...original, custody_sequence: 2, driver_access: { ...access, custody_sequence: 2 } }))

    expect(ctx?.syncingPhaseIds).toEqual([])
    expect(ctx?.trip?.phases.find(p => p.phase_event_id === phase.phase_event_id)?.status).toBe(phase.status)
    act(() => ctx?.markPhaseSyncing(phase.phase_event_id))
    act(() => oldClear(phase.phase_event_id))
    expect(ctx?.syncingPhaseIds).toEqual([phase.phase_event_id])
  })

  it.each(['success', 'failure'] as const)('keeps the new account trip after an old mount request %s', async outcome => {
    bindActorLease(String(driver.id), invalidateActorLease())
    let complete!: () => void
    const oldTrip = new Promise<Trip>((resolve, reject) => {
      complete = () => outcome === 'success' ? resolve(handedOverTrip) : reject(new Error('old trip failed'))
    })
    mockFetchMyActiveTrip.mockReturnValueOnce(oldTrip).mockResolvedValue(nextTrip)
    const tree = (user: AuthState['user']) => (
      <AuthContext.Provider value={{ ...authValue, user }}><TripProvider><Probe /></TripProvider></AuthContext.Provider>
    )
    const view = render(tree(driver))
    await waitFor(() => expect(mockFetchMyActiveTrip).toHaveBeenCalledTimes(1))
    const other = { ...driver, id: crypto.randomUUID() as typeof driver.id }
    bindActorLease(String(other.id), invalidateActorLease())
    view.rerender(tree(other))
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id)))

    await act(async () => { complete(); await Promise.resolve() })

    expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id))
  })

  it('test_handed_over_pin_is_cleared_and_server_pick_loads', async () => {
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(handedOverTrip.id))
    mockFetchMyTrip.mockRejectedValue(handedOverError())
    mockFetchMyActiveTrip.mockResolvedValue(nextTrip)

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id)))
    expect(screen.getByTestId('handed-over')).toHaveTextContent(String(handedOverTrip.id))
    expect(window.sessionStorage.getItem(SELECTED_TRIP_KEY)).toBeNull()
    expect(authValue.signOut).not.toHaveBeenCalled()
  })

  it('test_handed_over_with_no_next_trip_leaves_no_working_trip', async () => {
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(handedOverTrip.id))
    mockFetchMyTrip.mockRejectedValue(handedOverError())
    mockFetchMyActiveTrip.mockResolvedValue(null)

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('handed-over')).toHaveTextContent(String(handedOverTrip.id)))
    expect(screen.getByTestId('trip')).toHaveTextContent('none')
  })

  it('test_an_uncoded_409_keeps_the_pin', async () => {
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(handedOverTrip.id))
    mockFetchMyTrip.mockRejectedValue(new ApiError(409, 'Some other conflict'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderProvider()

    // Transient-or-unknown failures must never strip a mid-journey selection.
    await waitFor(() => expect(mockFetchMyTrip).toHaveBeenCalled())
    expect(window.sessionStorage.getItem(SELECTED_TRIP_KEY)).toBe(String(handedOverTrip.id))
    expect(screen.getByTestId('handed-over')).toHaveTextContent('none')
  })

  it('test_note_handed_over_drops_an_unpinned_working_trip_and_refreshes', async () => {
    mockFetchMyActiveTrip.mockResolvedValueOnce(handedOverTrip).mockResolvedValue(nextTrip)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(handedOverTrip.id)))

    act(() => ctx?.noteTripHandedOver(String(handedOverTrip.id)))

    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id)))
    expect(screen.getByTestId('handed-over')).toHaveTextContent(String(handedOverTrip.id))
  })

  it('test_note_handed_over_for_another_trip_leaves_current_work_alone', async () => {
    mockFetchMyActiveTrip.mockResolvedValue(nextTrip as Trip)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id)))
    const callsBefore = mockFetchMyActiveTrip.mock.calls.length

    act(() => ctx?.noteTripHandedOver(String(handedOverTrip.id)))

    expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id))
    expect(mockFetchMyActiveTrip.mock.calls.length).toBe(callsBefore)
  })

  it('test_dismiss_clears_only_the_reminder', async () => {
    window.sessionStorage.setItem(SELECTED_TRIP_KEY, String(handedOverTrip.id))
    mockFetchMyTrip.mockRejectedValue(handedOverError())
    mockFetchMyActiveTrip.mockResolvedValue(nextTrip)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('handed-over')).toHaveTextContent(String(handedOverTrip.id)))

    act(() => ctx?.dismissHandedOver())

    expect(screen.getByTestId('handed-over')).toHaveTextContent('none')
    expect(screen.getByTestId('trip')).toHaveTextContent(String(nextTrip.id))
  })
})
