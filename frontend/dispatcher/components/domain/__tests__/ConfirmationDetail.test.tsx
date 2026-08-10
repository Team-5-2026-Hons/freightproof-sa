import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationDetail } from '../ConfirmationDetail'
import { makePhase } from './testFixtures'

// ConfirmationDetail renders EvidencePhoto for the POD photo, which mounts
// ForensicOnly (via its internal ArtifactProvenance) regardless of content.
// ForensicOnly throws without a real ForensicModeProvider (itself gated on
// useAuth), so it is mocked at the module boundary the same way
// PhaseOverrideAction.test.tsx isolates itself from lib/api/client — this suite is
// about the reconciliation verdict, not the forensic-mode plumbing.
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

    // The driver counts PARCELS, same unit as the scans — so the reason it stays out of
    // the verdict is that it is a blind independent observation, not that it counts
    // something else. Here 1 vs 3 is a flat contradiction of the scan count and STILL
    // must not read as part of the verdict.
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
