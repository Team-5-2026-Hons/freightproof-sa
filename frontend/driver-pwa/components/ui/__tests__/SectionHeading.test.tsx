import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SectionHeading } from '../SectionHeading'

describe('SectionHeading', () => {
  it('test_renders_an_h2_by_default', () => {
    render(<SectionHeading title="Upcoming" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Upcoming' })).toHaveClass('text-title-2')
  })

  it('test_places_an_action_beside_the_title', () => {
    render(<SectionHeading title="Past" action={<button type="button">See all</button>} />)

    expect(screen.getByRole('button', { name: 'See all' })).toBeInTheDocument()
  })
})
