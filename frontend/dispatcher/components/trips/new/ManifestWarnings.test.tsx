import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeWarning } from '@/lib/trips/__fixtures__/preview'
import { ManifestWarnings } from './ManifestWarnings'

describe('ManifestWarnings', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<ManifestWarnings warnings={[]} onEmptyLeg={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links to our own trip that already holds the manifest', () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('MANIFEST_ALREADY_ON_TRIP', {
          message: 'Manifest CPT 81 is already on trip FP-20261001-AAAA0001.',
          trip_id: 'trip-old', trip_reference: 'FP-20261001-AAAA0001',
        })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This manifest cannot become a trip')
    expect(within(alert).getByRole('link', { name: /Open FP-20261001-AAAA0001/ })).toHaveAttribute('href', '/trips/trip-old')
  })

  it("names held waybills but never another organisation's trip", () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('WAYBILL_ON_OTHER_TRIP', { message: '1 waybill(s) are already on another trip.', waybills: ['WAY001'] })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    expect(screen.getByText('WAY001')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers an empty leg for a manifest with no waybills', () => {
    const onEmptyLeg = vi.fn()
    render(<ManifestWarnings warnings={[makeWarning('NO_WAYBILLS')]} onEmptyLeg={onEmptyLeg} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create an empty leg instead' }))

    expect(onEmptyLeg).toHaveBeenCalled()
  })

  it('lists an informational notice apart from blocking warnings, without an alert', () => {
    render(
      <ManifestWarnings
        warnings={[makeWarning('MANIFEST_NOT_CLOSED', { message: 'The manifest is still open.' })]}
        onEmptyLeg={vi.fn()}
      />,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Manifest notices' })).getByText(/still open/)).toBeInTheDocument()
  })

  it('leaves prompts the form answers to the form', () => {
    const { container } = render(
      <ManifestWarnings
        warnings={[makeWarning('ORIGIN_HUB_UNLINKED'), makeWarning('DESTINATION_HUB_UNLINKED'), makeWarning('NO_PLANNED_TIMES')]}
        onEmptyLeg={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
