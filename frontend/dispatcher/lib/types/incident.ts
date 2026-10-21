// Mirrors backend/app/schemas/incidents.py. Kept in this app rather than @shared: only the
// dispatcher runs investigations; the driver app never sees an incident (a hijacked phone
// must not learn one was reported).

import type { TripStatus } from '@shared/lib/types/trip'
import type { ExceptionReviewStatus, ExceptionSeverity, ExceptionType } from '@shared/lib/types/exception'
import type { IncidentDeclaration } from './auditPack'

export type IncidentType = 'hijacking' | 'parcel_shortage' | 'parcel_damage'
export type IncidentStatus = 'open' | 'investigating' | 'closed'
export type IncidentConfidence = 'suspected' | 'reported' | 'corroborated'
export type IncidentReporterRole =
  | 'driver' | 'client' | 'receiver' | 'tracking_company' | 'police' | 'operator_staff' | 'freightproof' | 'other'
export type IncidentReportChannel = 'phone' | 'whatsapp' | 'email' | 'in_person' | 'in_app'
export type IncidentOutcome =
  | 'recording_error' | 'cargo_recovered' | 'partial_recovery' | 'shortage_confirmed'
  | 'damage_confirmed' | 'theft_reported' | 'inconclusive'
export type IncidentUpdateKind =
  | 'opened' | 'note' | 'status_changed' | 'assigned' | 'confidence_changed' | 'exception_linked'
  | 'parcel_added' | 'parcel_finding' | 'external_action' | 'document_attached' | 'trip_stopped'
  | 'closed' | 'reopened'
export type ParcelFinding = 'located' | 'confirmed_missing' | 'damage_confirmed' | 'recording_error'
export type IncidentExternalAction =
  | 'tracking_company_alerted' | 'saps_reported' | 'insurer_notified' | 'client_notified'
  | 'driver_welfare_check' | 'recovery_reported' | 'other'
export type ParcelScanState = 'scanned_in' | 'no_scan_in_recorded' | 'no_scan_recorded'
export type ResponseStepKey =
  | 'trip_stopped' | 'tracking_company_alerted' | 'saps_reported' | 'insurer_notified'
  | 'client_notified' | 'driver_welfare_check' | 'audit_pack_issued'
export type ResponseStepState = 'done' | 'in_progress' | 'todo' | 'not_applicable'

/** The close response's warning when theft is reported with no CAS number on record. */
export const THEFT_REPORTED_WITHOUT_CAS = 'theft_reported_without_cas'

export interface IncidentCreate {
  incident_type: IncidentType
  summary: string
  reported_by_name: string | null
  reporter_role: IncidentReporterRole
  report_channel: IncidentReportChannel
  reported_occurred_at: string | null
  received_at: string | null
  confidence: IncidentConfidence
  assigned_to_user_id: string | null
  exception_ids: string[]
  parcel_ids: string[]
  all_parcels: boolean
  stop_trip: boolean
}

export type IncidentUpdateCreate =
  | { kind: 'note'; note: string; exception_id?: string | null; phase_event_id?: string | null; parcel_id?: string | null }
  | { kind: 'status_changed'; status: IncidentStatus; note?: string | null }
  | { kind: 'assigned'; assigned_to_user_id: string | null; note?: string | null }
  | { kind: 'confidence_changed'; confidence: IncidentConfidence; note: string }
  | { kind: 'exception_linked'; exception_id: string; note?: string | null }
  | { kind: 'parcel_added'; parcel_ids: string[]; note?: string | null }
  | { kind: 'parcel_finding'; parcel_id: string; finding: ParcelFinding; note: string }
  | { kind: 'external_action'; action: IncidentExternalAction; action_at?: string | null; note?: string | null }

export interface IncidentUpdate {
  update_id: string
  sequence: number
  kind: IncidentUpdateKind
  note: string | null
  from_value: string | null
  to_value: string | null
  parcel_id: string | null
  exception_id: string | null
  phase_event_id: string | null
  artifact_id: string | null
  external_action: IncidentExternalAction | null
  action_at: string | null
  recorded_by_user_id: string
  recorded_by_name: string | null
  recorded_at: string
}

export interface IncidentParcel {
  parcel_id: string
  barcode: string
  description: string | null
  consignment_id: string
  consignment_reference: string | null
  delivery_stop: string | null
  scanned_out_at: string | null
  scanned_in_at: string | null
  scan_state: ParcelScanState
  latest_finding: ParcelFinding | null
  added_at: string
}

export interface IncidentException {
  exception_id: string
  exception_type: ExceptionType
  severity: ExceptionSeverity
  description: string
  review_status: ExceptionReviewStatus
  raised_at: string
  linked_at: string
}

export interface ResponseStep {
  key: ResponseStepKey
  state: ResponseStepState
  done_at: string | null
  detail: string | null
}

export interface IncidentSummary {
  incident_id: string
  reference: string
  trip_id: string
  trip_reference: string
  trip_status: TripStatus
  incident_type: IncidentType
  summary: string
  status: IncidentStatus
  confidence: IncidentConfidence
  outcome: IncidentOutcome | null
  assigned_to_user_id: string | null
  assigned_to_name: string | null
  reported_occurred_at: string | null
  received_at: string
  trip_stopped_at: string | null
  closed_at: string | null
  created_at: string
  exception_ids: string[]
  exceptions_total: number
  exceptions_reviewed: number
  parcels_total: number
  parcels_unresolved: number
}

export interface IncidentDetail extends IncidentSummary {
  reported_by_name: string | null
  reporter_role: IncidentReporterRole
  report_channel: IncidentReportChannel
  recorded_by_user_id: string
  recorded_by_name: string | null
  closure_reason: string | null
  exceptions: IncidentException[]
  parcels: IncidentParcel[]
  updates: IncidentUpdate[]
  declarations: IncidentDeclaration[]
  document_upload_enabled: boolean
  response_guide: ResponseStep[] | null
  warnings: string[]
}

export interface IncidentListFilters {
  status?: IncidentStatus
  incident_type?: IncidentType
  assigned_to?: string
}

export interface PositionFix {
  lat: number
  lng: number
  source: 'driver_phone' | 'vehicle_tracker' | 'trailer_tracker'
  recorded_at: string | null
  accuracy_metres: number | null
}

export interface IncidentEvidence {
  incident_id: string
  seals: {
    phase_event_id: string; phase_type: string; precinct_name: string | null; seal_number: string | null
    seal_condition: string | null; completed_at: string | null; photo_ids: string[]
  }[]
  counts: {
    phase_event_id: string; phase_type: string; precinct_name: string | null
    parcel_count_origin: number | null; parcel_count_destination: number | null; driver_visual_count: number | null
  }[]
  consignments: {
    consignment_id: string; reference: string; parcel_count_expected: number | null; parcels_on_record: number
    scanned_out: number; scanned_in: number; no_scan_in_recorded: number
  }[]
  trip_exceptions: {
    exception_id: string; exception_type: ExceptionType; severity: ExceptionSeverity; description: string
    raised_at: string; review_status: ExceptionReviewStatus; incident_id: string | null
  }[]
  last_known_position: PositionFix | null
  position_reference_time: string
  coverage_gaps: { start: string; end: string; minutes: number }[]
  observations: { code: string; level: 'info' | 'attention'; text: string; evidence_ids: string[] }[]
}

export interface IncidentDocumentLink {
  artifact_id: string
  signed_url: string | null
}
