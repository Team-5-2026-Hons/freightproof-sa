import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UnloadingDetail } from '../UnloadingDetail'
import { VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
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
        precinct={undefined}
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
        precinct={undefined}
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
        precinct={undefined}
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
        precinct={undefined}
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
        precinct={undefined}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.queryByText(/scan in progress/i)).not.toBeInTheDocument()
  })

  it('uses recorded seal exception severity instead of guessing from phase status', () => {
    render(
      <UnloadingDetail
        sealException={{ exception_type: 'seal_mismatch', severity: 'critical' }}
        phase={{ ...makePhase('unloading'), status: 'exception', seal_number: 'SEAL-A' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/mismatch — recorded as a critical exception/i)).toBeInTheDocument()
  })
})

it('does not turn a missing departure seal into a critical mismatch', () => {
  render(<UnloadingDetail phase={makePhase('unloading', { status: 'exception', seal_number: 'A' })}
    allPhases={[]} artifactsById={NO_ARTIFACTS} precinct={undefined} scannedInCount={4} expectedAtStopCount={3}
    sealException={{ exception_type: 'seal_unverified', severity: 'warning' }} />)
  expect(screen.getByText('Seal continuity unverified')).toBeInTheDocument()
  expect(screen.getByText('1 excess scanned')).toBeInTheDocument()
  expect(screen.queryByText(/critical exception/i)).not.toBeInTheDocument()
})

// Task 3: advance_unloading's schema does not typically capture a fix, so the section
// must appear ONLY when there is something recorded: same three-way split as loading.
describe('UnloadingDetail: location section', () => {
  it('shows no location heading when neither a fix nor a stored verdict is recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed' })}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.queryByText('Location at unloading')).not.toBeInTheDocument()
  })

  it('shows the heading and the comparison disclosure when a driver fix was recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed', driver_phone_lat: -33.9249, driver_phone_lng: 18.4241 })}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.getByText('Location at unloading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('shows the heading and the stored verdict, with no "View on map" button, when only a verdict was recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed', pulsit_geofence_confirmed: false })}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.getByText('Location at unloading')).toBeInTheDocument()
    expect(screen.getByText('Truck outside precinct tolerance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: VIEW_ON_MAP_LABEL })).not.toBeInTheDocument()
  })
})
