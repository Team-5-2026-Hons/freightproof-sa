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

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'drv-1', full_name: 'Sipho Dlamini' } }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPathname = ROUTES.home
  mockUseTrip.mockReturnValue({ trip: null, exceptions: [] })
})

describe('BottomNav', () => {
  it('renders the three nav destinations with correct aria-labels', () => {
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trips' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
  })

  it('test_has_no_separate_profile_button_any_more', () => {
    render(<BottomNav />)

    expect(screen.queryByRole('button', { name: 'Open driver profile' })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('test_profile_tab_shows_the_driver_not_a_generic_icon', () => {
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Profile' })).toHaveTextContent('SD')
  })

  it('test_active_tab_is_ink_not_blue', () => {
    mockPathname = ROUTES.profile
    render(<BottomNav />)

    const active = screen.getByRole('button', { name: 'Profile' })

    expect(active).toHaveClass('text-surface-on')
    expect(active.className).not.toMatch(/secondary/)
  })

  it('marks the item matching the current pathname as aria-current="page"', () => {
    mockPathname = '/trips/abc'
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Trips' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Profile' })).not.toHaveAttribute('aria-current')
  })

  it('shows no badge for an ordinary assigned trip — that is the normal state', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1', status: 'active' }, exceptions: [] })
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /needs attention/i })).not.toBeInTheDocument()
  })

  it('badges Home, where the reason is shown, when the trip is on an exception hold', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1', status: 'exception_hold' }, exceptions: [] })
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Home, needs attention' })).toBeInTheDocument()
  })

  it('badges Home when the trip has an open driver-visible exception', () => {
    mockUseTrip.mockReturnValue({
      trip: { id: 'trip-1', status: 'active' },
      exceptions: [{ id: 'exc-1', review_status: 'needs_review', source: 'dispatcher', exception_type: 'escalation' }],
    })
    render(<BottomNav />)

    expect(screen.getByRole('button', { name: 'Home, needs attention' })).toBeInTheDocument()
  })

  it('does not badge for a dispatcher note — information, not a problem', () => {
    mockUseTrip.mockReturnValue({
      trip: { id: 'trip-1', status: 'active' },
      exceptions: [{ id: 'exc-1', review_status: 'needs_review', source: 'dispatcher', exception_type: 'dispatcher_note' }],
    })
    render(<BottomNav />)

    expect(screen.queryByRole('button', { name: /needs attention/i })).not.toBeInTheDocument()
  })

  it('shows a visible label under every destination icon', () => {
    render(<BottomNav />)

    for (const label of ['Home', 'Trips', 'Profile']) {
      expect(screen.getByText(label)).toBeVisible()
    }
  })

  it('pushes the matching route when a nav item is tapped', () => {
    render(<BottomNav />)

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))

    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.profile)
  })
})
