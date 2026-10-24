// frontend/driver-pwa/app/__tests__/not-found.test.tsx
//
// An unknown URL used to land on Next's unstyled default 404 with no way out of it. The
// screen has to say what happened in the app's own voice and offer exactly one way back.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ROUTES } from '@/lib/constants/routes'
import NotFoundPage from '../not-found'

describe('NotFoundPage', () => {
  it('test_names_the_problem_in_a_heading', () => {
    render(<NotFoundPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('test_links_back_to_home_with_a_full_page_load', () => {
    render(<NotFoundPage />)

    // A plain anchor on purpose (see the page): it may be served for any unknown path.
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', ROUTES.home)
  })

  it('test_offers_no_retry_because_nothing_failed', () => {
    render(<NotFoundPage />)

    // error.tsx's "Try Again" re-renders a crashed segment; a wrong address has none.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })
})
