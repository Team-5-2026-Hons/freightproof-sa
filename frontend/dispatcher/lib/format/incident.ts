// Labels and pure helpers for incidents. A missing scan reads as a scan fact ("No scan-in
// recorded"), never as a conclusion: only a dispatcher's recorded finding may say a parcel is
// missing, and nothing here ever says "stolen".

import type { ExceptionType } from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import type {
  IncidentConfidence,
  IncidentExternalAction,
  IncidentOutcome,
  IncidentReportChannel,
  IncidentReporterRole,
  IncidentStatus,
  IncidentType,
  IncidentUpdate,
  ParcelFinding,
  ParcelScanState,
  ResponseStepKey,
} from '@/lib/types/incident'

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  hijacking: 'Hijacking',
  parcel_shortage: 'Parcel shortage',
  parcel_damage: 'Parcel damage',
}

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  closed: 'Closed',
}

export const CONFIDENCE_LABELS: Record<IncidentConfidence, string> = {
  suspected: 'Suspected',
  reported: 'Reported',
  corroborated: 'Corroborated',
}

export const CONFIDENCE_HELP: Record<IncidentConfidence, string> = {
  suspected: 'Inferred from FreightProof signals only.',
  reported: 'Someone told us. A phone call stays a report until something independent agrees.',
  corroborated: 'Independent evidence agrees: a SAPS case, a recovery, the scans.',
}

export const REPORTER_ROLE_LABELS: Record<IncidentReporterRole, string> = {
  driver: 'Driver',
  client: 'Client',
  receiver: 'Receiver',
  tracking_company: 'Tracking company',
  police: 'Police (SAPS)',
  operator_staff: 'Our staff',
  freightproof: 'FreightProof alert',
  other: 'Other',
}

export const REPORT_CHANNEL_LABELS: Record<IncidentReportChannel, string> = {
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  in_person: 'In person',
  in_app: 'FreightProof alert',
}

export const OUTCOME_LABELS: Record<IncidentOutcome, string> = {
  recording_error: 'Recording error',
  cargo_recovered: 'Cargo recovered',
  partial_recovery: 'Partial recovery',
  shortage_confirmed: 'Shortage confirmed',
  damage_confirmed: 'Damage confirmed',
  theft_reported: 'Theft reported',
  inconclusive: 'Inconclusive',
}

export const FINDING_LABELS: Record<ParcelFinding, string> = {
  located: 'Located',
  confirmed_missing: 'Confirmed missing',
  damage_confirmed: 'Damage confirmed',
  recording_error: 'Recording error',
}

export const SCAN_STATE_LABELS: Record<ParcelScanState, string> = {
  scanned_in: 'Scanned in',
  no_scan_in_recorded: 'No scan-in recorded',
  no_scan_recorded: 'No scan recorded',
}

export const EXTERNAL_ACTION_LABELS: Record<IncidentExternalAction, string> = {
  tracking_company_alerted: 'Tracking company alerted',
  saps_reported: 'Reported to SAPS',
  insurer_notified: 'Insurer notified',
  client_notified: 'Client notified',
  driver_welfare_check: 'Driver welfare check',
  recovery_reported: 'Recovery reported',
  other: 'Other action',
}

export const RESPONSE_STEP_LABELS: Record<ResponseStepKey, string> = {
  trip_stopped: 'Stop the trip',
  tracking_company_alerted: 'Alert the tracking company',
  saps_reported: 'Report to SAPS and record the case number',
  insurer_notified: 'Notify the insurer',
  client_notified: 'Notify the client',
  driver_welfare_check: 'Check on the driver',
  audit_pack_issued: 'Issue the insurer audit pack',
}

/** The external action a guide step records, for the steps a dispatcher ticks off by recording one. */
export const RESPONSE_STEP_ACTION: Partial<Record<ResponseStepKey, IncidentExternalAction>> = {
  tracking_company_alerted: 'tracking_company_alerted',
  insurer_notified: 'insurer_notified',
  client_notified: 'client_notified',
  driver_welfare_check: 'driver_welfare_check',
}

/** Steps whose "done" the system established itself (the trip it stopped, the pack it issued).
 *  Every other done step rests on what a dispatcher recorded. Mirrors response_guide.py. */
export const SYSTEM_WITNESSED_STEPS: readonly ResponseStepKey[] = ['trip_stopped', 'audit_pack_issued']

const FINISHED_TRIP: readonly TripStatus[] = ['closed', 'cancelled']

export function tripIsLive(status: TripStatus): boolean {
  return !FINISHED_TRIP.includes(status)
}

/** What a new report of this type defaults to. A hijacking on a live trip stops it and names
 *  the whole load; the dispatcher can still untick either before saving. */
export function reportDefaults(type: IncidentType, tripStatus: TripStatus): { stopTrip: boolean; allParcels: boolean } {
  const hijackOnLiveTrip = type === 'hijacking' && tripIsLive(tripStatus)
  return { stopTrip: hijackOnLiveTrip, allParcels: type === 'hijacking' }
}

const TYPE_FROM_EXCEPTION: Partial<Record<ExceptionType, IncidentType>> = {
  panic_button: 'hijacking',
  parcel_count_mismatch: 'parcel_shortage',
  waybill_count_mismatch: 'parcel_shortage',
  cargo_damage: 'parcel_damage',
}

/** The incident an exception most likely belongs to, when opening one from it. A suggestion
 *  the dispatcher can change; anything unmapped starts as a shortage, the most common case. */
export function incidentTypeForException(type: ExceptionType): IncidentType {
  return TYPE_FROM_EXCEPTION[type] ?? 'parcel_shortage'
}

function label<T extends string>(labels: Record<T, string>, value: string | null): string {
  return value !== null && value in labels ? labels[value as T] : (value ?? '—')
}

/** A folded run of identical entries as one sentence, e.g. "48 parcels named as affected". */
export function describeUpdateRun(kind: IncidentUpdate['kind'], count: number): string {
  switch (kind) {
    case 'parcel_added': return `${count} parcels named as affected`
    case 'exception_linked': return `${count} exceptions grouped under this incident`
    default: return `${count} × ${describeUpdate({ kind } as IncidentUpdate)}`
  }
}

/** One ledger entry as a sentence. `names` resolves an assignee id to a dispatcher's name. */
export function describeUpdate(update: IncidentUpdate, names: ReadonlyMap<string, string> = new Map()): string {
  switch (update.kind) {
    case 'opened': return `Incident recorded as ${label(CONFIDENCE_LABELS, update.to_value).toLowerCase()}`
    case 'note': return 'Note'
    case 'status_changed': return `Status changed to ${label(INCIDENT_STATUS_LABELS, update.to_value).toLowerCase()}`
    case 'assigned': return update.to_value ? `Assigned to ${names.get(update.to_value) ?? 'a colleague'}` : 'Unassigned'
    case 'confidence_changed': return `Confidence changed to ${label(CONFIDENCE_LABELS, update.to_value).toLowerCase()}`
    case 'exception_linked': return 'Exception grouped under this incident'
    case 'parcel_added': return 'Parcel named as affected'
    case 'parcel_finding': return `Parcel finding: ${label(FINDING_LABELS, update.to_value).toLowerCase()}`
    case 'external_action': return label(EXTERNAL_ACTION_LABELS, update.external_action)
    case 'document_attached': return update.to_value ? `Document attached: ${update.to_value}` : 'Document attached'
    case 'trip_stopped': return 'Trip stopped'
    case 'closed': return `Closed as ${label(OUTCOME_LABELS, update.to_value).toLowerCase()}`
    case 'reopened': return 'Reopened'
  }
}
