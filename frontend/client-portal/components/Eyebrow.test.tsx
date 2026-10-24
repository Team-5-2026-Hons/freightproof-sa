import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Eyebrow } from './Eyebrow'

describe('Eyebrow', () => {
  it('renders a muted caption-sized paragraph by default', () => {
    render(<Eyebrow>Contents</Eyebrow>)

    const label = screen.getByText('Contents')
    expect(label.tagName).toBe('P')
    expect(label).toHaveClass('text-caption', 'font-bold', 'uppercase', 'tracking-eyebrow', 'text-muted')
  })

  it('renders as the element it is asked to be, so a heading stays a heading', () => {
    render(<Eyebrow as="h4">Pack seal</Eyebrow>)

    expect(screen.getByRole('heading', { level: 4, name: 'Pack seal' })).toBeInTheDocument()
  })

  it('supports the micro size and the on-dark tone', () => {
    render(<Eyebrow size="micro" tone="onDark">FreightProof audit pack</Eyebrow>)

    const label = screen.getByText('FreightProof audit pack')
    expect(label).toHaveClass('text-micro', 'text-white/60')
    expect(label).not.toHaveClass('text-muted')
  })

  it('keeps the caller’s layout classes', () => {
    render(<Eyebrow className="mb-1 mt-4">Stops</Eyebrow>)

    expect(screen.getByText('Stops')).toHaveClass('mb-1', 'mt-4', 'uppercase')
  })
})
