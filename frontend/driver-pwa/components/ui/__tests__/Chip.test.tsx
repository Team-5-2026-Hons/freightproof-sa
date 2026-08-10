// frontend/driver-pwa/components/ui/__tests__/Chip.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Chip } from '../Chip'

// The pulsing ring is the whole point of the `live` kind — a static green chip would
// look correct in a screenshot and be wrong in the app, so these assert on the
// animation class rather than only on colour.
function ring(container: HTMLElement): Element | null {
  return container.querySelector('.animate-radar-pulse')
}

describe('Chip', () => {
  it('renders the live kind as a solid success fill', () => {
    render(<Chip kind="live">Active</Chip>)

    const chip = screen.getByText('Active')
    expect(chip).toHaveClass('bg-success')
    expect(chip).toHaveClass('text-success-on')
  })

  it('pulses the live kind without any call-site opt-in', () => {
    // Deliberately no `animated` prop — every surface showing a running trip must
    // pulse identically, so `live` owns its own animation.
    const { container } = render(<Chip kind="live">Active</Chip>)

    expect(ring(container)).not.toBeNull()
  })

  it('disables the live pulse under prefers-reduced-motion', () => {
    const { container } = render(<Chip kind="live">Active</Chip>)

    expect(ring(container)).toHaveClass('motion-reduce:animate-none')
  })

  it('does not pulse a non-live kind', () => {
    const { container } = render(<Chip kind="success">Complete</Chip>)

    expect(ring(container)).toBeNull()
  })

  it('still honours the explicit animated prop on non-live kinds', () => {
    const { container } = render(<Chip kind="pending" animated>Queued</Chip>)

    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('a caller-supplied icon replaces the dot entirely, live included', () => {
    const { container } = render(
      <Chip kind="live" icon={<svg data-testid="custom-icon" />}>Active</Chip>,
    )

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    expect(ring(container)).toBeNull()
  })
})
