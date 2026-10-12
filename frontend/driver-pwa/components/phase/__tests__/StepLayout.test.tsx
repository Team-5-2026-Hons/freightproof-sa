import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StepLayout } from '../StepLayout'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

const departure = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!
const arrival = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'arrival')!

describe('StepLayout', () => {
  it('lists what the step needs, marking each item done or still needed', () => {
    // Arrange / Act
    render(
      <StepLayout
        phase={departure}
        stepIndex={0}
        requirements={[
          { label: 'Seal number', met: true },
          { label: 'Seal photo', met: false },
        ]}
        action={<button type="button">Confirm</button>}
      />,
    )

    // Assert — screen readers hear the state, not just sighted drivers seeing a tick.
    const list = screen.getByRole('list', { name: 'Needed to continue' })
    expect(within(list).getByText('Done:')).toBeInTheDocument()
    expect(within(list).getByText('Still needed:')).toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('pins the action in a footer that stays on screen while the step scrolls', () => {
    // Arrange / Act
    render(<StepLayout phase={departure} stepIndex={0} action={<button type="button">Confirm</button>} />)

    // Assert
    const footer = screen.getByRole('button', { name: 'Confirm' }).closest('footer')
    expect(footer).toHaveClass('sticky', 'bottom-0')
  })

  it('renders no footer at all when the step has no action (blocked or waiting)', () => {
    // Arrange / Act
    const { container } = render(
      <StepLayout phase={departure} stepIndex={0} requirements={[{ label: 'Seal photo', met: false }]} />,
    )

    // Assert — a checklist with nothing to unlock would only confuse.
    expect(container.querySelector('footer')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Needed to continue' })).not.toBeInTheDocument()
  })

  it('shows the intro above the step content', () => {
    // Arrange / Act
    render(
      <StepLayout phase={departure} stepIndex={0} intro="Photograph the seal.">
        <p>content</p>
      </StepLayout>,
    )

    // Assert
    expect(screen.getByText('Photograph the seal.')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})

describe('StepHeader progress (via StepLayout)', () => {
  it('does not show a one-step phase as already complete when it opens', () => {
    // Arrange / Act — arrival has a single step.
    const { container } = render(<StepLayout phase={arrival} stepIndex={0} />)

    // Assert — the only segment is the "on screen now" tint, never the solid "done" fill.
    const segments = container.querySelectorAll('header [aria-hidden] > span')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveClass('bg-secondary/40')
    expect(segments[0]).not.toHaveClass('bg-secondary')
  })

  it('fills the steps already done and tints the current one', () => {
    // Arrange / Act — departure's second step.
    const { container } = render(<StepLayout phase={departure} stepIndex={1} />)

    // Assert
    const segments = container.querySelectorAll('header [aria-hidden] > span')
    expect(segments[0]).toHaveClass('bg-secondary')
    expect(segments[1]).toHaveClass('bg-secondary/40')
  })
})
