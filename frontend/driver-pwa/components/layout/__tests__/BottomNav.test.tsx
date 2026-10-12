import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BottomNav } from '../BottomNav'
import { ROUTES } from '@/lib/constants/routes'

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
let mockPathname: string = ROUTES.home

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => mockPathname,
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPathname = ROUTES.home
  mockUseTrip.mockReturnValue({ trip: null, exceptions: [] })
})

describe('BottomNav', () => {
  it('renders the three nav destinations with correct aria-labels', () => {
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trips' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('marks the item matching the current pathname as aria-current="page"', () => {
    mockPathname = '/trips/abc'
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Trips' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current')
  })

  it('shows no badge for an ordinary assigned trip — that is the normal state', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1', status: 'active' }, exceptions: [] })
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Trips' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /needs attention/i })).not.toBeInTheDocument()
  })

  it('badges Trips when the trip is on an exception hold', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1', status: 'exception_hold' }, exceptions: [] })
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Trips, needs attention' })).toBeInTheDocument()
  })

  it('badges Trips when the trip has an open driver-visible exception', () => {
    mockUseTrip.mockReturnValue({
      trip: { id: 'trip-1', status: 'active' },
      exceptions: [{ id: 'exc-1', review_status: 'needs_review', source: 'dispatcher' }],
    })
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Trips, needs attention' })).toBeInTheDocument()
  })

  it('shows a visible label under every destination icon', () => {
    render(<BottomNav onProfileClick={vi.fn()} />)

    for (const label of ['Home', 'Trips', 'Settings']) {
      expect(screen.getByText(label)).toBeVisible()
    }
  })

  it('calls onProfileClick when the profile button is tapped', () => {
    const onProfileClick = vi.fn()
    render(<BottomNav onProfileClick={onProfileClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open driver profile' }))

    expect(onProfileClick).toHaveBeenCalledTimes(1)
  })

  it('pushes the matching route when a nav item is tapped', () => {
    render(<BottomNav onProfileClick={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.settings)
  })
})
