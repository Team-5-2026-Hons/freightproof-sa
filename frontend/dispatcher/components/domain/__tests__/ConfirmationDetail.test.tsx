import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationDetail } from '../ConfirmationDetail'
import { makePhase } from './testFixtures'

// ConfirmationDetail still renders PhaseAnchorSection (retained — see the call site
// note in ConfirmationDetail.tsx), which always mounts ForensicOnly regardless of
// content. ForensicOnly throws without a real ForensicModeProvider (itself gated on
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

  it('marks the driver pallet count as recorded, not checked', () => {
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

    // Pallet grain vs parcel grain — it must never read as part of the verdict.
    expect(screen.getByText(/recorded, not reconciled/i)).toBeInTheDocument()
  })
})
