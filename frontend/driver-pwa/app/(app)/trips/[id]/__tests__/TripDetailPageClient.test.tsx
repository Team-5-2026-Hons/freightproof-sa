// frontend/driver-pwa/app/(app)/trips/[id]/__tests__/TripDetailPageClient.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TripDetailPageClient from '../TripDetailPageClient'
import { TRIP_0035_ID } from '@shared/lib/mocks/trips'

const mockPush = vi.fn()
// Reassigned per-test so both the found and not-found id branches can be exercised.
let mockId = String(TRIP_0035_ID)

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockId }),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

// Fix 5: this page is now a thin wrapper over the shared TripDetailView — these tests
// only need to prove it sources mock data by id and passes showAllHandshakes=true
// (the mock trip-detail screen's distinguishing behavior); TripDetailView's own
// rendering logic is covered by components/trip/__tests__/TripDetailView.test.tsx.
describe('trips/[id] TripDetailPageClient (mock trip detail)', () => {
  it('renders the matching mock trip and lists all five handshakes', () => {
    mockId = String(TRIP_0035_ID)

    render(<TripDetailPageClient />)

    expect(screen.getByRole('heading', { name: 'TRP-2026-0035' })).toBeInTheDocument()
    expect(screen.getByText('Handshakes')).toBeInTheDocument()
  })

  it('shows "Trip not found" for an id with no matching mock trip', () => {
    mockId = 'no-such-trip'

    render(<TripDetailPageClient />)

    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })
})
