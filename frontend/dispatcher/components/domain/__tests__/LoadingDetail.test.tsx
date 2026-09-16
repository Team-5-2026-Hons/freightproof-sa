import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadingDetail } from '../LoadingDetail'
import { VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
import { makePhase } from './testFixtures'
import type { ArtifactId, EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// LoadingDetail now renders EvidencePhoto for the linehaul document, which mounts
// ForensicOnly for any artifact with provenance to show. ForensicOnly needs a real
// ForensicModeProvider (itself gated on useAuth) to render at all — mocked at the
// module boundary the same way ConfirmationDetail.test.tsx and UnloadingDetail.test.tsx
// isolate themselves, since this suite is about the warehouse-scan verdict and the
// linehaul document presence, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

describe('LoadingDetail', () => {
  it('shows the stamped count once the phase is resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Scanned onto truck')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags a short scan once resolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: 2 }}
        expectedCount={3}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows no verdict when there is no manifest baseline', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', parcel_count_origin: null }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
  })

  // Regression guard for the live/stamped distinction: while the phase is still open,
  // the panel must show the LIVE scanned_out_count, not the (not-yet-final) stamped
  // parcel_count_origin, and must label it differently so a viewer can tell the two
  // apart on screen.
  it('shows the live count, distinctly labelled, while the phase is unresolved', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: null }}
        expectedCount={3}
        liveScannedOutCount={2}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Scanned onto truck (in progress)')).toBeInTheDocument()
    expect(screen.queryByText('Scanned onto truck')).not.toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('ignores a stray stamped figure while unresolved and reads the live count instead', () => {
    render(
      <LoadingDetail
        // parcel_count_origin should never be non-null on an unresolved row in practice,
        // but the component must still prefer the live figure if it somehow is.
        phase={{ ...makePhase('loading'), status: 'in_progress', parcel_count_origin: 9 }}
        expectedCount={3}
        liveScannedOutCount={1}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('9')).not.toBeInTheDocument()
  })

  it('shows the linehaul document photographed at loading', () => {
    const artifact: EvidenceArtifactWithUrl = {
      id: 'artifact-1' as ArtifactId,
      trip_id: 'trip-1',
      artifact_type: 'photo',
      s3_key: 'key',
      s3_bucket: 'bucket',
      file_hash: 'abc123',
      mime_type: 'image/jpeg',
      captured_at: '2026-01-01T00:00:00Z',
      captured_by_driver_id: null,
      captured_by_user_id: null,
      captured_lat: null,
      captured_lng: null,
      created_at: '2026-01-01T00:00:00Z',
      signed_url: 'https://example.test/artifact-1',
    }
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'completed', linehaul_photo_artifact_id: 'artifact-1' }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={new Map([['artifact-1', artifact]])}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Linehaul document')).toBeInTheDocument()
    expect(screen.getByAltText('Linehaul document')).toBeInTheDocument()
  })

  it('shows not captured when no linehaul document has been photographed yet', () => {
    render(
      <LoadingDetail
        phase={{ ...makePhase('loading'), status: 'in_progress', linehaul_photo_artifact_id: null }}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Linehaul document')).toBeInTheDocument()
    expect(screen.getByText('Not captured')).toBeInTheDocument()
  })
})

it('labels an excess scan without a negative shortage', () => {
  render(<LoadingDetail phase={makePhase('loading')} expectedCount={3} liveScannedOutCount={5} artifactsById={NO_ARTIFACTS} precinct={undefined} />)
  expect(screen.getByText('2 excess scanned')).toBeInTheDocument()
  expect(screen.queryByText(/-2 not scanned/)).not.toBeInTheDocument()
})

// Task 3: loading is system-observed and most rows never carry a fix at all, so the
// section must appear ONLY when there is something to show it: hasLocationEvidence's
// three-way split, exercised end to end through the rendered component.
describe('LoadingDetail: location section', () => {
  it('shows no location heading when neither a fix nor a stored verdict is recorded', () => {
    render(
      <LoadingDetail
        phase={makePhase('loading', { status: 'completed' })}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.queryByText('Location at loading')).not.toBeInTheDocument()
  })

  it('shows the heading and the comparison disclosure when a driver fix was recorded', () => {
    render(
      <LoadingDetail
        phase={makePhase('loading', { status: 'completed', driver_phone_lat: -33.9249, driver_phone_lng: 18.4241 })}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Location at loading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('shows the heading and the stored verdict, with no "View on map" button, when only a verdict was recorded', () => {
    render(
      <LoadingDetail
        phase={makePhase('loading', { status: 'completed', pulsit_geofence_confirmed: false })}
        expectedCount={null}
        liveScannedOutCount={null}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Location at loading')).toBeInTheDocument()
    expect(screen.getByText('Truck outside precinct tolerance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: VIEW_ON_MAP_LABEL })).not.toBeInTheDocument()
  })
})
