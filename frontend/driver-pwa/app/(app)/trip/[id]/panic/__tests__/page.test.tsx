// frontend/driver-pwa/app/(app)/trip/[id]/panic/__tests__/page.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PanicPage from '../page'

// `trip` is provided to PanicPage via useTrip() (session-derived), independent
// of the URL's tripId param — these tests verify the page-level guard that
// catches a mismatch between the two before the panic action is reachable.
const mockUseParams = vi.fn()
const mockUseTrip = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ back: mockRouterBack, replace: mockRouterReplace, push: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: () => ({
    coords: null,
    status: 'idle',
    capture: vi.fn().mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 }),
  }),
}))

describe('PanicPage trip-mismatch guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an unavailable state and no hold button when trip is null', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: null, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders an unavailable state and no hold button when trip.id does not match the URL tripId', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-999' }, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders the normal panic UI with the hold button when trip.id matches the URL tripId', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.queryByText(/unable to verify trip/i)).not.toBeInTheDocument()
    expect(screen.getByText(/send panic/i)).toBeInTheDocument()
  })
})
