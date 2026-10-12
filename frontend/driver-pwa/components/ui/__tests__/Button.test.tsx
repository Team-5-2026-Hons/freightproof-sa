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

  it('gives a disabled secondary button its own muted look, separable from enabled', () => {
    // The disabled affordance must remain visually separable from the secondary
    // variant so an enabled secondary button never looks disabled — now by a grey fill
    // and muted label rather than a 40% fade, which read as a dead control.
    render(<Button variant="secondary" disabled>Capture GPS Location</Button>)

    const button = screen.getByRole('button', { name: 'Capture GPS Location' })

    expect(button.className).toContain('disabled:bg-surface-container-low')
    expect(button.className).toContain('disabled:text-surface-on-variant')
    expect(button.className).not.toContain('disabled:opacity-40')
    expect(button).toBeDisabled()
  })

  it('keeps a disabled primary button legible instead of fading it out', () => {
    // Arrange / Act
    render(<Button disabled>Submit Exception</Button>)

    // Assert
    const button = screen.getByRole('button', { name: 'Submit Exception' })
    expect(button.className).toContain('disabled:bg-surface-container-highest')
    expect(button.className).not.toContain('disabled:opacity-40')
  })
})
