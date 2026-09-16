// Phase: one entry in a trip's committed phase plan. The plan is DATA generated at trip
// creation from stops and consignments, not a fixed list of six — a single-leg trip is 7
// rows, a three-stop cross-dock is 11. Nothing here may assume a length.
// Mirrors backend PhaseEventRead (schemas/phases.py).

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'
import type { ConsignmentRead, TripId, TripStop, TripType } from './trip'

export type PhaseEventId = string & { readonly __brand: 'PhaseEventId' }

// Mirrors backend PhaseType exactly.
export type PhaseType =
  | 'trip_creation'
  | 'activation'
  | 'loading'
  | 'departure'
  | 'in_transit'
  | 'unloading'
  | 'confirmation'

// pending -> in_progress -> completed (happy path); exception and overridden are off-path.
export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'exception'
  | 'overridden'

// A phase can be `completed` while its anchor is `failed` (fail-open policy) — never
// render that pairing as an unqualified success.
export type AnchorStatus =
  | 'not_required'
  | 'pending'
  | 'anchored'
  | 'failed'

// Coarse trip status. Position in the lifecycle is derived from the phase ledger, not
// stored here — this no longer doubles as the sequencer.
export type CoarseTripStatus =
  | 'created'
  | 'active'
  | 'closed'
  | 'cancelled'
  | 'exception_hold'

export interface PhaseDescriptor {
  phase_event_id: PhaseEventId
  trip_id: string
  phase_type: PhaseType

  // Null ONLY for trip_creation. Every other phase anchors to a stop; in_transit anchors
  // to the stop it DEPARTS FROM (in_transit at stop 1 = the leg leaving stop 1).
  trip_stop_id: string | null
  stop_sequence: number | null

  // Position in the committed plan. NOT an enum index, NOT bounded by 6.
  sequence_number: number

  status: PhaseStatus
  anchor_status: AnchorStatus

  // Capture-component slugs for this phase type — see constants/phase-meta.ts.
  step_recipe: readonly string[]

  // Optional only until driver-pwa fixtures are updated (server always sends this field).
  // Non-null while this phase waits on an external system (today only 'warehouse_scan').
  // Derived server-side per request, never stored. A phase carrying a non-null value
  // must not be submittable; the server independently 409s if one is.
  blocked_on?: string | null

  dispatcher_override_user_id: string | null
  dispatcher_override_note: string | null
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  pulsit_geofence_confirmed: boolean | null
  // Same "optional until fixtures updated" convention as blocked_on above.
  driver_captured_at?: string | null

  // Captured at `departure`, NOT `loading`, and verified again at `unloading` before the
  // doors open. Moving this is high-risk: a silent NULL == NULL comparison raises nothing.
  seal_number: string | null
  seal_photo_artifact_id: string | null
  waybill_photo_artifact_id: string | null
  gate_photo_artifact_id: string | null
  pod_photo_artifact_id: string | null

  // Captured at `loading` — the warehouse's linehaul sheet, distinct from
  // waybill_photo_artifact_id above (departure's waybill copy).
  linehaul_photo_artifact_id?: string | null

  pod_signature_artifact_id: string | null

  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null

  event_hash: string | null
  blockchain_receipt_id: string | null
  // Lets a client reconcile its offline capture queue against what the server recorded.
  idempotency_key: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// A capture step within a phase, resolved from that phase's step_recipe. Keyed by
// phase-event id, not an index: the same phase_type can occur more than once in one trip.
export interface PhaseStep {
  phase_event_id: PhaseEventId
  stepIndex: number
  slug: string
  displayName: string
}

// Trip detail under the phase model lives in ./trip.ts as `Trip`.
