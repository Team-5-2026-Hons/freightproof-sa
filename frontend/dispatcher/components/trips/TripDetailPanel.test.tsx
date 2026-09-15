import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TripDetailPanel } from './TripDetailPanel'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'
import { cancelTrip } from '@/lib/api/client'

// CancelTripDialog's cancelTrip call reaches the API client, which builds a Supabase
// client at import time — same reason TripExceptionsPanel.test.tsx mocks this module.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Isolate from the real HTTP layer — the dialog must never call this during a dismissal.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, cancelTrip: vi.fn() }
})

const mockedCancelTrip = vi.mocked(cancelTrip)

const trip = mockTrips[0]!
// mockTrips[0] is a closed trip (TRP-2026-0035), so its own "Cancel trip" trigger is
// correctly hidden — the cancellation-dialog tests below need a still-cancellable trip,
// with the same stops/precincts fixture data, to exercise the trigger and dialog.
const activeTrip = { ...trip, status: 'active' as const }

function renderPanel(onChanged = vi.fn(), tripOverride = trip) {
  return { onChanged, ...render(
    <ToastProvider>
      <TripDetailPanel
        panel="information"
        trip={tripOverride}
        precincts={mockPrecincts}
        filter="needs_review"
        overlayOpen
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onFilter={vi.fn()}
        onChanged={onChanged}
        returnTo="/trips/trip-1"
      />
    </ToastProvider>,
  ) }
}

beforeEach(() => {
  mockedCancelTrip.mockReset()
})

describe('TripDetailPanel precinct preview placement', () => {
  it('opens the precinct preview as a sibling of the overlay, not nested inside its dialog', async () => {
    // vitest.setup.ts defaults matchMedia to non-matching, which is the below-dock-width
    // path where DetailPanel wraps its children in its own <dialog> — the exact
    // condition that made a nested PrecinctModal centre on the wrong box.
    renderPanel()
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    const overlayDialog = screen.getByRole('dialog', { name: 'Trip information' })
    const precinctDialog = screen.getByRole('dialog', { name: label })
    expect(overlayDialog.contains(precinctDialog)).toBe(false)
    expect(screen.getByRole('link', { name: 'View precinct' })).toHaveAttribute(
      'href', `/precincts/${precinct.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })
})

describe('TripDetailPanel cancellation dialog placement', () => {
  it('opens the cancellation dialog as a sibling of the overlay, not nested inside its dialog', async () => {
    // Same defect as the precinct preview above: below the dock width DetailPanel wraps
    // its children in its own <dialog>, and CancelTripAction's old uncontrolled Modal
    // nested inside that open overlay centred on the ancestor's box, not the viewport.
    renderPanel(vi.fn(), activeTrip)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    const overlayDialog = screen.getByRole('dialog', { name: 'Trip information' })
    const cancelDialog = screen.getByRole('dialog', { name: 'Cancel this trip?' })
    expect(overlayDialog.contains(cancelDialog)).toBe(false)
  })

  it('dismisses via "Keep trip active" without calling onChanged or the API, and returns focus to the trigger', async () => {
    const { onChanged } = renderPanel(vi.fn(), activeTrip)

    const trigger = screen.getByRole('button', { name: 'Cancel trip' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Keep trip active' }))

    expect(screen.queryByRole('dialog', { name: 'Cancel this trip?' })).not.toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    expect(mockedCancelTrip).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
