import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UnloadingDetail } from '../UnloadingDetail'
import { makePhase } from './testFixtures'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// UnloadingDetail renders EvidencePhoto, which mounts ForensicOnly for any artifact
// with provenance to show. ForensicOnly needs a real ForensicModeProvider (itself
// gated on useAuth, which needs a real Supabase client) to render at all — mocked at
// the module boundary the same way ConfirmationDetail.test.tsx isolates itself, since
// this suite is about the warehouse-scan live/stamped split, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

describe('UnloadingDetail', () => {
  it('shows the live scanned-in count and the short-scan verdict', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={2}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText('Scanned off truck (live)')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows the all-scanned verdict when the live count meets the manifest baseline', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'completed' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/all parcels scanned/i)).toBeInTheDocument()
  })

  // Null is not zero: a stop with no consignments booked to arrive there must read as
  // "not recorded", never as "0 parcels" — LoadingDetail's own treatment, mirrored here.
  it('shows nothing scanned as unrecorded, not zero, when no consignments are booked at this stop', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/all parcels scanned/i)).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('notes the scan is in progress while unloading is still open', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={1}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/scan in progress/i)).toBeInTheDocument()
  })

  it('drops the in-progress note once the phase resolves', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'completed' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.queryByText(/scan in progress/i)).not.toBeInTheDocument()
  })

  it('leaves the seal verdict untouched — derived from phase.status, not recomputed', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'exception', seal_number: 'SEAL-A' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/mismatch — recorded as a critical exception/i)).toBeInTheDocument()
  })
})
