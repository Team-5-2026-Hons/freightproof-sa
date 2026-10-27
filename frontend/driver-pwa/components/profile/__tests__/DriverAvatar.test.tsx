import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DriverAvatar, initialsOf } from '../DriverAvatar'

describe('initialsOf', () => {
  it('test_takes_first_and_last_initials', () => {
    expect(initialsOf('Sipho Dlamini')).toBe('SD')
    expect(initialsOf('  sipho   van der  merwe ')).toBe('SM')
  })

  it('test_copes_with_a_single_name', () => {
    expect(initialsOf('Sipho')).toBe('S')
  })
})

describe('DriverAvatar', () => {
  it('test_shows_the_photo_when_there_is_one', () => {
    render(<DriverAvatar name="Sipho Dlamini" photo="data:image/jpeg;base64,AAAA" size={104} />)

    const img = screen.getByRole('img', { name: 'Sipho Dlamini' })

    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA')
  })

  it('test_falls_back_to_initials_without_a_photo', () => {
    render(<DriverAvatar name="Sipho Dlamini" photo={null} size={104} />)

    expect(screen.getByRole('img', { name: 'Sipho Dlamini' })).toHaveTextContent('SD')
  })

  it('test_draws_a_ring_when_selected', () => {
    render(<DriverAvatar name="Sipho Dlamini" photo={null} size={26} ring />)

    expect(screen.getByRole('img')).toHaveClass('ring-2')
  })

  it('test_can_be_decorative_beside_a_visible_label', () => {
    render(<DriverAvatar name="Sipho Dlamini" photo={null} size={26} decorative />)

    expect(screen.queryByRole('img')).toBeNull()
  })
})
