import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JOURNEY } from '@/lib/landing/content'
import LandingPage from './page'

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoading: false, signIn: vi.fn(), signOut: vi.fn() }),
}))

describe('LandingPage', () => {
  it('landing_tells_the_whole_story_in_order', () => {
    render(<LandingPage />)

    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings).toEqual([
      'One truck. Seven handovers. Every one on the record.',
      'Every leg is tracked. The handover isn’t.',
      'When a load is disputed, you open the record.',
      'Built for how freight actually moves.',
      'Built in Cape Town, for South African roads.',
      'Put your next trip on the record.',
      'Product',
      'Company',
      'Legal',
    ])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^FreightProof$/)
    expect(screen.getByText('Every handover. On the record.')).toBeInTheDocument()
  })

  it('landing_walks_every_phase_of_a_trip', () => {
    render(<LandingPage />)

    const stops = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    JOURNEY.forEach(stop => expect(stops).toContain(stop.title))
  })

  it('landing_links_to_sign_in_and_every_legal_page', () => {
    render(<LandingPage />)

    const legal = screen.getByRole('navigation', { name: 'Legal' })
    expect(within(legal).getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/legal/privacy')
    expect(within(legal).getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/legal/terms')
    expect(within(legal).getByRole('link', { name: 'Cookie Notice' })).toHaveAttribute('href', '/legal/cookies')
    expect(within(legal).getByRole('link', { name: 'PAIA & ECT Act' })).toHaveAttribute('href', '/legal/company')
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/login')
  })

  it('landing_cites_a_source_for_every_figure', () => {
    render(<LandingPage />)

    const sources = screen.getAllByRole('link').filter(a => a.getAttribute('target') === '_blank')
    expect(sources.length).toBeGreaterThanOrEqual(3)
    sources.forEach(a => expect(a).toHaveAttribute('rel', 'noopener noreferrer'))
  })
})
