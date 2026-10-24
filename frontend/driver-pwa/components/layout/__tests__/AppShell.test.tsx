import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppShell } from '../AppShell'

let mockPathname = '/trips'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => mockPathname,
}))

// The shell's chrome is under test, not its children's dependencies.
vi.mock('../BottomNav', () => ({ BottomNav: () => <nav aria-label="Main navigation" /> }))
vi.mock('../OfflineBanner', () => ({ OfflineBanner: () => null }))

beforeEach(() => {
  mockPathname = '/trips'
})

describe('AppShell', () => {
  it('renders one large title named after the tab, with the inline title hidden at rest', () => {
    // Arrange / Act
    render(<AppShell><p>content</p></AppShell>)

    // Assert — exactly one heading, so "Trips"/"My Trips" can't double up again.
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Trips' })).toHaveClass('text-large-title')
    const inline = screen.getByText('Trips', { selector: 'p' })
    expect(inline).toHaveAttribute('aria-hidden', 'true')
    expect(inline).toHaveClass('opacity-0')
  })

  it('collapses into the inline title and glass bar once the large title scrolls under the bar', () => {
    // Arrange
    const { container } = render(<AppShell><p>content</p></AppShell>)
    const scrollport = container.firstElementChild as HTMLDivElement
    const header = container.querySelector('header') as HTMLElement

    // Act — jsdom has no layout (every offset is 0), so any positive scroll passes the
    // title's bottom edge.
    scrollport.scrollTop = 40
    fireEvent.scroll(scrollport)

    // Assert
    const inline = screen.getByText('Trips', { selector: 'p' })
    expect(inline).toHaveAttribute('aria-hidden', 'false')
    expect(inline).toHaveClass('opacity-100')
    // The material is the header's first child: it now grows over the small-title row
    // instead of the header carrying an empty 44pt row at rest.
    expect(header.firstElementChild).toHaveClass('glass-nav')
  })

  it('test_scroll_event_at_the_top_keeps_the_large_title', () => {
    // A tab switch clamps the shared scrollport back to 0 and fires a scroll event there.
    // At rest the large title already sits under the inline row, so a threshold measured
    // from layout alone goes negative and collapsed the bar over the title at scrollTop 0.
    // jsdom has no layout; give every box the 44px of the inline row so the title's
    // midline (22) sits above the bar's bottom edge (88), as it does on a phone.
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
    // The shell, its scrollport and its collapsed flag outlive the tab: Profile scrolled to
    // Sign Out then a tap on Trips left Trips under a collapsed bar, which nothing on a
    // non-scrolling screen could ever undo.
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
    // Arrange
    mockPathname = '/somewhere-else'

    // Act
    render(<AppShell><p>content</p></AppShell>)

    // Assert
    expect(screen.getByRole('heading', { name: 'FreightProof' })).toBeInTheDocument()
  })

  it('test_profile_keeps_its_title_for_screen_readers_but_not_on_screen', () => {
    // The driver's photo and name head the Profile screen (overhaul 10.1); a large
    // "Profile" above them would say the same thing twice.
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
    // Tim, 14 Oct: the Trips page must not scroll; its lists stop above the tab bar. At
    // accessibility text sizes the content cannot fit, so the scrollport may still scroll
    // rather than hide "See all" under the tab bar. That it does NOT scroll at normal sizes
    // is a layout fact jsdom cannot measure — the Stage 9 browser audit asserts it.
    mockPathname = '/trips'

    const { container } = render(<AppShell><p>content</p></AppShell>)

    const scrollport = container.firstElementChild as HTMLElement
    expect(scrollport).toHaveClass('flex', 'flex-col', 'overflow-y-auto')
    // The page sits inside the transition frame; the remaining height must reach it.
    expect(screen.getByText('content').parentElement?.className).toMatch(/\[&>\*\]:flex-1/)
  })

  it('test_home_keeps_its_title_for_screen_readers_but_leads_with_the_greeting', () => {
    mockPathname = '/'

    render(<AppShell><p>content</p></AppShell>)

    expect(screen.getByRole('heading', { name: 'Home' })).toHaveClass('sr-only')
  })
})
