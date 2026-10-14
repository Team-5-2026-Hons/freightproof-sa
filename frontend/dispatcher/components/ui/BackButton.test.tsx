import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BackButton } from './BackButton'

describe('BackButton', () => {
  it('renders a "Back" button with the arrow icon', () => {
    render(<BackButton onClick={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Back' })

    // The arrow is the whole point of the shared component — a Back without it is the
    // inconsistency this replaced.
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  it('calls onClick when pressed', () => {
    const onClick = vi.fn()
    render(<BackButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onClick).toHaveBeenCalledOnce()
  })
})
