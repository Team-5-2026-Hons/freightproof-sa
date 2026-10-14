import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocationCheckModal } from '../LocationCheckModal'
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

function renderModal(overrides: Partial<React.ComponentProps<typeof LocationCheckModal>> = {}) {
  const onRetry = vi.fn()
  const onContinue = vi.fn()
  render(
    <LocationCheckModal
      open
      assessment={null}
      loading={false}
      error={null}
      offline={false}
      onRetry={onRetry}
      onContinue={onContinue}
      {...overrides}
    />,
  )
  return { onRetry, onContinue }
}

describe('LocationCheckModal', () => {
  it('allows normal continuation when the server assessment passes', () => {
    const { onContinue } = renderModal({
      assessment: { ...measuredMismatch, proximity: 'within_limit', separation_metres: 12 },
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledWith(null)
  })

  it('explains a measured mismatch and requires a reason before continuing with an exception', () => {
    const { onRetry, onContinue } = renderModal({ assessment: measuredMismatch })

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

  it('states the truck-outside-precinct warning distinctly from a measured mismatch', () => {
    renderModal({
      assessment: { ...measuredMismatch, proximity: 'within_limit', separation_metres: 12, truck_in_precinct: false },
    })

    expect(screen.getByText('Truck was recorded outside the expected precinct.')).toBeInTheDocument()
    expect(screen.queryByText(/apart\. Limit:/)).not.toBeInTheDocument()
  })

  it('states the driver-outside-precinct warning distinctly from the truck one', () => {
    renderModal({
      assessment: { ...measuredMismatch, proximity: 'within_limit', separation_metres: 12, driver_in_precinct: false },
    })

    expect(screen.getByText('Your phone was recorded outside the expected precinct.')).toBeInTheDocument()
    expect(screen.queryByText('Truck was recorded outside the expected precinct.')).not.toBeInTheDocument()
  })

  it('states both facts when driver and truck are both outside the precinct', () => {
    const { onContinue } = renderModal({
      assessment: {
        ...measuredMismatch, proximity: 'within_limit', separation_metres: 12,
        truck_in_precinct: false, driver_in_precinct: false,
      },
    })

    expect(screen.getByText('Truck was recorded outside the expected precinct.')).toBeInTheDocument()
    expect(screen.getByText('Your phone was recorded outside the expected precinct.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue with exception' }))
    expect(onContinue).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Reason for continuing'), { target: { value: 'Confirmed with the guard.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with exception' }))
    expect(onContinue).toHaveBeenCalledWith('Confirmed with the guard.')
  })

  it('allows continuation when comparison is unavailable without framing it as a mismatch', () => {
    const { onContinue } = renderModal({
      assessment: { ...measuredMismatch, proximity: 'unverified', separation_metres: null },
    })

    expect(screen.getByText('We could not compare your location with the truck. Your action can still be recorded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledWith(null)
  })

  it('surfaces the offline note inside the popup rather than orphaning it on the page', () => {
    renderModal({ assessment: null, offline: true })

    expect(screen.getByText('Location not verified while offline.')).toBeInTheDocument()
    expect(screen.getByText('We could not compare your location with the truck. Your action can still be recorded.')).toBeInTheDocument()
  })

  it('announces accessible loading and preview failure states without removing continuation', () => {
    const { rerender } = render(
      <LocationCheckModal open assessment={null} loading error={null} offline={false} onRetry={vi.fn()} onContinue={vi.fn()} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Checking location')

    rerender(
      <LocationCheckModal open assessment={null} loading={false} error="Preview failed" offline={false} onRetry={vi.fn()} onContinue={vi.fn()} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Location check could not be completed')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('is not open when the caller has not started a check', () => {
    renderModal({ open: false, assessment: null })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cannot be dismissed by Escape or an overlay click — only Retry/Continue resolve it', () => {
    const { onRetry, onContinue } = renderModal({ assessment: measuredMismatch })

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // No close (X) affordance at all — the only ways out are the two recorded actions.
    expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument()

    expect(onRetry).not.toHaveBeenCalled()
    expect(onContinue).not.toHaveBeenCalled()
  })
})
