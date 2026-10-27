// frontend/driver-pwa/components/trip/__tests__/DriverSubstitutionPanel.test.tsx
//
// FP-83 T1: what a driver must not miss — a pending arrangement (even with no current trip),
// unread notices, and the trip they just handed over. Dismissing a notice only hides it once
// the server agrees; opening a completed one lets the trip page ask the server who holds it.
// Shown in a bottom sheet that opens itself once per unseen item and stays one tap away.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  noticeFixtures,
  substitutionFixturePack as pack,
} from '@shared/lib/mocks/driver-substitutions'
import type { DriverSubstitutionState } from '@/lib/context/DriverSubstitutionContext'
import { TripContext, type TripState } from '@/lib/context/TripContext'
import { ToastContext, type ToastState } from '@/lib/context/ToastContext'
import { DriverSubstitutionPanel } from '../DriverSubstitutionPanel'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, back: vi.fn() }) }))

const incomingPending = pack.incomingPendingNoActiveTrip.pending[0]
let mockUserId: string | null = incomingPending.incoming.id
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUserId === null ? null : { id: mockUserId } }),
}))

let mockState: DriverSubstitutionState
vi.mock('@/lib/hooks/useDriverSubstitutions', () => ({ useDriverSubstitutions: () => mockState }))

const mockFetchContext = vi.fn()
vi.mock('@/lib/api/driver-substitutions', () => ({
  fetchDriverSubstitutionContext: (...args: unknown[]) => mockFetchContext(...args),
}))

function state(over: Partial<DriverSubstitutionState>): DriverSubstitutionState {
  return {
    pending: [],
    notices: [],
    isLoading: false,
    loadError: null,
    lastRefreshedAt: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    markNoticeRead: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function renderPanel(trip: Partial<TripState> = {}, toast?: ToastState) {
  const tripValue = { handedOverTripId: null, dismissHandedOver: vi.fn(), ...trip } as unknown as TripState
  return render(
    <ToastContext.Provider value={toast ?? null}>
      <TripContext.Provider value={tripValue}>
        <DriverSubstitutionPanel />
      </TripContext.Provider>
    </ToastContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  mockUserId = incomingPending.incoming.id
  mockState = state({})
})

function sheet(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

function expectSheetOpen(isOpen: boolean) {
  const dialog = sheet()
  expect(dialog).not.toBeNull()
  if (isOpen) expect(dialog).toHaveAttribute('aria-modal', 'true')
  else expect(dialog).not.toHaveAttribute('aria-modal')
}

describe('DriverSubstitutionPanel', () => {
  it('test_renders_nothing_without_handovers', () => {
    const { container } = renderPanel()

    expect(container).toBeEmptyDOMElement()
  })

  it('test_incoming_assignment_shows_with_no_current_trip', () => {
    mockState = state({ pending: [incomingPending] })

    renderPanel({ trip: null })

    expectSheetOpen(true)
    expect(screen.getByRole('dialog', { name: 'Driver handover' })).toBeInTheDocument()
    expect(screen.getByText('Collect this trip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Driver handover/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('test_sheet_summary_names_the_trip_on_the_compact_row', () => {
    mockState = state({ pending: [incomingPending] })

    renderPanel()

    expect(screen.getByRole('button', { name: `Driver handover Collect ${incomingPending.trip_reference}` })).toBeInTheDocument()
  })

  it('test_closing_the_sheet_keeps_the_compact_row', () => {
    mockState = state({ pending: [incomingPending] })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))

    expectSheetOpen(false)
    const row = screen.getByRole('button', { name: /Driver handover/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(row)
    expectSheetOpen(true)
  })

  it('test_sheet_does_not_reopen_for_items_already_shown_this_session', () => {
    mockState = state({ pending: [incomingPending] })
    const first = renderPanel()
    expectSheetOpen(true)
    first.unmount()

    renderPanel()

    expectSheetOpen(false)
    expect(screen.getByRole('button', { name: /Driver handover/ })).toBeInTheDocument()
  })

  it('test_a_changed_or_new_arrangement_reopens_the_sheet', () => {
    mockState = state({ pending: [incomingPending] })
    const first = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expectSheetOpen(false)
    first.unmount()

    mockState = state({ pending: [{ ...incomingPending, version: incomingPending.version + 1 }] })
    renderPanel()

    expectSheetOpen(true)
  })

  it('test_sheet_never_locks_the_page_scroll', () => {
    mockState = state({ pending: [incomingPending] })

    renderPanel()

    expectSheetOpen(true)
    expect(document.body.style.overflow).toBe('')
  })

  it('test_arrangement_not_naming_this_driver_is_not_shown', () => {
    mockUserId = crypto.randomUUID()
    mockState = state({ pending: [{ ...incomingPending, permitted_actions: [] }] })

    const { container } = renderPanel()

    expect(container).toBeEmptyDOMElement()
  })

  it('test_completed_notice_opens_the_trip_for_the_server_to_resolve', () => {
    mockState = state({ notices: [{ ...noticeFixtures.completedRead, read_at: null }] })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Open trip' }))

    expect(mockPush).toHaveBeenCalledWith(`/trips/detail?id=${noticeFixtures.completedRead.trip_id}`)
  })

  it('test_cancelled_notice_loads_only_the_arrangement_snapshot', async () => {
    mockState = state({ notices: [noticeFixtures.cancelledUnread] })
    mockFetchContext.mockResolvedValue({ ...pack.contextWithFindings, ...pack.cancelled })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'View arrangement' }))

    expect(await screen.findByText('Handover cancelled')).toBeInTheDocument()
    expect(mockFetchContext).toHaveBeenCalledWith(noticeFixtures.cancelledUnread.trip_id, noticeFixtures.cancelledUnread.request_id)
    expect(screen.queryByRole('button', { name: 'Trip details' })).not.toBeInTheDocument()
  })

  it('test_dismiss_marks_the_notice_read', async () => {
    const markNoticeRead = vi.fn().mockResolvedValue(undefined)
    mockState = state({ notices: [noticeFixtures.arrangedUnread], markNoticeRead })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(markNoticeRead).toHaveBeenCalledWith(noticeFixtures.arrangedUnread.id))
  })

  it('test_failed_dismiss_tells_the_driver', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn()
    mockState = state({ notices: [noticeFixtures.arrangedUnread], markNoticeRead: vi.fn().mockRejectedValue(new Error('offline')) })
    renderPanel({}, { toasts: [], notify, dismiss: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })))
  })

  it('test_handed_over_trip_offers_the_drivers_record', () => {
    const handedOver = crypto.randomUUID()
    renderPanel({ handedOverTripId: handedOver })

    expect(screen.getByText('You handed over this trip')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View your record' }))

    expect(mockPush).toHaveBeenCalledWith(`/trips/detail?id=${handedOver}`)
  })
})
