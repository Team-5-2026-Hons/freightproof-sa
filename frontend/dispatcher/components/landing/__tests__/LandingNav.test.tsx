import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/lib/constants/routes'
import { LandingNav } from '../LandingNav'

const mockAuth = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockAuth.user, isLoading: false, signIn: vi.fn(), signOut: vi.fn() }),
}))

beforeEach(() => {
  mockAuth.user = null
})

describe('LandingNav', () => {
  it('signed_out_visitor_gets_sign_in_and_request_access', () => {
    render(<LandingNav onLanding />)

    const signIns = screen.getAllByRole('link', { name: 'Sign in' })
    expect(signIns).toHaveLength(2)
    signIns.forEach(link => expect(link).toHaveAttribute('href', ROUTES.login))
    screen.getAllByRole('link', { name: 'Request access' }).forEach(link => expect(link).toHaveAttribute('href', '#request-access'))
    expect(screen.queryByRole('link', { name: 'Open dashboard' })).not.toBeInTheDocument()
  })

  it('signed_in_dispatcher_goes_straight_to_the_dashboard', () => {
    mockAuth.user = { id: 'user-1' }

    render(<LandingNav onLanding />)

    screen.getAllByRole('link', { name: 'Open dashboard' }).forEach(link => expect(link).toHaveAttribute('href', ROUTES.home))
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('section_links_stay_in_page_on_landing_and_go_home_from_elsewhere', () => {
    const { unmount } = render(<LandingNav onLanding />)
    screen.getAllByRole('link', { name: 'About' }).forEach(link => expect(link).toHaveAttribute('href', '#about'))
    unmount()

    render(<LandingNav />)
    screen.getAllByRole('link', { name: 'About' }).forEach(link => expect(link).toHaveAttribute('href', '/#about'))
    expect(screen.getByRole('link', { name: 'FreightProof home' })).toHaveAttribute('href', '/')
  })

  it('mobile_menu_opens_and_closes_with_escape', async () => {
    const user = userEvent.setup()
    render(<LandingNav onLanding />)

    const toggle = screen.getByRole('button', { name: 'Open menu' })
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Close menu' })).toBe(toggle)

    await user.keyboard('{Escape}')

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('choosing_a_menu_link_closes_the_menu', async () => {
    const user = userEvent.setup()
    render(<LandingNav onLanding />)
    const toggle = screen.getByRole('button', { name: 'Open menu' })
    await user.click(toggle)

    const menu = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    const howItWorks = menu?.querySelector<HTMLAnchorElement>('a[href="#how-it-works"]')
    if (!howItWorks) throw new Error('menu link missing')
    await user.click(howItWorks)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
