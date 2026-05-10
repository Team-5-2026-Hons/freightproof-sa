// Handshake: one of five sequential evidence-capture events that progress a trip.
// Each handshake has its own status independent of the trip status.
// Mirrors backend HandshakeEventRead schema in schemas/handshakes.py.

export type HandshakeEventId = string & { readonly __brand: 'HandshakeEventId' }

// 0 = trip creation (dispatcher), 1–5 = the five physical handshakes.
export type HandshakeNumber = 0 | 1 | 2 | 3 | 4 | 5

// Mirrors backend HandshakeType exactly.
export type HandshakeType =
  | 'trip_creation'
  | 'origin_gate_in'
  | 'loading'
  | 'origin_gate_out'
  | 'dest_gate_in'
  | 'unloading'

// Mirrors backend HandshakeStatus exactly — drives node visual state in HandshakeChain.
// pending → in_progress → completed (happy path); exception and overridden are off-path.
export type HandshakeStatus =
  | 'pending'      // Not yet started; rendered as an empty/dim node
  | 'in_progress'  // Currently active; rendered as a glowing node
  | 'completed'    // Fully evidenced; rendered with a tick
  | 'exception'    // Blocked by an unresolved exception; rendered as a warning node
  | 'overridden'   // Completed via dispatcher override; rendered with an override badge

// Named 'handshakes' on TripDetailResponse — matches API contract §4.2.
export interface HandshakeEvent {
  id: HandshakeEventId
  trip_id: string
  handshake_type: HandshakeType
  sequence_number: HandshakeNumber
  status: HandshakeStatus
  dispatcher_override_user_id: string | null
  dispatcher_override_note: string | null
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  pulsit_geofence_confirmed: boolean | null
  seal_number: string | null
  seal_photo_artifact_id: string | null
  waybill_photo_artifact_id: string | null
  gate_photo_artifact_id: string | null
  pod_photo_artifact_id: string | null
  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null
  event_hash: string | null
  blockchain_receipt_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface HandshakeStep {
  handshake: HandshakeNumber
  stepIndex: number
  slug: string
  displayName: string
}
