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
  mockUseTrip.mockReturnValue({ trip: null })
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

  it('shows the red trip dot on Trips when a trip is assigned', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.getByText(/active trip assigned/i)).toBeInTheDocument()
  })

  it('hides the red trip dot when there is no active trip', () => {
    mockUseTrip.mockReturnValue({ trip: null })
    render(<BottomNav onProfileClick={vi.fn()} />)

    expect(screen.queryByText(/active trip assigned/i)).not.toBeInTheDocument()
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
