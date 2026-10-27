import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  it('renders the secondary variant with a distinct visible border', () => {
    render(<Button variant="secondary">Log Checkpoint</Button>)

    const button = screen.getByRole('button', { name: 'Log Checkpoint' })

    expect(button).toHaveClass('border', 'border-outline-variant', 'text-surface-on')
    expect(button).not.toHaveClass('text-secondary')
  })

  it('gives a disabled secondary button its own muted look, separable from enabled', () => {
    render(<Button variant="secondary" disabled>Capture GPS Location</Button>)

    const button = screen.getByRole('button', { name: 'Capture GPS Location' })

    expect(button.className).toContain('disabled:bg-surface-container-low')
    expect(button.className).toContain('disabled:text-surface-on-variant')
    expect(button.className).not.toContain('disabled:opacity-40')
    expect(button).toBeDisabled()
  })

  it('keeps a disabled primary button legible instead of fading it out', () => {
    render(<Button disabled>Submit Exception</Button>)

    const button = screen.getByRole('button', { name: 'Submit Exception' })
    expect(button.className).toContain('disabled:bg-surface-container-highest')
    expect(button.className).not.toContain('disabled:opacity-40')
  })

  it('test_fill_variant_is_a_grey_face_with_an_ink_label_and_no_border', () => {
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
    render(<Button size="pill-sm" variant="fill">Edit</Button>)

    const button = screen.getByRole('button', { name: 'Edit' })

    expect(button).toHaveClass('rounded-full', 'min-h-[44px]')
    expect(button).not.toHaveClass('w-full')
  })

  it('test_existing_sizes_keep_their_shape_for_the_sign_in_screens', () => {
    render(<Button size="lg">Send Code</Button>)

    expect(screen.getByRole('button', { name: 'Send Code' })).toHaveClass('rounded-xl', 'min-h-[52px]')
  })

  it('test_destructive_variant_is_a_solid_red_face', () => {
    render(<Button variant="destructive">Sign Out</Button>)

    expect(screen.getByRole('button', { name: 'Sign Out' })).toHaveClass('bg-error', 'text-error-on')
  })
})
