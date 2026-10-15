import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusBanner } from '../StatusBanner'

describe('StatusBanner', () => {
  it('test_renders_title_and_body', () => {
    render(<StatusBanner tone="success" title="In transit · on schedule">Swipe Arrive at the gate.</StatusBanner>)

    expect(screen.getByText('In transit · on schedule')).toBeInTheDocument()
    expect(screen.getByText('Swipe Arrive at the gate.')).toBeInTheDocument()
  })

  it('test_success_tone_uses_the_tint_ground_and_ink', () => {
    const { container } = render(<StatusBanner tone="success" title="Delivered on time" />)

    const banner = container.firstElementChild as HTMLElement

    expect(banner).toHaveClass('bg-success-tint', 'text-success-ink')
  })

  it('test_attention_tone_is_amber_not_red', () => {
    // Waiting / under review / offline are not errors and must never read as one.
    const { container } = render(<StatusBanner tone="attention" title="Waiting for dispatch" />)

    const banner = container.firstElementChild as HTMLElement

    expect(banner).toHaveClass('bg-attention-tint', 'text-attention-ink')
    expect(banner.className).not.toMatch(/error/)
  })

  it('test_shows_a_tone_dot_unless_an_icon_is_given', () => {
    const { container, rerender } = render(<StatusBanner tone="neutral" title="Starts today at 12:00" />)

    expect(container.querySelector('[data-banner-dot]')).not.toBeNull()

    rerender(<StatusBanner tone="neutral" title="Starts today at 12:00" icon={<svg data-testid="clock" />} />)

    expect(container.querySelector('[data-banner-dot]')).toBeNull()
    expect(screen.getByTestId('clock')).toBeInTheDocument()
  })

  it('test_is_a_live_region_only_when_asked', () => {
    // Most banners describe a settled state; announcing them on every render is noise.
    const { rerender } = render(<StatusBanner tone="neutral" title="Static" />)

    expect(screen.queryByRole('status')).toBeNull()

    rerender(<StatusBanner tone="neutral" title="Changing" live />)

    expect(screen.getByRole('status')).toHaveTextContent('Changing')
  })
})
