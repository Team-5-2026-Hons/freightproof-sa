import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExceptionEvidence } from '../ExceptionEvidence'
import type { TripException } from '@shared/lib/types/exception'

// ExceptionEvidence imports EvidencePhoto, whose forensic gate reaches AuthContext.
// This component-only test never renders a photo, but the module graph still needs the
// same minimal Supabase client used by the neighbouring dispatcher component tests.
import { vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
}))

function exceptionWithAssessment(
  assessment: NonNullable<TripException['action_location_assessment']>,
): Pick<TripException, 'gps_lat' | 'gps_lng' | 'supporting_artifact_id' | 'action_location_assessment'> {
  return {
    gps_lat: null,
    gps_lng: null,
    supporting_artifact_id: null,
    action_location_assessment: assessment,
  }
}

const assessmentBase = {
  schema_version: 1 as const,
  policy_version: 'test-policy',
  evaluated_at: '2026-09-15T10:00:00Z',
  driver_lat: -26.0942,
  driver_lng: 28.1342,
  driver_captured_at: '2026-09-15T09:59:00Z',
  driver_accuracy_metres: 5,
  tracker_lat: -26.1042,
  tracker_lng: 28.1442,
  tracker_captured_at: '2026-09-15T09:59:10Z',
  separation_metres: 1500,
  max_separation_metres: 100,
  max_age_seconds: 60,
  max_skew_seconds: 30,
  max_phone_accuracy_metres: 50,
  expected_trip_stop_id: null,
  precinct_id: null,
  precinct_lat: null,
  precinct_lng: null,
  precinct_radius_metres: null,
  precinct_tolerance_metres: null,
  driver_in_precinct: null,
  truck_in_precinct: null,
}

describe('ExceptionEvidence', () => {
  it('renders the stored separated system comparison without requiring a GPS or photo field', () => {
    render(
      <ExceptionEvidence
        exception={exceptionWithAssessment({ ...assessmentBase, proximity: 'separated', reasons: [] })}
      />,
    )

    expect(screen.getByText('System comparison')).toBeInTheDocument()
    expect(screen.getByText('Driver and vehicle locations were separated')).toBeInTheDocument()
  })

  it('renders an unverified system comparison with the recorded reason', () => {
    render(
      <ExceptionEvidence
        exception={exceptionWithAssessment({
          ...assessmentBase,
          tracker_lat: null,
          tracker_lng: null,
          tracker_captured_at: null,
          separation_metres: null,
          proximity: 'unverified',
          reasons: ['missing_tracker'],
        })}
      />,
    )

    expect(screen.getByText('Location comparison unverified (missing_tracker)')).toBeInTheDocument()
  })
})
