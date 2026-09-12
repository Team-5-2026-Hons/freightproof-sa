import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripDetailPanel } from './TripDetailPanel'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'

// CancelTripAction's cancelTrip call reaches the API client, which builds a Supabase
// client at import time — same reason TripExceptionsPanel.test.tsx mocks this module.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const trip = mockTrips[0]!

function renderPanel() {
  return render(
    <ToastProvider>
      <TripDetailPanel
        panel="information"
        trip={trip}
        precincts={mockPrecincts}
        filter="needs_review"
        overlayOpen
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onFilter={vi.fn()}
        onChanged={vi.fn()}
        returnTo="/trips/trip-1"
      />
    </ToastProvider>,
  )
}

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
