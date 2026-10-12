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
vi.mock('../ProfilePanel', () => ({ ProfilePanel: () => null }))
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
    expect(header).toHaveClass('glass-nav')
  })

  it('falls back to the product name on an unmapped route', () => {
    // Arrange
    mockPathname = '/somewhere-else'

    // Act
    render(<AppShell><p>content</p></AppShell>)

    // Assert
    expect(screen.getByRole('heading', { name: 'FreightProof' })).toBeInTheDocument()
  })
})
