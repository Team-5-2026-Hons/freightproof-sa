// Phase: one entry in a trip's committed phase plan.
//
// The plan is DATA, generated at trip creation from the trip's stops and consignments —
// not a fixed list of six. A single-leg trip is the degenerate case of a multi-stop plan
// (7 rows); a three-stop cross-dock is 11. Nothing in this file may assume a length.
//
// Replaces ./handshake.ts, which encodes the old fixed 1-5 model. Both exist during the
// phase refactor; handshake.ts is removed once its last consumer goes (Stages 4 and 5).
//
// Mirrors backend PhaseEventRead (schemas/phases.py) — see
// docs/superpowers/plans/2026-07-25-phase-model-refactor.md §3.1.

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'
import type { ConsignmentRead, TripId, TripStop, TripType } from './trip'

export type PhaseEventId = string & { readonly __brand: 'PhaseEventId' }

// Mirrors backend PhaseType exactly — parent plan D5.
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

// Parent plan D4. A phase can be `completed` while its anchor is `failed` — that pairing
// is what makes the fail-open policy honest, so never render it as an unqualified success.
export type AnchorStatus =
  | 'not_required'
  | 'pending'
  | 'anchored'
  | 'failed'

// Coarse trip status — parent plan §2.3. TripStatus no longer doubles as the sequencer:
// position in the lifecycle is derived from the phase ledger, not stored here.
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

  // Null ONLY for trip_creation (parent D3). Every other phase is anchored to a stop —
  // in_transit anchors to the stop it DEPARTS FROM, so in_transit at stop 1 means
  // "the transit leg leaving stop 1". This is what lets one partial unique index close
  // the duplicate-row hole, since Postgres treats NULLs as distinct.
  trip_stop_id: string | null
  stop_sequence: number | null

  // Position in the committed plan. NOT an enum index, NOT bounded by 6.
  sequence_number: number

  status: PhaseStatus
  anchor_status: AnchorStatus

  // Capture-component slugs for this phase type — see constants/phase-meta.ts.
  // Empty for system-observed phases (trip_creation, loading).
  step_recipe: readonly string[]

  // ── Evidence, populated as the phase completes ────────────────────────────
  dispatcher_override_user_id: string | null
  dispatcher_override_note: string | null
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  pulsit_geofence_confirmed: boolean | null

  // Captured at `departure`, NOT at `loading` — parent D7 and §2.6. Verified again at
  // `unloading` before the doors open. Moving this is the highest-risk edit in the
  // refactor: a silent NULL == NULL comparison raises nothing and fails no test.
  seal_number: string | null
  seal_photo_artifact_id: string | null
  waybill_photo_artifact_id: string | null
  gate_photo_artifact_id: string | null
  pod_photo_artifact_id: string | null

  // Present on the backend read schema (schemas/handshakes.py:153) but missing from the
  // old shared HandshakeEvent — a live contract drift. Carried across deliberately so
  // the bug is not ported into the new model.
  pod_signature_artifact_id: string | null

  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null

  event_hash: string | null
  blockchain_receipt_id: string | null
  // Backend serialises this on PhaseEventRead (schemas/phases.py) so a client can
  // reconcile its offline capture queue against what the server actually recorded —
  // omitted from this shared type until now, a live contract drift.
  idempotency_key: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// A capture step within a phase, resolved from that phase's step_recipe.
// Keyed by phase-event id rather than a handshake number: the plan has no fixed indices,
// and the same phase_type can occur more than once in one trip.
export interface PhaseStep {
  phase_event_id: PhaseEventId
  stepIndex: number
  slug: string
  displayName: string
}

// Trip detail under the phase model lives in ./trip.ts as `Trip` — this file used to
// carry a forward declaration of it (`TripWithPhases`) while the old handshake-shaped
// Trip still existed. Stage 4 cut that over, so the forward declaration is gone:
// two structurally identical interfaces is exactly the halfway state to avoid.
