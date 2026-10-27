import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationDetail } from '../ConfirmationDetail'
import { makePhase } from './testFixtures'

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

describe('ConfirmationDetail', () => {
  it('shows the origin-vs-destination verdict', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_origin: 3,
          parcel_count_destination: 3,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/counts agree/i)).toBeInTheDocument()
  })

  it('flags a parcel lost in transit', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_destination: 2,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/1 parcel unaccounted for/i)).toBeInTheDocument()
  })

  it('pluralises the unaccounted count', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_destination: 1,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/2 parcels unaccounted for/i)).toBeInTheDocument()
  })

  it('marks the driver parcel count as recorded, not checked', () => {
    render(
      <ConfirmationDetail
        phase={{
          ...makePhase('confirmation'),
          parcel_count_destination: 3,
          driver_visual_count: 1,
        }}
        originScannedCount={3}
      />,
    )

    expect(screen.getByText(/not reconciled against the scans/i)).toBeInTheDocument()
    expect(screen.getByText('Parcels counted by driver')).toBeInTheDocument()
  })

  it('labels the POD signature as the cryptographic signature, not a generic document', () => {
    render(
      <ConfirmationDetail
        phase={makePhase('confirmation')}
        originScannedCount={null}
      />,
    )

    expect(screen.getByText('POD signature (Ed25519)')).toBeInTheDocument()
  })

  it('does not render an anchor status section', () => {
    render(
      <ConfirmationDetail
        phase={makePhase('confirmation')}
        originScannedCount={null}
      />,
    )

    expect(screen.queryByText('Anchor')).not.toBeInTheDocument()
  })
})

it('labels excess destination scans without claiming negative missing parcels', () => {
  render(<ConfirmationDetail phase={makePhase('confirmation', { parcel_count_destination: 5 })} originScannedCount={3} />)
  expect(screen.getByText('2 excess parcels scanned at destination')).toBeInTheDocument()
  expect(screen.queryByText(/-2 parcel/)).not.toBeInTheDocument()
})
