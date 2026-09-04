// TripException: a recorded deviation from expected trip workflow.
// Raised by driver, detected by system, or noted by dispatcher.
// Mirrors backend TripExceptionRead schema in schemas/transit.py.

export type ExceptionId = string & { readonly __brand: 'ExceptionId' }

// All 19 backend ExceptionType values — see DRIVER_EXCEPTION_TYPES and
// SYSTEM_EXCEPTION_TYPES in lib/constants/status-meta.ts for the UI split.
export type ExceptionType =
  // System-detected (raised automatically by backend validation logic)
  | 'seal_mismatch'
  // Two seals recorded and they differ (theft indicator, CRITICAL) vs no departure
  // seal recorded at all, so continuity is uncheckable (WARNING). Kept apart so a
  // dispatcher filtering for tampering never sees overridden departures.
  | 'seal_unverified'
  | 'parcel_count_mismatch'
  | 'gps_mismatch'
  | 'route_deviation'
  | 'vehicle_substitution'
  | 'driver_substitution'
  | 'checkpoint_timeout'
  | 'waybill_count_mismatch'
  | 'sequence_violation'
  // Driver-selectable (driver raises these from the exception picker screen)
  | 'panic_button'
  | 'delivery_refused'
  | 'cargo_damage'
  | 'seal_broken_in_transit'
  | 'mechanical'
  | 'document_review'
  // Dispatcher-created (raised from the dispatcher dashboard)
  | 'dispatcher_note'
  | 'escalation'
  | 'trip_hold'

export type ExceptionSource = 'system' | 'driver' | 'dispatcher'

export type ExceptionSeverity = 'info' | 'warning' | 'critical'

// How a dispatcher established what happened before resolving. Mirrors the backend
// ExceptionResolutionMethod (db/models/enums.py).
//
// 'no_contact_yet' is not a gap in the list. A dispatcher resolving from evidence alone
// — the scan feed corrected itself, the photo settles it — must be able to say so rather
// than pick the nearest wrong answer, which is how a contact log becomes fiction.
//
// This records that contact happened. It does not place calls or send messages.
export type ExceptionResolutionMethod =
  | 'phoned'
  | 'whatsapp'
  | 'in_person'
  | 'no_contact_yet'

export interface TripException {
  id: ExceptionId
  trip_id: string
  // Denormalised off the trip by the dispatcher endpoints, which already join it for
  // org scoping. Without it every row on the exception queue could name only a UUID.
  // Optional: the driver's own POST response is built from the ORM row alone and has
  // no trip loaded, and driver-pwa shares this type without reading the field.
  trip_reference?: string | null
  exception_type: ExceptionType
  source: ExceptionSource
  severity: ExceptionSeverity
  description: string
  // Matches the backend wire field (schemas/transit.py TripExceptionBase). Renamed
  // from the pre-phase-model `handshake_event_id` in Stage 5, which the dispatcher's
  // trip-detail timeline relies on to attach each exception to the phase it actually
  // occurred on rather than guessing at the last completed row.
  phase_event_id: string | null
  checkpoint_id: string | null
  supporting_artifact_id: string | null
  // Driver-phone GPS fix captured when the exception was raised (panic button today).
  // OPTIONAL (not just nullable) so existing dispatcher code and fixtures that predate
  // these columns keep compiling unchanged — matches Checkpoint's number|null lat/lng
  // convention in checkpoint.ts. POPIA: stays in Postgres, never anchored to Hedera.
  gps_lat?: number | null
  gps_lng?: number | null
  resolved: boolean
  resolved_by_user_id: string | null
  resolved_at: string | null
  resolver_note: string | null
  // Nullable for every exception resolved before this column existed — backfilling a
  // guess would put invented contact history onto an evidence record. Optional as well
  // as nullable so driver-pwa fixtures, which share this type and never read the
  // field, keep compiling unchanged.
  resolution_method?: ExceptionResolutionMethod | null
  merkle_batch_id: string | null
  created_at: string
  updated_at: string
}
