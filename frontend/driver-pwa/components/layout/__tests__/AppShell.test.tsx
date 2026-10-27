import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppShell } from '../AppShell'

let mockPathname = '/trips'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => mockPathname,
}))

vi.mock('../BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('../OfflineBanner', () => ({ OfflineBanner: () => null }))

beforeEach(() => {
  mockPathname = '/trips'
})

describe('AppShell', () => {
  it('renders one large title named after the tab, with the inline title hidden at rest', () => {
    render(<AppShell><p>content</p></AppShell>)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Trips' })).toHaveClass('text-large-title')
    const inline = screen.getByText('Trips', { selector: 'p' })
    expect(inline).toHaveAttribute('aria-hidden', 'true')
    expect(inline).toHaveClass('opacity-0')
  })

  it('collapses into the inline title and glass bar once the large title scrolls under the bar', () => {
    const { container } = render(<AppShell><p>content</p></AppShell>)
    const scrollport = container.firstElementChild as HTMLDivElement
    const header = container.querySelector('header') as HTMLElement

    scrollport.scrollTop = 40
    fireEvent.scroll(scrollport)

    const inline = screen.getByText('Trips', { selector: 'p' })
    expect(inline).toHaveAttribute('aria-hidden', 'false')
    expect(inline).toHaveClass('opacity-100')
    expect(header.firstElementChild).toHaveClass('glass-nav')
  })

  it('test_scroll_event_at_the_top_keeps_the_large_title', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44)
    const { container } = render(<AppShell><p>content</p></AppShell>)
    const scrollport = container.firstElementChild as HTMLDivElement

    scrollport.scrollTop = 0
    fireEvent.scroll(scrollport)

    expect(screen.getByText('Trips', { selector: 'p' })).toHaveClass('opacity-0')
    expect(container.querySelector('header')?.firstElementChild).not.toHaveClass('glass-nav')
    height.mockRestore()
  })

  it('test_tab_switch_opens_the_next_tab_at_the_top_with_its_large_title', () => {
    mockPathname = '/profile'
    const { container, rerender } = render(<AppShell><p>profile</p></AppShell>)
    const scrollport = container.firstElementChild as HTMLDivElement
    mockPathname = '/trips'
    rerender(<AppShell><p>trips</p></AppShell>)
    scrollport.scrollTop = 40
    fireEvent.scroll(scrollport)
    mockPathname = '/profile'
    rerender(<AppShell><p>profile</p></AppShell>)
    scrollport.scrollTop = 600

    mockPathname = '/'
    rerender(<AppShell><p>home</p></AppShell>)

    expect(scrollport.scrollTop).toBe(0)
    expect(container.querySelector('header')?.firstElementChild).not.toHaveClass('glass-nav')
  })

  it('falls back to the product name on an unmapped route', () => {
    mockPathname = '/somewhere-else'

    render(<AppShell><p>content</p></AppShell>)

    expect(screen.getByRole('heading', { name: 'FreightProof' })).toBeInTheDocument()
  })

  it('test_profile_keeps_its_title_for_screen_readers_but_not_on_screen', () => {
    mockPathname = '/profile'

    render(<AppShell><p>content</p></AppShell>)

    expect(screen.getByRole('heading', { name: 'Profile' })).toHaveClass('sr-only')
  })

  it('test_profile_never_collapses_into_an_inline_title', () => {
    mockPathname = '/profile'
    const { container } = render(<AppShell><p>content</p></AppShell>)
    const scrollport = container.firstElementChild as HTMLDivElement

    scrollport.scrollTop = 400
    fireEvent.scroll(scrollport)

    expect(screen.queryByText('Profile', { selector: 'p' })).toBeNull()
  })

  it('test_trips_fills_the_screen_and_scrolls_only_when_it_cannot_fit', () => {
    mockPathname = '/trips'

    const { container } = render(<AppShell><p>content</p></AppShell>)

    const scrollport = container.firstElementChild as HTMLElement
    expect(scrollport).toHaveClass('flex', 'flex-col', 'overflow-y-auto')
    expect(screen.getByText('content').parentElement?.className).toMatch(/\[&>\*\]:flex-1/)
  })

  it('test_home_keeps_its_title_for_screen_readers_but_leads_with_the_greeting', () => {
    mockPathname = '/'

    render(<AppShell><p>content</p></AppShell>)

    expect(screen.getByRole('heading', { name: 'Home' })).toHaveClass('sr-only')
  })
})
