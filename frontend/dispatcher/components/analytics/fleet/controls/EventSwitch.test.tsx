import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EventSwitch } from './EventSwitch'

describe('EventSwitch', () => {
  it('has an accessible name and no visible caption', () => {
    render(<EventSwitch value="departures" onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup', { name: 'Show departures or arrivals' })).toBeInTheDocument()
    expect(screen.queryByText('Show')).toBeNull()
  })

  it('checks the event on show', () => {
    render(<EventSwitch value="departures" onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: 'Departures' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Arrivals' })).toHaveAttribute('aria-checked', 'false')
  })

  it('switches on click and with the arrow keys', () => {
    const onChange = vi.fn()
    render(<EventSwitch value="departures" onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Arrivals' }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Departures' }), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenNthCalledWith(1, 'arrivals')
    expect(onChange).toHaveBeenNthCalledWith(2, 'arrivals')
  })
})
