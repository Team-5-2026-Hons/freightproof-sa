// Phase: one entry in a trip's committed phase plan.
//
// The plan is DATA, generated at trip creation from the trip's stops and consignments —
// not a fixed list of six. A single-leg trip is the degenerate case of a multi-stop plan
// (8 rows); a three-stop cross-dock is 13. Nothing in this file may assume a length.
//
// Replaces ./handshake.ts, which encodes the old fixed 1-5 model. Both exist during the
// phase refactor; handshake.ts is removed once its last consumer goes.
//
// Mirrors backend PhaseEventRead (schemas/phases.py).

import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { TripException } from './exception'
import type { BlockchainReceipt } from './blockchain'
import type { ConsignmentRead, TripId, TripStop, TripType } from './trip'
import type { ActionLocationAssessment } from './action-location'

export type PhaseEventId = string & { readonly __brand: 'PhaseEventId' }

export type PhaseType =
  | 'trip_creation'
  | 'activation'
  | 'loading'
  | 'departure'
  | 'in_transit'
  | 'arrival'
  | 'unloading'
  | 'confirmation'

export type SealCondition = 'intact' | 'damaged' | 'missing'

export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'exception'
  | 'overridden'

export type AnchorStatus =
  | 'not_required'
  | 'pending'
  | 'anchored'
  | 'failed'

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

  trip_stop_id: string | null
  stop_sequence: number | null

  sequence_number: number

  status: PhaseStatus
  anchor_status: AnchorStatus

  step_recipe: readonly string[]

  blocked_on?: string | null

  dispatcher_override_user_id: string | null
  dispatcher_override_note: string | null
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  pulsit_geofence_confirmed: boolean | null
  action_location_assessment?: ActionLocationAssessment | null
  driver_captured_at?: string | null

  seal_number: string | null
  seal_condition?: SealCondition | null
  seal_photo_artifact_id: string | null
  waybill_photo_artifact_id: string | null
  gate_photo_artifact_id: string | null
  pod_photo_artifact_id: string | null

  linehaul_photo_artifact_id?: string | null
  linehaul_pdf_artifact_id?: string | null

  pod_signature_artifact_id: string | null

  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null

  event_hash: string | null
  blockchain_receipt_id: string | null
  idempotency_key: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface PhaseStep {
  phase_event_id: PhaseEventId
  stepIndex: number
  slug: string
  displayName: string
}

