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

function setup() {
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
  return { button }
}

function report(button: HTMLElement, via: string) {
  console.log(`--- via ${via} ---`)
  console.log('ACTIVE TAG:', document.activeElement?.tagName, 'ROLE:', document.activeElement?.getAttribute('role'), 'TEXT:', document.activeElement?.textContent?.slice(0, 40))
  console.log('IS SAME AS BUTTON:', document.activeElement === button)
  console.log('DIALOGS REMAINING IN DOM:', document.querySelectorAll('dialog').length)
}

describe('focus repro via different close paths', () => {
  it('via X icon', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Close modal' }))
    report(button, 'X icon')
  })

  it('via Escape key', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    report(button, 'Escape')
  })

  it('via backdrop click', async () => {
    const { button } = setup()
    await userEvent.click(button)
    const dialog = document.querySelector('dialog')!
    await userEvent.click(dialog)
    report(button, 'backdrop click')
  })
})
