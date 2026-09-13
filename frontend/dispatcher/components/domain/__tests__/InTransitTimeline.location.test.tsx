import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InTransitTimeline } from '../InTransitTimeline'
import { makePhase } from './testFixtures'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// InTransitTimeline renders ExceptionEvidence per exception node, which mounts
// EvidencePhoto/ForensicOnly for any artifact with provenance to show. ForensicOnly
// needs a real ForensicModeProvider (itself gated on useAuth, which needs a real
// Supabase client) to render at all; mocked at the module boundary the same way the
// other domain detail-panel suites isolate themselves, since this file is about the
// recorded-location section, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

// Task 3: the arrival fix is shown, but the ABSENCE of a destination verdict is the
// required behaviour: an in-transit leg's stop is its ORIGIN, so drawing a boundary
// against an arrival fix would compare it to the wrong fence (see the brief's binding
// rule). These tests exercise that through the rendered component, not just the model.
describe('InTransitTimeline: recorded location at arrival', () => {
  it('shows no location heading when no fix was recorded', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { status: 'completed', completed_at: '2026-01-02T00:00:00Z' })}
        allPhases={[]}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
        originName="Cape Town DC"
        destinationName="Durban DC"
      />,
    )

    expect(screen.queryByText('Recorded location at arrival')).not.toBeInTheDocument()
  })

  it('shows the heading and the explicit no-verdict line, with no boundary, when a driver fix was recorded', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', {
          status: 'completed',
          completed_at: '2026-01-02T00:00:00Z',
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
        })}
        allPhases={[]}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
        originName="Cape Town DC"
        destinationName="Durban DC"
      />,
    )

    expect(screen.getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(screen.getByText('No geofence verdict is recorded for transit legs')).toBeInTheDocument()
    // No precinct is ever passed for this section (see the component's own comment on
    // why), so the boundary reads as explicitly absent, never as a drawn reference.
    expect(screen.getByText('No boundary recorded for this phase')).toBeInTheDocument()
  })

  // A stored verdict always wins, even on a transit leg (verdictFor's documented rule):
  // this is the one case where the section would legitimately show something other than
  // the "no verdict for transit" line, so it is worth confirming it still renders sanely.
  it('honours a stored verdict on a transit leg rather than forcing the transit default', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', {
          status: 'completed',
          completed_at: '2026-01-02T00:00:00Z',
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          pulsit_geofence_confirmed: true,
        })}
        allPhases={[]}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
        originName="Cape Town DC"
        destinationName="Durban DC"
      />,
    )

    expect(screen.getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(screen.getByText('Within accepted tolerance')).toBeInTheDocument()
  })
})
