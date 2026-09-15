import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InTransitTimeline } from '../InTransitTimeline'
import { makePhase } from './testFixtures'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'

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
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
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
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
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
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(screen.getByText('Within accepted tolerance')).toBeInTheDocument()
  })
})

// Task 9: this leg must never claim a continuous live route or invent a specific
// future integration (weighbridges, checkpoints) — the honest, generic absence line
// replaces that developer-facing prose.
describe('InTransitTimeline: honest scope line', () => {
  it('shows the generic honest-absence line rather than naming a specific future integration', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { status: 'completed', completed_at: '2026-01-02T00:00:00Z' })}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Only recorded journey events are shown.')).toBeInTheDocument()
    expect(screen.queryByText(/Pulsit integration/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Weighbridges, driver and vehicle changes/)).not.toBeInTheDocument()
  })
})

// Task 9 review round 1: departure/arrival facts moved entirely to
// TransitJourneySummary (rendered outside disclosure by TripTimeline as
// PhaseTimelineItem's persistentContent). This component's own expanded body must
// never repeat them — the bug the review caught was exactly that: an expanded (or
// always-open driving) leg showed "Departed X" / "En route to Y" / "Arrived Y" twice,
// once here and once in the summary.
describe('InTransitTimeline: no departure/arrival rendering of its own', () => {
  it('names no departure or arrival fact for a leg that has not yet departed', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { status: 'pending', completed_at: null })}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.queryByText(/Awaiting departure/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Departed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/En route to/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
  })

  it('names no departure or arrival fact for a completed leg either', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { status: 'completed', completed_at: '2026-01-02T00:00:00Z' })}
        exceptions={[]}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.queryByText(/Departed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/En route to/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
  })
})

// Task 9 review round 1: the compact time/label/severity markers now live in
// TransitJourneySummary, not here — the full detail this body still owns for an
// exception (severity, source, review status, artifacts) must render without ever
// re-adding a departure/arrival line alongside it.
describe('InTransitTimeline: full exception detail, no departure/arrival alongside it', () => {
  it('renders full per-exception evidence for an exception scoped to this leg, without any departure/arrival wording', () => {
    const exception: TripException = {
      id: 'exc-1' as ExceptionId,
      trip_id: 'trip-1',
      exception_type: 'panic_button',
      source: 'driver',
      severity: 'critical',
      description: 'Driver reported feeling unsafe at a roadside stop.',
      phase_event_id: 'phase-event-1',
      checkpoint_id: null,
      supporting_artifact_id: null,
      review_status: 'recorded',
      review_outcome: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      review_note: null,
      contact_method: null,
      vehicle_id: null,
      merkle_batch_id: null,
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }

    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { status: 'completed', completed_at: '2026-01-02T04:00:00Z' })}
        exceptions={[exception]}
        artifactsById={NO_ARTIFACTS}
      />,
    )

    expect(screen.getByText('Panic Button')).toBeInTheDocument()
    expect(screen.getByText('Driver reported feeling unsafe at a roadside stop.')).toBeInTheDocument()
    expect(screen.queryByText(/Departed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
  })
})
