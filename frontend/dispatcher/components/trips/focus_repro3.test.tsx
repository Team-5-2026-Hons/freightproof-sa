import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
const realMatchMedia = window.matchMedia

beforeEach(() => {
  // Simulate the DOCKED desktop layout — >=1280px — matching the user's screenshot,
  // where DetailPanel renders the permanent <aside>, not its own overlay <dialog>.
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { window.matchMedia = realMatchMedia })

function setup() {
  render(
    <ToastProvider>
      <TripDetailPanel panel="information" trip={trip} precincts={mockPrecincts} filter="needs_review"
        overlayOpen={false} onSelect={vi.fn()} onClose={vi.fn()} onFilter={vi.fn()} onChanged={vi.fn()} returnTo="/trips/trip-1" />
    </ToastProvider>,
  )
  const stop = trip.stops[0]!
  const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
  const label = precinctLabel(precinct)
  const button = screen.getByRole('button', { name: new RegExp(label) })
  return { button }
}

function report(button: HTMLElement, via: string) {
  console.log(`--- via ${via} (docked) ---`)
  console.log('ACTIVE TAG:', document.activeElement?.tagName, 'ROLE:', document.activeElement?.getAttribute('role'), 'TEXT:', document.activeElement?.textContent?.slice(0, 40))
  console.log('IS SAME AS BUTTON:', document.activeElement === button)
  console.log('DIALOGS REMAINING IN DOM:', document.querySelectorAll('dialog').length)
  console.log('TABPANEL EL:', document.querySelector('[role="tabpanel"]'))
  console.log('IS TABPANEL FOCUSED:', document.activeElement === document.querySelector('[role="tabpanel"]'))
}

describe('focus repro, docked layout', () => {
  it('via X icon', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Close modal' }))
    report(button, 'X icon')
  })

  it('via Close button', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    report(button, 'Close button')
  })
})
