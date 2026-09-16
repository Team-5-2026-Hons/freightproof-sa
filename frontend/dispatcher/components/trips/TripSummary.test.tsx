import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripSummary } from './TripSummary'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { tripHeaderFacts } from '@/lib/phase/trip-detail'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockDrivers } from '@shared/lib/mocks/drivers'

// ForensicControls reaches useAuth, which throws outside an AuthProvider. Mocked the same
// way Sidebar.test.tsx does, rather than wrapping every render in a real provider tree.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1', organization_id: 'org-1', email: 'jane@freightproof.test',
      full_name: 'Jane Dispatcher', is_active: true, role: 'dispatcher',
    },
    isLoading: false,
  }),
}))

const trip = mockTrips[0]!
const facts = tripHeaderFacts(trip, null)!

function renderSummary() {
  return render(
    <ForensicModeProvider>
      <TripSummary
        facts={facts}
        precincts={mockPrecincts}
        driver={mockDrivers[0]!}
        returnTo="/trips/trip-1"
        onBack={vi.fn()}
        onPanel={vi.fn()}
      />
    </ForensicModeProvider>,
  )
}

describe('TripSummary vehicle and driver previews', () => {
  it('opens a vehicle preview instead of navigating away when the horse is clicked', async () => {
    renderSummary()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(trip.horse!.registration) }))

    expect(screen.getByRole('heading', { name: trip.horse!.registration })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View vehicle' })).toHaveAttribute(
      'href', `/fleet/vehicles/${trip.horse!.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })

  it('opens the matching preview for a trailer, not the horse, when a trailer is clicked', async () => {
    renderSummary()
    const trailer = trip.trailers[0]!

    await userEvent.click(screen.getByRole('button', { name: new RegExp(trailer.registration) }))

    expect(screen.getByRole('link', { name: 'View vehicle' })).toHaveAttribute(
      'href', `/fleet/vehicles/${trailer.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })

  it('opens a driver preview that can hand off to the driver record', async () => {
    renderSummary()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(facts.driverName) }))

    expect(screen.getByRole('link', { name: 'View driver' })).toHaveAttribute(
      'href', `/fleet/drivers/${mockDrivers[0]!.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })
})
