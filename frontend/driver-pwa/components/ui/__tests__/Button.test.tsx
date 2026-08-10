import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  it('renders the secondary variant with a distinct visible border', () => {
    // Regression: the old secondary variant (bg-surface-container-highest, no border)
    // read as the disabled state to testers. It must now carry a border to stay
    // clearly "enabled".
    render(<Button variant="secondary">Log Checkpoint</Button>)

    const button = screen.getByRole('button', { name: 'Log Checkpoint' })

    expect(button.className).toContain('border-outline-variant/60')
  })

  it('applies opacity-40 only when disabled', () => {
    // The disabled affordance must remain visually separable from the secondary
    // variant so an enabled secondary button never looks disabled.
    render(<Button variant="secondary" disabled>Capture GPS Location</Button>)

    const button = screen.getByRole('button', { name: 'Capture GPS Location' })

    expect(button.className).toContain('disabled:opacity-40')
    expect(button).toBeDisabled()
  })
})
