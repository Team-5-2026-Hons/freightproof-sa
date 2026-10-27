import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DateRangePicker } from './DateRangePicker'

const JUST_AFTER_SAST_MIDNIGHT = new Date('2026-10-22T23:30:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(JUST_AFTER_SAST_MIDNIGHT)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DateRangePicker default presets', () => {
  it('counts Today and the day offsets from the SAST calendar day', () => {
    const onChange = vi.fn()
    render(<DateRangePicker value={{ from: '2020-01-01', to: '2026-10-23' }} onChange={onChange} />)
    fireEvent.click(screen.getByText(/→/))

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-23', to: '2026-10-23' })

    fireEvent.click(screen.getByText(/→/))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-16', to: '2026-10-23' })

    fireEvent.click(screen.getByText(/→/))
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-23', to: '2026-10-23' })
  })

  it('reads the date when the picker opens, not when the module loaded', () => {
    const onChange = vi.fn()
    render(<DateRangePicker value={{ from: '2020-01-01', to: '2026-10-23' }} onChange={onChange} />)

    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
    fireEvent.click(screen.getByText(/→/))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-05', to: '2026-11-05' })
  })
})
