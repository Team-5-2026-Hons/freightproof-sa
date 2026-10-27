// frontend/driver-pwa/app/(app)/trips/[id]/__tests__/TripDetailPageClient.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TripDetailPageClient from '../TripDetailPageClient'
import { TRIP_0035_ID } from '@shared/lib/mocks/trips'

const mockPush = vi.fn()
let mockId = String(TRIP_0035_ID)

vi.mock('@/components/layout/BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('@/lib/hooks/useMyTrips', () => ({ useMyTrips: () => ({ trips: [], isLoading: false, loadError: null, reload: () => {} }) }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockId }),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

describe('trips/[id] TripDetailPageClient (mock trip detail)', () => {
  it('renders the matching mock trip and lists its phases', () => {
    mockId = String(TRIP_0035_ID)

    render(<TripDetailPageClient />)

    expect(screen.getByText('TRP-2026-0035')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Trip phases' })).toBeInTheDocument()
  })

  it('shows "Trip not found" for an id with no matching mock trip', () => {
    mockId = 'no-such-trip'

    render(<TripDetailPageClient />)

    expect(screen.getByText('Trip not found.')).toBeInTheDocument()
  })
})
