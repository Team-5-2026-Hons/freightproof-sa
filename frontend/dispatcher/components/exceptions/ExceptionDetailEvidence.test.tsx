import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExceptionDetailEvidence } from './ExceptionDetailEvidence'
import type { TripExceptionDetail } from '@shared/lib/types/exception'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import { locationEvidenceForAssessment } from '@/lib/phase/location-evidence'
const panel = vi.hoisted(() => vi.fn())
vi.mock('@/components/domain/LocationEvidencePanel', () => ({ LocationEvidencePanel: (props: object) => { panel(props); return <div>Recorded comparison</div> } }))
vi.mock('@/components/domain/EvidencePhoto', () => ({ EvidencePhoto: ({artifactId}: {artifactId: string}) => <div>Recorded artifact {artifactId}</div> }))
const base = { gps_lat: null, gps_lng: null, action_location_assessment: null, supporting_artifact_id: null, supporting_artifact: null, exception_type: 'gps_mismatch', created_at: '2026-10-01T22:00:00Z' } satisfies Pick<TripExceptionDetail,'gps_lat'|'gps_lng'|'action_location_assessment'|'supporting_artifact_id'|'supporting_artifact'|'exception_type'|'created_at'>
const snapshot: ActionLocationAssessment = { schema_version:1, policy_version:'recorded-v1', evaluated_at:'2026-10-01T10:00:00Z', driver_lat:-33.9,driver_lng:18.4,driver_captured_at:'2026-10-01T09:59:00Z',driver_accuracy_metres:5,tracker_lat:-33.91,tracker_lng:18.41,tracker_captured_at:null,separation_metres:1300,proximity:'separated',reasons:[],max_separation_metres:200,max_age_seconds:120,max_skew_seconds:60,max_phone_accuracy_metres:50,expected_trip_stop_id:null,precinct_id:null,precinct_lat:-33.9,precinct_lng:18.4,precinct_radius_metres:100,precinct_tolerance_metres:10,driver_in_precinct:true,truck_in_precinct:false }
describe('honest detail evidence', () => {
  it('keeps lone GPS separate from comparison and capture time', () => {
    render(<ExceptionDetailEvidence exception={{...base,gps_lat:-33.9,gps_lng:18.4}} />)
    expect(screen.getByText('Recorded exception location')).toBeInTheDocument()
    expect(screen.getByText(/comparison unavailable/)).toBeInTheDocument()
    expect(screen.queryByText('Recorded comparison')).not.toBeInTheDocument()
    expect(screen.getByText(/Exception raised 02 Oct 2026/)).toBeInTheDocument()
  })
  it('passes only the historical snapshot to the recorded helper', () => {
    render(<ExceptionDetailEvidence exception={{...base,action_location_assessment:snapshot}} />)
    expect(panel).toHaveBeenLastCalledWith(expect.objectContaining({evidence:locationEvidenceForAssessment(snapshot,undefined)}))
    expect(screen.getByText('200 m')).toBeInTheDocument()
  })
  it('distinguishes a recorded artifact from no supporting data', () => {
    const view=render(<ExceptionDetailEvidence exception={base} />)
    expect(screen.getByText('No supporting photo or location recorded for this exception.')).toBeInTheDocument()
    view.rerender(<ExceptionDetailEvidence exception={{...base,supporting_artifact_id:'photo'}} />)
    expect(screen.getByText('Recorded artifact photo')).toBeInTheDocument()
    expect(screen.queryByText('No supporting photo or location recorded for this exception.')).not.toBeInTheDocument()
  })
})
