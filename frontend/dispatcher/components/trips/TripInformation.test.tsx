import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripInformation } from './TripInformation'
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

function renderInformation(onOpenPrecinct = vi.fn()) {
  render(
    <ToastProvider>
      <TripInformation trip={trip} precincts={mockPrecincts} onChanged={vi.fn()} onOpenPrecinct={onOpenPrecinct} />
    </ToastProvider>,
  )
  return onOpenPrecinct
}

describe('TripInformation stop previews', () => {
  it('hands the clicked stop\'s precinct to the caller rather than opening its own modal', async () => {
    // The preview must not be TripInformation's own <dialog> — it can render inside
    // DetailPanel's overlay <dialog> below the dock width, and a modal nested inside
    // another open modal centers on the wrong box. The caller owns where it renders.
    const onOpenPrecinct = renderInformation()
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    expect(onOpenPrecinct).toHaveBeenCalledWith(precinct)
    expect(screen.queryByRole('link', { name: 'View precinct' })).not.toBeInTheDocument()
  })
})
