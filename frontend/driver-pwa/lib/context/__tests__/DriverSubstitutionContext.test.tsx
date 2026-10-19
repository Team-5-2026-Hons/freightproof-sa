// frontend/driver-pwa/lib/context/__tests__/DriverSubstitutionContext.test.tsx
//
// FP-83 T1: the substitution resource is loaded independently of the current trip, so an
// incoming driver with no trip still learns of a collection; a completed handover drops the
// outgoing driver's working trip; and refresh failures never blank what already loaded.
// Built on Ciaran's shared fixture pack — no locally invented response shapes.
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  noticeFixtures,
  substitutionFixturePack as pack,
} from '@shared/lib/mocks/driver-substitutions'
import type { SubstitutionNoticeRead } from '@shared/lib/types/driver-substitution'
import { mockDrivers } from '@shared/lib/mocks/drivers'
import type { AuthState, DriverUser } from '@/lib/types/user'
import { AuthContext } from '../AuthContext'
import { TripContext, type TripState } from '../TripContext'
import { DriverSubstitutionProvider } from '../DriverSubstitutionContext'
import { useDriverSubstitutions } from '@/lib/hooks/useDriverSubstitutions'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockFetchPending = vi.fn()
const mockFetchNotices = vi.fn()
const mockMarkRead = vi.fn()
vi.mock('@/lib/api/driver-substitutions', () => ({
  fetchDriverSubstitutions: (...args: unknown[]) => mockFetchPending(...args),
  fetchSubstitutionNotices: (...args: unknown[]) => mockFetchNotices(...args),
  markSubstitutionNoticeRead: (...args: unknown[]) => mockMarkRead(...args),
}))

const incomingPending = pack.incomingPendingNoActiveTrip.pending[0]
const OUTGOING_ID = incomingPending.outgoing.id
const INCOMING_ID = incomingPending.incoming.id

// A real driver record with the fixture's id, so the provider resolves the same role the
// server would for that account.
function driverWithId(id: string): DriverUser {
  return { ...mockDrivers[0], id: id as DriverUser['id'] }
}

function authFor(user: DriverUser | null): AuthState {
  return { user, isLoading: false, requestOtp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
}

const unreadCompleted: SubstitutionNoticeRead = { ...noticeFixtures.completedRead, read_at: null }

function Probe() {
  const { pending, notices, loadError, isLoading, markNoticeRead } = useDriverSubstitutions()
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="pending">{pending.map((r) => r.id).join(',')}</p>
      <p data-testid="notices">{notices.map((n) => `${n.kind}:${n.id}`).join(',')}</p>
      <p data-testid="error">{loadError ?? ''}</p>
      <button type="button" onClick={() => void markNoticeRead(notices[0].id).catch(() => undefined)}>read first</button>
    </div>
  )
}

interface Harness {
  noteTripHandedOver: ReturnType<typeof vi.fn>
  refreshQuietly: ReturnType<typeof vi.fn>
  rerender: (user: DriverUser | null) => void
}

function renderProvider(user: DriverUser | null, tripValue: Partial<TripState> = { trip: null }): Harness {
  const noteTripHandedOver = vi.fn()
  const refreshQuietly = vi.fn().mockResolvedValue(undefined)
  // Only the members the provider reads; the rest of TripState is irrelevant here.
  const trip = { ...tripValue, noteTripHandedOver, refreshQuietly } as unknown as TripState
  const tree = (u: DriverUser | null) => (
    <AuthContext.Provider value={authFor(u)}>
      <TripContext.Provider value={trip}>
        <DriverSubstitutionProvider>
          <Probe />
        </DriverSubstitutionProvider>
      </TripContext.Provider>
    </AuthContext.Provider>
  )
  const { rerender } = render(tree(user))
  return { noteTripHandedOver, refreshQuietly, rerender: (u) => rerender(tree(u)) }
}

async function reconnect(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  mockFetchPending.mockResolvedValue([])
  mockFetchNotices.mockResolvedValue([])
  mockMarkRead.mockImplementation((id: string) => Promise.resolve({ ...noticeFixtures.arrangedUnread, id }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DriverSubstitutionProvider', () => {
  it('test_incoming_assignment_loads_with_no_current_trip', async () => {
    mockFetchPending.mockResolvedValue([incomingPending])
    mockFetchNotices.mockResolvedValue([noticeFixtures.arrangedUnread])

    renderProvider(driverWithId(INCOMING_ID), { trip: null })

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id))
    expect(screen.getByTestId('notices')).toHaveTextContent(`arranged:${noticeFixtures.arrangedUnread.id}`)
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('test_current_work_and_pending_incoming_are_kept_separate', async () => {
    mockFetchPending.mockResolvedValue([incomingPending])
    const currentTrip = { id: crypto.randomUUID() } as unknown as TripState['trip']

    const harness = renderProvider(driverWithId(INCOMING_ID), { trip: currentTrip })

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id))
    // An arrangement is not a transfer: the current trip context is left untouched.
    expect(harness.noteTripHandedOver).not.toHaveBeenCalled()
    expect(harness.refreshQuietly).not.toHaveBeenCalled()
  })

  it('test_outgoing_driver_sees_their_pending_handover', async () => {
    mockFetchPending.mockResolvedValue([pack.outgoingPending])

    renderProvider(driverWithId(OUTGOING_ID))

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(pack.outgoingPending.id))
  })

  it('test_cancellation_notice_is_listed_for_the_driver', async () => {
    mockFetchNotices.mockResolvedValue([noticeFixtures.cancelledUnread])

    renderProvider(driverWithId(INCOMING_ID))

    await waitFor(() => expect(screen.getByTestId('notices')).toHaveTextContent(`cancelled:${noticeFixtures.cancelledUnread.id}`))
  })

  it('test_outgoing_completion_drops_the_working_trip_once', async () => {
    mockFetchPending.mockResolvedValueOnce([pack.outgoingPending]).mockResolvedValue([])
    mockFetchNotices.mockResolvedValueOnce([]).mockResolvedValue([unreadCompleted])
    const harness = renderProvider(driverWithId(OUTGOING_ID))
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(pack.outgoingPending.id))

    await reconnect()
    await waitFor(() => expect(screen.getByTestId('notices')).toHaveTextContent(`completed:${unreadCompleted.id}`))
    await reconnect()

    expect(harness.noteTripHandedOver).toHaveBeenCalledTimes(1)
    expect(harness.noteTripHandedOver).toHaveBeenCalledWith(unreadCompleted.trip_id)
  })

  it('test_completion_with_unknown_role_asks_the_server_via_trip_refresh', async () => {
    mockFetchNotices.mockResolvedValue([unreadCompleted])

    const harness = renderProvider(driverWithId(INCOMING_ID))

    await waitFor(() => expect(harness.refreshQuietly).toHaveBeenCalledTimes(1))
    expect(harness.noteTripHandedOver).not.toHaveBeenCalled()
  })

  it('test_failed_refresh_keeps_what_already_loaded', async () => {
    mockFetchPending.mockResolvedValueOnce([incomingPending]).mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderProvider(driverWithId(INCOMING_ID))
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id))

    await reconnect()

    await waitFor(() => expect(screen.getByTestId('error')).not.toHaveTextContent(''))
    expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id)
  })

  it('test_a_failed_notice_read_does_not_hide_loaded_arrangements', async () => {
    mockFetchPending.mockResolvedValue([incomingPending])
    mockFetchNotices.mockRejectedValue(new Error('500'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    renderProvider(driverWithId(INCOMING_ID))

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id))
    expect(screen.getByTestId('error')).not.toHaveTextContent('')
  })

  it('test_offline_mount_makes_no_requests', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)

    renderProvider(driverWithId(INCOMING_ID))
    await act(async () => { await Promise.resolve() })

    expect(mockFetchPending).not.toHaveBeenCalled()
    expect(mockFetchNotices).not.toHaveBeenCalled()
  })

  it('test_hidden_app_makes_no_requests', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    renderProvider(driverWithId(INCOMING_ID))
    await act(async () => { await Promise.resolve() })

    expect(mockFetchPending).not.toHaveBeenCalled()
  })

  it('test_mark_read_removes_the_notice_after_server_ack', async () => {
    mockFetchNotices.mockResolvedValueOnce([noticeFixtures.arrangedUnread])
    renderProvider(driverWithId(INCOMING_ID))
    await waitFor(() => expect(screen.getByTestId('notices')).toHaveTextContent('arranged'))

    await act(async () => { screen.getByRole('button', { name: 'read first' }).click() })

    expect(mockMarkRead).toHaveBeenCalledWith(noticeFixtures.arrangedUnread.id)
    await waitFor(() => expect(screen.getByTestId('notices')).toHaveTextContent(''))
  })

  it('test_failed_mark_read_keeps_the_notice_visible', async () => {
    mockFetchNotices.mockResolvedValueOnce([noticeFixtures.arrangedUnread])
    mockMarkRead.mockRejectedValue(new Error('offline'))
    renderProvider(driverWithId(INCOMING_ID))
    await waitFor(() => expect(screen.getByTestId('notices')).toHaveTextContent('arranged'))

    await act(async () => { screen.getByRole('button', { name: 'read first' }).click() })

    expect(screen.getByTestId('notices')).toHaveTextContent(`arranged:${noticeFixtures.arrangedUnread.id}`)
  })

  it('test_signing_out_clears_the_previous_drivers_arrangements', async () => {
    mockFetchPending.mockResolvedValue([incomingPending])
    const harness = renderProvider(driverWithId(INCOMING_ID))
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(incomingPending.id))

    harness.rerender(null)

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(''))
  })
})
