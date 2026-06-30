import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CurrentHandshakeCard } from '../CurrentHandshakeCard'

describe('CurrentHandshakeCard', () => {
  it('renders the handshake number and name', () => {
    render(<CurrentHandshakeCard handshakeNumber={2} onSelect={vi.fn()} />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<CurrentHandshakeCard handshakeNumber={3} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
