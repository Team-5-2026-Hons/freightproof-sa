import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TripTimeline } from './TripTimeline'
import { mockPrecincts, mockTrips, TRIP_0035_ID, TRIP_0043_ID } from '@shared/lib/mocks'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'

// PhaseEvidence's collapsed-content chain eventually reaches PhaseOverrideAction, which
// imports lib/api/client -> lib/supabase/client, and that module calls createClient() at
// import time; it throws without a real Supabase URL. Mocked the same way
// app/(app)/trips/[id]/page.test.tsx isolates itself, since these tests never open a row
// (the summary chip is asserted collapsed) but the import still resolves eagerly.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicOnly needs a real ForensicModeProvider (itself gated on useAuth) to render at
// all: mocked at the module boundary the same way every other domain detail-panel suite
// isolates itself, since this file is about the summary chip, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

const evidence = {
  artifactsById: NO_ARTIFACTS,
  artifactLoading: false,
  artifactError: null,
  onRetryArtifacts: vi.fn(),
  onChanged: vi.fn(),
}

function tripFor(id: typeof TRIP_0035_ID | typeof TRIP_0043_ID): Trip {
  const trip = mockTrips.find(candidate => candidate.id === id)
  if (!trip) throw new Error(`fixture ${id} is missing`)
  return trip
}

function phaseRow(phaseName: string) {
  return within(screen.getByRole('group', { name: `${phaseName} phase` }))
}

describe('TripTimeline: compact location verdict', () => {
  // TRP-2026-0035 is closed with every phase walked through to completed: a stable base
  // for asserting on a `done` node's summary row without any card being expanded (closed
  // trips never auto-open a row: initialOpen requires an active phase, and a terminal
  // trip has none).
  it('shows the stored-verdict chip on a completed activation row, visible WITHOUT expanding the card', () => {
    const base = tripFor(TRIP_0035_ID)
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_type === 'activation' ? { ...p, pulsit_geofence_confirmed: true } : p),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // Asserted before any click: the chip must already be in the document as rendered.
    expect(phaseRow('Activation').getByText('Within accepted tolerance')).toBeInTheDocument()
  })

  it('shows no location chip on a completed loading row with no fix and no stored verdict (LoadingDetail gates its own section on the exact same hasLocationEvidence check, so the chip must never advertise a section the opened card does not have)', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const verdictLabels = ['Within accepted tolerance', 'Outside accepted tolerance', 'Not verified', 'Not checked yet', 'No geofence verdict is recorded for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Loading').queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows the stored outside-tolerance chip on a loading row once a verdict is actually recorded', () => {
    const base = tripFor(TRIP_0035_ID)
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_type === 'loading' ? { ...p, pulsit_geofence_confirmed: false } : p),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    expect(phaseRow('Loading').getByText('Outside accepted tolerance')).toBeInTheDocument()
  })

  it('shows no location chip on trip_creation or in_transit rows, even when they are done', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // Every verdict label this summary could ever render: none may appear in either row.
    const verdictLabels = ['Within accepted tolerance', 'Outside accepted tolerance', 'Not verified', 'Not checked yet', 'No geofence verdict is recorded for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Trip Created').queryByText(label)).not.toBeInTheDocument()
      expect(phaseRow('In Transit').queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows no location chip on a pending phase', () => {
    const trip = tripFor(TRIP_0043_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const verdictLabels = ['Within accepted tolerance', 'Outside accepted tolerance', 'Not verified', 'Not checked yet', 'No geofence verdict is recorded for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Activation').queryByText(label)).not.toBeInTheDocument()
    }
  })
})

describe('TripTimeline: gps_mismatch exception evidence', () => {
  it('renders the honest trigger text inside a linked activation exception\'s supporting evidence', () => {
    const base = tripFor(TRIP_0035_ID)
    const activation = base.phases.find(p => p.phase_type === 'activation')
    if (!activation) throw new Error('TRIP_0035 activation phase is missing')

    const gpsMismatch: TripException = {
      id: 'gps-mismatch-activation' as TripException['id'],
      trip_id: base.id,
      exception_type: 'gps_mismatch',
      source: 'system',
      severity: 'warning',
      description: 'Vehicle tracker placed the vehicle outside the activation geofence.',
      phase_event_id: activation.phase_event_id,
      checkpoint_id: null,
      supporting_artifact_id: null,
      review_status: 'recorded',
      review_outcome: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      review_note: null,
      contact_method: null,
      // A gps_mismatch is not a breakdown, so it names no vehicle (trailer analytics, dev).
      vehicle_id: null,
      merkle_batch_id: null,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    }
    const trip: Trip = { ...base, exceptions: [...base.exceptions, gpsMismatch] }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // The row's own aria-label gains " and exceptions" once it carries one (see
    // TripTimeline's own group label logic), so it is looked up by that full name here,
    // unlike the plain "Activation phase" rows in the describe block above.
    const activationRow = within(screen.getByRole('group', { name: 'Activation phase and exceptions' }))
    expect(activationRow.getByTestId('gps-mismatch-trigger')).toHaveTextContent('Vehicle tracker outside the facility boundary')
  })
})
