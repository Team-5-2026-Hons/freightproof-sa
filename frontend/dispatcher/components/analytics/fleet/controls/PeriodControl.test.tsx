import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PRESETS_BY_GRAIN, type PeriodSelection } from '@/lib/format/period'
import { PeriodControl } from './PeriodControl'

const TODAY = '2026-09-16'
const CUSTOM: PeriodSelection = { preset: 'custom', start: '2026-08-01', end: '2026-08-31' }

function renderControl(value: PeriodSelection, onChange = vi.fn(), allTimeStart: string | null = '2026-06-20') {
  render(<PeriodControl value={value} onChange={onChange} today={TODAY} allTimeStart={allTimeStart} />)
  return onChange
}

describe('PeriodControl', () => {
  it('lists the presets in order, custom last', () => {
    renderControl({ preset: 'last_12_weeks' })

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      'Last 4 weeks', 'Last 12 weeks', 'Last 12 months', 'This year', 'All time', 'Custom range…',
    ])
  })

  it('lists only the presets it is given, custom still last', () => {
    render(
      <PeriodControl
        value={{ preset: 'all_time' }} onChange={vi.fn()} today={TODAY} allTimeStart="2026-06-20"
        presets={PRESETS_BY_GRAIN.year}
      />,
    )

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['This year', 'Last 3 years', 'All time', 'Custom range…'])
  })

  it('selects a preset', () => {
    const onChange = renderControl({ preset: 'last_12_weeks' })

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all_time' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'all_time' })
  })

  it('starts a custom range from the period on screen', () => {
    const onChange = renderControl({ preset: 'this_year' })

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', start: '2026-01-01', end: TODAY })
  })

  it('starts a custom range from the first trip when All time was chosen', () => {
    const onChange = renderControl({ preset: 'all_time' })

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', start: '2026-06-20', end: TODAY })
  })

  it('shows the two dates only for a custom range', () => {
    renderControl(CUSTOM)

    expect(screen.getByLabelText('From')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('To')).toHaveValue('2026-08-31')
  })

  it('moves the end along when the start passes it', () => {
    const onChange = renderControl(CUSTOM)

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-05' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', start: '2026-09-05', end: '2026-09-05' })
  })

  it('never lets the range end after today', () => {
    const onChange = renderControl(CUSTOM)

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-01' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', start: '2026-08-01', end: TODAY })
  })
})
