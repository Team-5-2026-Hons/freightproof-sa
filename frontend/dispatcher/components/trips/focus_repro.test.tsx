import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripDetailPanel } from './TripDetailPanel'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const trip = mockTrips[0]!

describe('focus repro', () => {
  it('shows where focus lands after closing the precinct modal', async () => {
    render(
      <ToastProvider>
        <TripDetailPanel panel="information" trip={trip} precincts={mockPrecincts} filter="needs_review"
          overlayOpen onSelect={vi.fn()} onClose={vi.fn()} onFilter={vi.fn()} onChanged={vi.fn()} returnTo="/trips/trip-1" />
      </ToastProvider>,
    )
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)
    const button = screen.getByRole('button', { name: new RegExp(label) })

    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    console.log('ACTIVE ELEMENT TAG:', document.activeElement?.tagName)
    console.log('ACTIVE ELEMENT ROLE:', document.activeElement?.getAttribute('role'))
    console.log('ACTIVE ELEMENT TEXT:', document.activeElement?.textContent?.slice(0, 60))
    console.log('IS SAME AS BUTTON:', document.activeElement === button)
  })
})
