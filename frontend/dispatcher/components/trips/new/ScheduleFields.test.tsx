import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_OVERRIDES, NO_TIMES } from '@/lib/trips/manifest-form'
import { ScheduleFields } from './ScheduleFields'

const SOURCE = { departure: '2026-10-02T18:00', arrival: '2026-10-03T06:00' }

describe('ScheduleFields', () => {
  it('shows untouched manifest times, marked as from the manifest', () => {
    render(<ScheduleFields overrides={NO_OVERRIDES} source={SOURCE} onChange={vi.fn()} errors={{}} />)

    expect(screen.getAllByText('From manifest')).toHaveLength(2)
    expect(screen.getByLabelText(/Planned departure/)).toHaveValue('2026-10-02T18:00')
  })

  it('labels both inputs as SAST', () => {
    render(<ScheduleFields overrides={NO_OVERRIDES} source={SOURCE} onChange={vi.fn()} errors={{}} />)

    expect(screen.getByLabelText('Planned departure (SAST)')).toBeInTheDocument()
    expect(screen.getByLabelText('Expected arrival (SAST)')).toBeInTheDocument()
  })

  it('reports an edit, then offers the manifest time back', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ScheduleFields overrides={NO_OVERRIDES} source={SOURCE} onChange={onChange} errors={{}} />)

    fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: '2026-10-02T19:00' } })
    expect(onChange).toHaveBeenCalledWith({ departure: '2026-10-02T19:00', arrival: null })

    rerender(<ScheduleFields overrides={{ departure: '2026-10-02T19:00', arrival: null }} source={SOURCE} onChange={onChange} errors={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use manifest time' }))
    expect(onChange).toHaveBeenLastCalledWith({ departure: null, arrival: null })
  })

  it('marks the departure required only when there is no source time', () => {
    render(
      <ScheduleFields overrides={NO_OVERRIDES} source={NO_TIMES} onChange={vi.fn()} errors={{ departure: 'Enter a planned departure.' }} />,
    )

    const departure = screen.getByLabelText(/Planned departure/) as HTMLInputElement
    expect(departure.labels?.[0]).toHaveTextContent('Planned departure (SAST) *')
    expect(screen.queryByText('From manifest')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a planned departure.')
  })
})
