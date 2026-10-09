import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhaseEvidence } from './PhaseEvidence'
import { mockPrecincts, mockTrips, TRIP_0035_ID } from '@shared/lib/mocks'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { Trip } from '@shared/lib/types/trip'

// PhaseEvidence's unloading/arrival branches end in PhaseOverrideAction, which imports
// lib/api/client -> lib/supabase/client (throws without a real Supabase URL at import
// time) and calls useToast() — mocked the same way TripTimeline.test.tsx isolates itself.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))
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

function tripFor(id: typeof TRIP_0035_ID): Trip {
  const trip = mockTrips.find(candidate => candidate.id === id)
  if (!trip) throw new Error(`fixture ${id} is missing`)
  return trip
}

describe('PhaseEvidence: routing', () => {
  it('routes an arrival phase to ArrivalDetail\'s seal-as-found section', () => {
    const trip = tripFor(TRIP_0035_ID)
    const arrival = trip.phases.find(p => p.phase_type === 'arrival')
    if (!arrival) throw new Error('TRIP_0035 arrival phase is missing')

    render(<PhaseEvidence trip={trip} phase={arrival} precincts={mockPrecincts} {...evidence} />)

    expect(screen.getByText('Seal as found')).toBeInTheDocument()
  })

  it('routes an unloading phase to UnloadingDetail\'s warehouse-scan section, without any seal content', () => {
    const trip = tripFor(TRIP_0035_ID)
    const unloading = trip.phases.find(p => p.phase_type === 'unloading')
    if (!unloading) throw new Error('TRIP_0035 unloading phase is missing')

    render(<PhaseEvidence trip={trip} phase={unloading} precincts={mockPrecincts} {...evidence} />)

    expect(screen.getByText('Warehouse scan')).toBeInTheDocument()
    expect(screen.queryByText('Seal as found')).not.toBeInTheDocument()
  })

  it('hands ArrivalDetail every seal exception recorded on the arrival row, not just the first', () => {
    const base = tripFor(TRIP_0035_ID)
    const arrival = base.phases.find(p => p.phase_type === 'arrival')
    if (!arrival) throw new Error('TRIP_0035 arrival phase is missing')
    const trip: Trip = {
      ...base,
      exceptions: [
        ...base.exceptions,
        {
          id: 'exc-seal-compromised' as Trip['exceptions'][number]['id'],
          trip_id: base.id,
          exception_type: 'seal_compromised',
          source: 'system',
          severity: 'critical',
          description: 'Seal found damaged at arrival.',
          phase_event_id: arrival.phase_event_id,
          checkpoint_id: null,
          supporting_artifact_id: null,
          review_status: 'recorded',
          review_outcome: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          review_note: null,
          contact_method: null,
          vehicle_id: null,
          merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 'exc-seal-mismatch' as Trip['exceptions'][number]['id'],
          trip_id: base.id,
          exception_type: 'seal_mismatch',
          source: 'system',
          severity: 'critical',
          description: 'Seal number does not match departure.',
          phase_event_id: arrival.phase_event_id,
          checkpoint_id: null,
          supporting_artifact_id: null,
          review_status: 'recorded',
          review_outcome: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          review_note: null,
          contact_method: null,
          vehicle_id: null,
          merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
          created_at: '2026-05-01T00:00:01Z',
          updated_at: '2026-05-01T00:00:01Z',
        },
      ],
    }

    render(<PhaseEvidence trip={trip} phase={arrival} precincts={mockPrecincts} {...evidence} />)

    expect(screen.getByText(/seal compromised — recorded as a critical exception/i)).toBeInTheDocument()
    expect(screen.getByText(/mismatch — recorded as a critical exception/i)).toBeInTheDocument()
  })
})
