import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  it('renders the secondary variant with a distinct visible border', () => {
    // Regression: the old secondary variant (bg-surface-container-highest, no border)
    // read as the disabled state to testers. It must now carry a border to stay
    // clearly "enabled". Full-strength hairline and an ink label: the quiet style must
    // never fall back to the old borderless blue link text (ghost, removed Oct 2026).
    render(<Button variant="secondary">Log Checkpoint</Button>)

    const button = screen.getByRole('button', { name: 'Log Checkpoint' })

    expect(button).toHaveClass('border', 'border-outline-variant', 'text-surface-on')
    expect(button).not.toHaveClass('text-secondary')
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

  it('test_fill_variant_is_a_grey_face_with_an_ink_label_and_no_border', () => {
    // Overhaul secondary action: Uber-style grey pill. No hairline — the fill is the edge.
    render(<Button variant="fill">Directions</Button>)

    const button = screen.getByRole('button', { name: 'Directions' })

    expect(button).toHaveClass('bg-fill', 'text-surface-on')
    expect(button).not.toHaveClass('border')
  })

  it('test_pill_size_is_a_56pt_full_width_capsule', () => {
    render(<Button size="pill">Continue Driving</Button>)

    const button = screen.getByRole('button', { name: 'Continue Driving' })

    expect(button).toHaveClass('rounded-full', 'min-h-[56px]', 'w-full')
    expect(button).not.toHaveClass('rounded-xl')
  })

  it('test_pill_sm_size_keeps_a_44pt_hit_area', () => {
    // Inline row actions (Edit, Retake, See all) never drop below the 44pt touch minimum.
    render(<Button size="pill-sm" variant="fill">Edit</Button>)

    const button = screen.getByRole('button', { name: 'Edit' })

    expect(button).toHaveClass('rounded-full', 'min-h-[44px]')
    expect(button).not.toHaveClass('w-full')
  })

  it('test_existing_sizes_keep_their_shape_for_the_sign_in_screens', () => {
    // Sign-in must stay pixel-identical (Tim, 14 Oct); it uses size lg and its own pill
    // class. The overhaul adds sizes; it never edits these.
    render(<Button size="lg">Send Code</Button>)

    expect(screen.getByRole('button', { name: 'Send Code' })).toHaveClass('rounded-xl', 'min-h-[52px]')
  })

  it('test_destructive_variant_is_a_solid_red_face', () => {
    // Reserved for the confirm step of an irreversible action (Sign Out in its sheet).
    render(<Button variant="destructive">Sign Out</Button>)

    expect(screen.getByRole('button', { name: 'Sign Out' })).toHaveClass('bg-error', 'text-error-on')
  })
})
