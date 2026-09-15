import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocationCheckNotice } from '../LocationCheckNotice'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'

const measuredMismatch: ActionLocationAssessment = {
  schema_version: 1,
  policy_version: '2026-09-15.1',
  evaluated_at: '2026-09-15T10:00:00Z',
  driver_lat: -26.1, driver_lng: 28.1, driver_captured_at: '2026-09-15T10:00:00Z', driver_accuracy_metres: 8,
  tracker_lat: -26.101, tracker_lng: 28.101, tracker_captured_at: '2026-09-15T10:00:02Z',
  separation_metres: 320, proximity: 'separated', reasons: [],
  max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
  expected_trip_stop_id: 'stop-1', precinct_id: 'precinct-1', precinct_lat: null, precinct_lng: null,
  precinct_radius_metres: null, precinct_tolerance_metres: null, driver_in_precinct: true, truck_in_precinct: true,
}

function renderNotice(assessment: ActionLocationAssessment | null, loading = false, error: string | null = null) {
  const onRetry = vi.fn()
  const onContinue = vi.fn()
  render(<LocationCheckNotice assessment={assessment} loading={loading} error={error} onRetry={onRetry} onContinue={onContinue} />)
  return { onRetry, onContinue }
}

describe('LocationCheckNotice', () => {
  it('allows normal continuation when the server assessment passes', () => {
    const { onContinue } = renderNotice({ ...measuredMismatch, proximity: 'within_limit', separation_metres: 12 })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledWith(null)
  })

  it('explains a measured mismatch and requires a reason before continuing with an exception', () => {
    const { onRetry, onContinue } = renderNotice(measuredMismatch)

    expect(screen.getByText('Driver and truck were recorded 320 m apart. Limit: 100 m.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with exception' }))
    expect(screen.getByText('Please provide a reason before continuing.')).toBeInTheDocument()
    expect(onContinue).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Reason for continuing'), { target: { value: 'Truck is parked at the gate.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with exception' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry location' }))

    expect(onContinue).toHaveBeenCalledWith('Truck is parked at the gate.')
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('allows continuation when comparison is unavailable without framing it as a mismatch', () => {
    const { onContinue } = renderNotice({ ...measuredMismatch, proximity: 'unverified', separation_metres: null })

    expect(screen.getByText('We could not compare your location with the truck. Your action can still be recorded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledWith(null)
  })

  it('announces accessible loading and preview failure states without removing continuation', () => {
    const { rerender } = render(
      <LocationCheckNotice assessment={null} loading onRetry={vi.fn()} onContinue={vi.fn()} error={null} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Checking location')

    rerender(<LocationCheckNotice assessment={null} loading={false} error="Preview failed" onRetry={vi.fn()} onContinue={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Location check could not be completed')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })
})
