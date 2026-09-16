import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GrainToggle } from './GrainToggle'

describe('GrainToggle', () => {
  it('checks the current grain', () => {
    render(<GrainToggle value="month" onChange={vi.fn()} disabled={[]} />)

    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'false')
  })

  it('changes grain on click', () => {
    const onChange = vi.fn()
    render(<GrainToggle value="week" onChange={onChange} disabled={[]} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Year' }))

    expect(onChange).toHaveBeenCalledWith('year')
  })

  it('shows a grain with too many bars but will not select it', () => {
    const onChange = vi.fn()
    render(<GrainToggle value="month" onChange={onChange} disabled={['week']} />)

    const week = screen.getByRole('radio', { name: 'Week' })
    fireEvent.click(week)

    expect(onChange).not.toHaveBeenCalled()
    expect(week).toHaveAttribute('aria-disabled', 'true')
    expect(week).toHaveAttribute('title', 'Too many weeks for this period — choose Month')
  })

  it('moves with the arrow keys and skips disabled grains', () => {
    const onChange = vi.fn()
    render(<GrainToggle value="year" onChange={onChange} disabled={['week']} />)

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Year' }), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith('month')
  })
})
