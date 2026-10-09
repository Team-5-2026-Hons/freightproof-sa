import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArrivalDetail } from '../ArrivalDetail'
import { makePhase } from './testFixtures'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// ArrivalDetail renders EvidencePhoto, which mounts ForensicOnly for any artifact with
// provenance to show — mocked at the module boundary the same way UnloadingDetail's own
// suite isolates itself, since this suite is about the seal-as-found record, not
// forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

describe('ArrivalDetail: seal as found', () => {
  it('reads the recorded seal number and condition', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'completed', seal_number: 'SEAL-ARR', seal_condition: 'intact' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-DEP', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('SEAL-ARR')).toBeInTheDocument()
    expect(screen.getByText('SEAL-DEP')).toBeInTheDocument()
    expect(screen.getByText('Intact')).toBeInTheDocument()
  })

  it('shows the seals-match verdict when the arrival seal matches this leg\'s departure seal', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'completed', seal_number: 'SEAL-A', seal_condition: 'intact' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
      />,
    )

    expect(screen.getByText('Recorded seals match ✓')).toBeInTheDocument()
  })

  it('shows "No seal present" instead of a seal number when the seal itself is missing', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: null, seal_condition: 'missing' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[{ exception_type: 'seal_compromised', severity: 'critical' }]}
      />,
    )

    expect(screen.getByText('No seal present')).toBeInTheDocument()
    expect(screen.queryByText('SEAL-A')).toBeInTheDocument() // departure seal still shown for comparison
  })

  it('reports a mismatch as its own critical finding', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: 'SEAL-B', seal_condition: 'intact' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[{ exception_type: 'seal_mismatch', severity: 'critical' }]}
      />,
    )

    expect(screen.getByText(/mismatch — recorded as a critical exception/i)).toBeInTheDocument()
  })

  it('reports a damaged seal as a compromised finding', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: 'SEAL-A', seal_condition: 'damaged' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[{ exception_type: 'seal_compromised', severity: 'critical' }]}
      />,
    )

    expect(screen.getByText('Damaged')).toBeInTheDocument()
    expect(screen.getByText(/seal compromised — recorded as a critical exception/i)).toBeInTheDocument()
  })

  it('reports a missing seal as a compromised finding', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: null, seal_condition: 'missing' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[{ exception_type: 'seal_compromised', severity: 'critical' }]}
      />,
    )

    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText(/seal compromised — recorded as a critical exception/i)).toBeInTheDocument()
  })

  it('shows both findings when a seal is compromised AND its number does not match', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: 'SEAL-B', seal_condition: 'damaged' }}
        allPhases={[{ ...makePhase('departure'), sequence_number: 0, seal_number: 'SEAL-A', status: 'completed' }]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[
          { exception_type: 'seal_compromised', severity: 'critical' },
          { exception_type: 'seal_mismatch', severity: 'critical' },
        ]}
      />,
    )

    expect(screen.getByText(/seal compromised — recorded as a critical exception/i)).toBeInTheDocument()
    expect(screen.getByText(/mismatch — recorded as a critical exception/i)).toBeInTheDocument()
  })

  it('does not turn a missing departure seal into a critical mismatch', () => {
    render(
      <ArrivalDetail
        phase={{ ...makePhase('arrival'), status: 'exception', seal_number: 'SEAL-A', seal_condition: 'intact' }}
        allPhases={[]}
        artifactsById={NO_ARTIFACTS}
        precinct={undefined}
        sealExceptions={[{ exception_type: 'seal_unverified', severity: 'warning' }]}
      />,
    )

    expect(screen.getByText('Seal continuity unverified')).toBeInTheDocument()
    expect(screen.queryByText(/critical exception/i)).not.toBeInTheDocument()
  })
})
