import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MonthRangePicker, type MonthRange } from './MonthRangePicker'

const LATEST = '2026-09-01'
const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/

function renderPicker(value: MonthRange) {
  const onChange = vi.fn<(range: MonthRange) => void>()
  render(<MonthRangePicker value={value} onChange={onChange} latestMonth={LATEST} />)
  return onChange
}

describe('MonthRangePicker', () => {
  it('shows the current range in its month and year selects', () => {
    renderPicker({ start: '2026-07-01', end: '2026-09-01' })

    expect(screen.getByLabelText('From month')).toHaveValue('7')
    expect(screen.getByLabelText('From year')).toHaveValue('2026')
    expect(screen.getByLabelText('To month')).toHaveValue('9')
    expect(screen.getByLabelText('To year')).toHaveValue('2026')
  })

  it('emits a first-of-month start when the start month changes', async () => {
    const onChange = renderPicker({ start: '2026-07-01', end: '2026-09-01' })

    await userEvent.selectOptions(screen.getByLabelText('From month'), '8')

    expect(onChange).toHaveBeenCalledWith({ start: '2026-08-01', end: '2026-09-01' })
  })

  it('moves the end along when the start is moved past it', async () => {
    const onChange = renderPicker({ start: '2026-06-01', end: '2026-07-01' })

    await userEvent.selectOptions(screen.getByLabelText('From month'), '9')

    expect(onChange).toHaveBeenCalledWith({ start: '2026-09-01', end: '2026-09-01' })
  })

  it('moves the start along when the end is moved before it', async () => {
    const onChange = renderPicker({ start: '2026-06-01', end: '2026-09-01' })

    await userEvent.selectOptions(screen.getByLabelText('To year'), '2025')

    expect(onChange).toHaveBeenCalledWith({ start: '2025-09-01', end: '2025-09-01' })
  })

  it('disables months after the latest month in its year', () => {
    renderPicker({ start: '2026-07-01', end: '2026-09-01' })

    const fromMonth = screen.getByLabelText('From month')
    expect(fromMonth.querySelector('option[value="9"]')).not.toBeDisabled()
    expect(fromMonth.querySelector('option[value="10"]')).toBeDisabled()
  })

  it('clamps a year change that would land in a future month', async () => {
    // November 2025 moved to 2026 would be November 2026 — after the latest month.
    const onChange = renderPicker({ start: '2025-11-01', end: '2026-09-01' })

    await userEvent.selectOptions(screen.getByLabelText('From year'), '2026')

    expect(onChange).toHaveBeenCalledWith({ start: LATEST, end: LATEST })
  })

  it('only ever emits first-of-month bounds', async () => {
    const onChange = renderPicker({ start: '2026-03-01', end: '2026-05-01' })

    // August is past the May end, so this one also exercises the end following the start.
    await userEvent.selectOptions(screen.getByLabelText('From month'), '8')
    await userEvent.selectOptions(screen.getByLabelText('To year'), '2024')
    await userEvent.selectOptions(screen.getByLabelText('To month'), '1')

    expect(onChange).toHaveBeenCalledTimes(3)
    for (const [range] of onChange.mock.calls) {
      expect(range.start).toMatch(FIRST_OF_MONTH)
      expect(range.end).toMatch(FIRST_OF_MONTH)
      expect(range.start <= range.end).toBe(true)
    }
  })
})
