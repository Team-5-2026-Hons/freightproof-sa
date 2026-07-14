import type { Trip, TripId, BlockchainReceipt, TripStop } from '@shared/lib/types/trip'
import type { HandshakeEvent, HandshakeEventId, HandshakeNumber, HandshakeType } from '@shared/lib/types/handshake'
import type { TripException, ExceptionId } from '@shared/lib/types/exception'
import { mockDrivers, DRIVER_DLAMINI_ID, DRIVER_FORMBY_ID, DRIVER_GULTIG_ID, DRIVER_KASONGO_ID } from './drivers'
import { mockHorses, mockTrailers, HORSE_1_ID, HORSE_2_ID, HORSE_3_ID, TRAILER_1_ID, TRAILER_2_ID, TRAILER_3_ID, TRAILER_4_ID, TRAILER_5_ID } from './vehicles'
import { PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_CGY_JHB_ID, PRECINCT_CGY_CT_ID } from './precincts'

const tripId = (v: string): TripId => v as unknown as TripId
const heId = (v: string): HandshakeEventId => v as unknown as HandshakeEventId
const excId = (v: string): ExceptionId => v as unknown as ExceptionId

// Exported so exceptions.ts, checkpoints.ts, and manifests.ts can reference trips by ID.
export const TRIP_0035_ID = tripId('7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b')
export const TRIP_0038_ID = tripId('8f9a0b1c-2d3e-4f4a-8b6c-7d8e9f0a1b2c')
export const TRIP_0039_ID = tripId('9a0b1c2d-3e4f-4a5b-8c7d-8e9f0a1b2c3d')
export const TRIP_0040_ID = tripId('0b1c2d3e-4f5a-4b6c-8d8e-9f0a1b2c3d4e')
export const TRIP_0041_ID = tripId('1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f')
export const TRIP_0042_ID = tripId('2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a')
export const TRIP_0043_ID = tripId('3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b')

// Returns a fully-null pending HandshakeEvent — used for not-yet-started handshakes.
function pendingHE(
  id: string,
  trip: TripId,
  type: HandshakeType,
  seq: HandshakeNumber,
  at: string,
): HandshakeEvent {
  return {
    id: heId(id), trip_id: trip, handshake_type: type, sequence_number: seq,
    status: 'pending',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null,
    horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null, completed_at: null,
    created_at: at, updated_at: at,
  }
}

// Two-stop route matching the trip's origin/destination — the FP-112 degenerate case
// every pre-multi-stop mock trip represents.
function twoStops(trip: TripId, originPrecinct: string, destPrecinct: string, at: string): TripStop[] {
  return [originPrecinct, destPrecinct].map((precinct_id, sequence) => ({
    id: `${trip}-stop-${sequence}`,
    trip_id: trip, precinct_id, sequence,
    slot_time: null, notes: null, created_at: at, updated_at: at,
  }))
}

// ─── TRP-2026-0035 · closed · Dlamini · FedEx JHB → DBN ──────────────────────

const HANDSHAKES_0035: HandshakeEvent[] = [
  {
    id: heId('aa003500-0000-4000-8001-000000000001'), trip_id: TRIP_0035_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: 'c2956f8a3d1e4b09f72a83c1d4e5b96f2a3c8d0e1f4a7b2c9d6e3f0a1b4c7d2',
    blockchain_receipt_id: 'bcr-0035-h0',
    completed_at: '2026-05-03T06:05:00Z', created_at: '2026-05-03T06:00:00Z', updated_at: '2026-05-03T06:05:00Z',
  },
  {
    id: heId('aa003500-0000-4001-8001-000000000002'), trip_id: TRIP_0035_ID,
    handshake_type: 'origin_gate_in', sequence_number: 1, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0940, horse_gps_lng: 28.1340,
    pulsit_geofence_confirmed: true, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0035-gate-in',
    pod_photo_artifact_id: null, parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-03T07:02:00Z', created_at: '2026-05-03T06:45:00Z', updated_at: '2026-05-03T07:02:00Z',
  },
  {
    id: heId('aa003500-0000-4002-8001-000000000003'), trip_id: TRIP_0035_ID,
    handshake_type: 'loading', sequence_number: 2, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0942, horse_gps_lng: 28.1342,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0035', seal_photo_artifact_id: 'art-0035-seal',
    waybill_photo_artifact_id: 'art-0035-waybill', gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: 31, parcel_count_destination: null, driver_visual_count: 31,
    event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    blockchain_receipt_id: 'bcr-0035-h2',
    completed_at: '2026-05-03T09:10:00Z', created_at: '2026-05-03T07:15:00Z', updated_at: '2026-05-03T09:10:00Z',
  },
  {
    id: heId('aa003500-0000-4003-8001-000000000004'), trip_id: TRIP_0035_ID,
    handshake_type: 'origin_gate_out', sequence_number: 3, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0940, horse_gps_lng: 28.1338,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0035', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0035-gate-out', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-03T09:30:00Z', created_at: '2026-05-03T09:15:00Z', updated_at: '2026-05-03T09:30:00Z',
  },
  {
    id: heId('aa003500-0000-4004-8001-000000000005'), trip_id: TRIP_0035_ID,
    handshake_type: 'dest_gate_in', sequence_number: 4, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -29.7942, driver_phone_lng: 30.9820, horse_gps_lat: -29.7940, horse_gps_lng: 30.9818,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0035', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0035-dest-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-03T17:15:00Z', created_at: '2026-05-03T17:00:00Z', updated_at: '2026-05-03T17:15:00Z',
  },
  {
    id: heId('aa003500-0000-4005-8001-000000000006'), trip_id: TRIP_0035_ID,
    handshake_type: 'unloading', sequence_number: 5, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -29.7942, driver_phone_lng: 30.9820, horse_gps_lat: -29.7942, horse_gps_lng: 30.9820,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: 'art-0035-pod',
    parcel_count_origin: 31, parcel_count_destination: 31, driver_visual_count: 31,
    event_hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
    blockchain_receipt_id: 'bcr-0035-h5',
    completed_at: '2026-05-03T19:45:00Z', created_at: '2026-05-03T17:30:00Z', updated_at: '2026-05-03T19:45:00Z',
  },
]

const EXCEPTIONS_0035: TripException[] = [
  {
    id: excId('ec000001-0035-4001-8001-000000000001'),
    trip_id: TRIP_0035_ID,
    exception_type: 'cargo_damage',
    source: 'driver',
    severity: 'warning',
    description: 'Two parcels in the Pinetown stop showed visible damp damage on delivery — likely pre-existing.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: 'art-0035-damage',
    resolved: true, resolved_by_user_id: 'user-dispatcher-01',
    resolved_at: '2026-05-04T08:30:00Z', resolver_note: 'Confirmed pre-existing. Client notified. No further action.',
    merkle_batch_id: null, created_at: '2026-05-03T19:00:00Z', updated_at: '2026-05-04T08:30:00Z',
  },
  {
    id: excId('ec000002-0035-4002-8001-000000000002'),
    trip_id: TRIP_0035_ID,
    exception_type: 'delivery_refused',
    source: 'driver',
    severity: 'info',
    description: 'Westville stop refused two parcels — receiver stated incorrect address on waybill.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: true, resolved_by_user_id: 'user-dispatcher-01',
    resolved_at: '2026-05-04T09:00:00Z', resolver_note: 'FedEx to re-schedule delivery. Parcels returned to DBN hub.',
    merkle_batch_id: null, created_at: '2026-05-03T18:45:00Z', updated_at: '2026-05-04T09:00:00Z',
  },
]

const RECEIPTS_0035: BlockchainReceipt[] = [
  {
    id: 'bcr-0035-h0', receipt_type: 'journey_lock',
    subject_type: 'trip', subject_id: 'bcr-0035-h0',
    hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1842,
    hedera_tx_id: null, hedera_consensus_timestamp: '2026-05-03T06:07:00Z',
    data_hash: 'c2956f8a3d1e4b09f72a83c1d4e5b96f2a3c8d0e1f4a7b2c9d6e3f0a1b4c7d2',
    created_at: '2026-05-03T06:05:00Z',
  },
  {
    id: 'bcr-0035-h2', receipt_type: 'pickup',
    subject_type: 'trip', subject_id: 'bcr-0035-h2',
    hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1843,
    hedera_tx_id: null, hedera_consensus_timestamp: '2026-05-03T09:14:00Z',
    data_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    created_at: '2026-05-03T09:10:00Z',
  },
  {
    id: 'bcr-0035-h5', receipt_type: 'delivery',
    subject_type: 'trip', subject_id: 'bcr-0035-h5',
    hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1844,
    hedera_tx_id: null, hedera_consensus_timestamp: '2026-05-03T19:49:00Z',
    data_hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
    created_at: '2026-05-03T19:45:00Z',
  },
]

// ─── TRP-2026-0038 · created · Gultig · Courier Guy JHB → CT ─────────────────

const HANDSHAKES_0038: HandshakeEvent[] = [
  {
    id: heId('aa003800-0000-4000-8001-000000000001'), trip_id: TRIP_0038_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'in_progress',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: null, created_at: '2026-05-09T06:00:00Z', updated_at: '2026-05-09T06:00:00Z',
  },
  pendingHE('aa003800-0000-4001-8001-000000000002', TRIP_0038_ID, 'origin_gate_in', 1, '2026-05-09T06:00:00Z'),
  pendingHE('aa003800-0000-4002-8001-000000000003', TRIP_0038_ID, 'loading', 2, '2026-05-09T06:00:00Z'),
  pendingHE('aa003800-0000-4003-8001-000000000004', TRIP_0038_ID, 'origin_gate_out', 3, '2026-05-09T06:00:00Z'),
  pendingHE('aa003800-0000-4004-8001-000000000005', TRIP_0038_ID, 'dest_gate_in', 4, '2026-05-09T06:00:00Z'),
  pendingHE('aa003800-0000-4005-8001-000000000006', TRIP_0038_ID, 'unloading', 5, '2026-05-09T06:00:00Z'),
]

// ─── TRP-2026-0039 · origin_gate_in · Kasongo · FedEx DBN → JHB ──────────────

const EXCEPTIONS_0039: TripException[] = [
  {
    id: excId('ec000003-0039-4003-8001-000000000003'),
    trip_id: TRIP_0039_ID,
    exception_type: 'gps_mismatch',
    source: 'system',
    severity: 'warning',
    description: 'Pulsit horse GPS (KZN 56-78 YP) placed vehicle 420 m outside the FedEx DBN geofence at gate-in. Manual check confirmed driver was at correct location.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
    merkle_batch_id: null, created_at: '2026-05-09T07:04:00Z', updated_at: '2026-05-09T07:04:00Z',
  },
]

const HANDSHAKES_0039: HandshakeEvent[] = [
  {
    id: heId('aa003900-0000-4000-8001-000000000001'), trip_id: TRIP_0039_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: 'f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',
    blockchain_receipt_id: 'bcr-0039-h0',
    completed_at: '2026-05-09T04:32:00Z', created_at: '2026-05-09T04:30:00Z', updated_at: '2026-05-09T04:32:00Z',
  },
  {
    id: heId('aa003900-0000-4001-8001-000000000002'), trip_id: TRIP_0039_ID,
    handshake_type: 'origin_gate_in', sequence_number: 1, status: 'exception',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -29.7942, driver_phone_lng: 30.9820, horse_gps_lat: -29.7978, horse_gps_lng: 30.9856,
    pulsit_geofence_confirmed: false,
    seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0039-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: null, created_at: '2026-05-09T07:00:00Z', updated_at: '2026-05-09T07:04:00Z',
  },
  pendingHE('aa003900-0000-4002-8001-000000000003', TRIP_0039_ID, 'loading', 2, '2026-05-09T04:30:00Z'),
  pendingHE('aa003900-0000-4003-8001-000000000004', TRIP_0039_ID, 'origin_gate_out', 3, '2026-05-09T04:30:00Z'),
  pendingHE('aa003900-0000-4004-8001-000000000005', TRIP_0039_ID, 'dest_gate_in', 4, '2026-05-09T04:30:00Z'),
  pendingHE('aa003900-0000-4005-8001-000000000006', TRIP_0039_ID, 'unloading', 5, '2026-05-09T04:30:00Z'),
]

// ─── TRP-2026-0040 · dest_gate_in · Formby · FedEx JHB → DBN ────────────────

const EXCEPTIONS_0040: TripException[] = [
  {
    id: excId('ec000004-0040-4004-8001-000000000004'),
    trip_id: TRIP_0040_ID,
    exception_type: 'checkpoint_timeout',
    source: 'system',
    severity: 'info',
    description: 'Vehicle stationary for 18 minutes at Tugela Plaza without a checkpoint submission. Driver confirmed it was a scheduled stop.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: true, resolved_by_user_id: 'user-dispatcher-01',
    resolved_at: '2026-05-09T13:10:00Z', resolver_note: 'Driver confirmed scheduled break. No issue.',
    merkle_batch_id: null, created_at: '2026-05-09T12:52:00Z', updated_at: '2026-05-09T13:10:00Z',
  },
]

const HANDSHAKES_0040: HandshakeEvent[] = [
  {
    id: heId('aa004000-0000-4000-8001-000000000001'), trip_id: TRIP_0040_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: 'b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8',
    blockchain_receipt_id: 'bcr-0040-h0',
    completed_at: '2026-05-08T06:02:00Z', created_at: '2026-05-08T06:00:00Z', updated_at: '2026-05-08T06:02:00Z',
  },
  {
    id: heId('aa004000-0000-4001-8001-000000000002'), trip_id: TRIP_0040_ID,
    handshake_type: 'origin_gate_in', sequence_number: 1, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0941, horse_gps_lng: 28.1341,
    pulsit_geofence_confirmed: true, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0040-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-08T07:05:00Z', created_at: '2026-05-08T06:50:00Z', updated_at: '2026-05-08T07:05:00Z',
  },
  {
    id: heId('aa004000-0000-4002-8001-000000000003'), trip_id: TRIP_0040_ID,
    handshake_type: 'loading', sequence_number: 2, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0942, horse_gps_lng: 28.1342,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0040', seal_photo_artifact_id: 'art-0040-seal',
    waybill_photo_artifact_id: 'art-0040-waybill', gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: 32, parcel_count_destination: null, driver_visual_count: 32,
    event_hash: 'e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
    blockchain_receipt_id: 'bcr-0040-h2',
    completed_at: '2026-05-08T09:00:00Z', created_at: '2026-05-08T07:20:00Z', updated_at: '2026-05-08T09:00:00Z',
  },
  {
    id: heId('aa004000-0000-4003-8001-000000000004'), trip_id: TRIP_0040_ID,
    handshake_type: 'origin_gate_out', sequence_number: 3, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0940, horse_gps_lng: 28.1340,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0040', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0040-gate-out', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-08T09:22:00Z', created_at: '2026-05-08T09:05:00Z', updated_at: '2026-05-08T09:22:00Z',
  },
  {
    id: heId('aa004000-0000-4004-8001-000000000005'), trip_id: TRIP_0040_ID,
    handshake_type: 'dest_gate_in', sequence_number: 4, status: 'in_progress',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -29.7942, driver_phone_lng: 30.9820, horse_gps_lat: -29.7942, horse_gps_lng: 30.9820,
    pulsit_geofence_confirmed: true, seal_number: 'FP-0040', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0040-dest-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: null, created_at: '2026-05-09T17:00:00Z', updated_at: '2026-05-09T17:05:00Z',
  },
  pendingHE('aa004000-0000-4005-8001-000000000006', TRIP_0040_ID, 'unloading', 5, '2026-05-08T06:00:00Z'),
]

// ─── TRP-2026-0041 · in_transit · Dlamini · FedEx JHB → DBN (CANONICAL) ─────

const EXCEPTIONS_0041: TripException[] = [
  {
    id: excId('ec000005-0041-4005-8001-000000000005'),
    trip_id: TRIP_0041_ID,
    exception_type: 'route_deviation',
    source: 'system',
    severity: 'warning',
    description: 'Vehicle deviated 2.1 km off the N3 near Van Reenen\'s Pass. Driver reported road works diversion.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
    merkle_batch_id: null, created_at: '2026-05-09T13:22:00Z', updated_at: '2026-05-09T13:22:00Z',
  },
  {
    id: excId('ec000006-0041-4006-8001-000000000006'),
    trip_id: TRIP_0041_ID,
    exception_type: 'dispatcher_note',
    source: 'dispatcher',
    severity: 'info',
    description: 'Route deviation confirmed as N3 road works diversion at Van Reenen\'s. Monitoring ETA impact — expected +25 min delay.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
    merkle_batch_id: null, created_at: '2026-05-09T13:35:00Z', updated_at: '2026-05-09T13:35:00Z',
  },
]

const HANDSHAKES_0041: HandshakeEvent[] = [
  {
    id: heId('aa004100-0000-4000-8001-000000000001'), trip_id: TRIP_0041_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    blockchain_receipt_id: 'bcr-0041-h0',
    completed_at: '2026-05-09T05:32:00Z', created_at: '2026-05-09T05:30:00Z', updated_at: '2026-05-09T05:32:00Z',
  },
  {
    id: heId('aa004100-0000-4001-8001-000000000002'), trip_id: TRIP_0041_ID,
    handshake_type: 'origin_gate_in', sequence_number: 1, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0943, horse_gps_lng: 28.1341,
    pulsit_geofence_confirmed: true, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0041-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-09T06:50:00Z', created_at: '2026-05-09T06:40:00Z', updated_at: '2026-05-09T06:50:00Z',
  },
  {
    id: heId('aa004100-0000-4002-8001-000000000003'), trip_id: TRIP_0041_ID,
    handshake_type: 'loading', sequence_number: 2, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0942, horse_gps_lng: 28.1342,
    pulsit_geofence_confirmed: true, seal_number: 'FP-1234', seal_photo_artifact_id: 'art-0041-seal',
    waybill_photo_artifact_id: 'art-0041-waybill', gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: 27, parcel_count_destination: null, driver_visual_count: 27,
    event_hash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
    blockchain_receipt_id: 'bcr-0041-h2',
    completed_at: '2026-05-09T08:18:00Z', created_at: '2026-05-09T07:05:00Z', updated_at: '2026-05-09T08:18:00Z',
  },
  {
    id: heId('aa004100-0000-4003-8001-000000000004'), trip_id: TRIP_0041_ID,
    handshake_type: 'origin_gate_out', sequence_number: 3, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0940, horse_gps_lng: 28.1339,
    pulsit_geofence_confirmed: true, seal_number: 'FP-1234', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0041-gate-out', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-09T08:32:00Z', created_at: '2026-05-09T08:20:00Z', updated_at: '2026-05-09T08:32:00Z',
  },
  pendingHE('aa004100-0000-4004-8001-000000000005', TRIP_0041_ID, 'dest_gate_in', 4, '2026-05-09T05:30:00Z'),
  pendingHE('aa004100-0000-4005-8001-000000000006', TRIP_0041_ID, 'unloading', 5, '2026-05-09T05:30:00Z'),
]

// ─── TRP-2026-0042 · in_transit · Formby · FedEx JHB → DBN ──────────────────

const EXCEPTIONS_0042: TripException[] = [
  {
    id: excId('ec000007-0042-4007-8001-000000000007'),
    trip_id: TRIP_0042_ID,
    exception_type: 'seal_broken_in_transit',
    source: 'driver',
    severity: 'critical',
    description: 'Seal FP-5678 found broken at Harrismith fuel stop. Driver photographed damaged seal. Possible unauthorised access during stop.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: 'art-0042-broken-seal',
    resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
    merkle_batch_id: null, created_at: '2026-05-09T07:41:00Z', updated_at: '2026-05-09T07:41:00Z',
  },
  {
    id: excId('ec000008-0042-4008-8001-000000000008'),
    trip_id: TRIP_0042_ID,
    exception_type: 'parcel_count_mismatch',
    source: 'system',
    severity: 'critical',
    description: 'Parcel Perfect scan-out count (42) does not match driver visual count (40) recorded at loading. Discrepancy of 2 parcels.',
    handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
    merkle_batch_id: null, created_at: '2026-05-08T17:30:00Z', updated_at: '2026-05-08T17:30:00Z',
  },
]

const HANDSHAKES_0042: HandshakeEvent[] = [
  {
    id: heId('aa004200-0000-4000-8001-000000000001'), trip_id: TRIP_0042_ID,
    handshake_type: 'trip_creation', sequence_number: 0, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    blockchain_receipt_id: 'bcr-0042-h0',
    completed_at: '2026-05-08T14:02:00Z', created_at: '2026-05-08T14:00:00Z', updated_at: '2026-05-08T14:02:00Z',
  },
  {
    id: heId('aa004200-0000-4001-8001-000000000002'), trip_id: TRIP_0042_ID,
    handshake_type: 'origin_gate_in', sequence_number: 1, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0941, horse_gps_lng: 28.1340,
    pulsit_geofence_confirmed: true, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0042-gate-in', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-08T15:05:00Z', created_at: '2026-05-08T14:55:00Z', updated_at: '2026-05-08T15:05:00Z',
  },
  {
    id: heId('aa004200-0000-4002-8001-000000000003'), trip_id: TRIP_0042_ID,
    handshake_type: 'loading', sequence_number: 2, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0942, horse_gps_lng: 28.1342,
    pulsit_geofence_confirmed: true, seal_number: 'FP-5678', seal_photo_artifact_id: 'art-0042-seal',
    waybill_photo_artifact_id: 'art-0042-waybill', gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: 42, parcel_count_destination: null, driver_visual_count: 40,
    event_hash: '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
    blockchain_receipt_id: 'bcr-0042-h2',
    completed_at: '2026-05-08T16:48:00Z', created_at: '2026-05-08T15:20:00Z', updated_at: '2026-05-08T16:48:00Z',
  },
  {
    id: heId('aa004200-0000-4003-8001-000000000004'), trip_id: TRIP_0042_ID,
    handshake_type: 'origin_gate_out', sequence_number: 3, status: 'completed',
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: -26.0942, driver_phone_lng: 28.1342, horse_gps_lat: -26.0940, horse_gps_lng: 28.1338,
    pulsit_geofence_confirmed: true, seal_number: 'FP-5678', seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: 'art-0042-gate-out', pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null,
    completed_at: '2026-05-08T17:10:00Z', created_at: '2026-05-08T16:55:00Z', updated_at: '2026-05-08T17:10:00Z',
  },
  pendingHE('aa004200-0000-4004-8001-000000000005', TRIP_0042_ID, 'dest_gate_in', 4, '2026-05-08T14:00:00Z'),
  pendingHE('aa004200-0000-4005-8001-000000000006', TRIP_0042_ID, 'unloading', 5, '2026-05-08T14:00:00Z'),
]

// ─── Trip objects ──────────────────────────────────────────────────────────────

export const mockTrips: Trip[] = [
  // TRP-2026-0035 — closed
  {
    id: TRIP_0035_ID,
    trip_reference: 'TRP-2026-0035',
    order_number: 'FX-ORD-2026-0035',
    status: 'closed',
    journey_lock_hash: 'c2956f8a3d1e4b09f72a83c1d4e5b96f2a3c8d0e1f4a7b2c9d6e3f0a1b4c7d2',
    idvs_check_status: 'verified',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    stops: twoStops(TRIP_0035_ID, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, '2026-05-03T06:00:00Z'),
    pulsit_trip_reference_id: 'PLT-2026-0035',
    planned_departure_at: '2026-05-03T09:00:00Z',
    actual_departure_at: '2026-05-03T09:30:00Z',
    planned_arrival_at: '2026-05-03T18:00:00Z',
    actual_arrival_at: '2026-05-03T17:15:00Z',
    closed_at: '2026-05-03T19:45:00Z',
    driver: mockDrivers.find(d => d.id === DRIVER_DLAMINI_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_1_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_1_ID),
    handshakes: HANDSHAKES_0035,
    exceptions: EXCEPTIONS_0035,
    blockchain_receipts: RECEIPTS_0035,
    created_at: '2026-05-03T06:00:00Z',
    updated_at: '2026-05-03T19:45:00Z',
  },

  // TRP-2026-0038 — created
  {
    id: TRIP_0038_ID,
    trip_reference: 'TRP-2026-0038',
    order_number: 'CGY-ORD-2026-0038',
    status: 'created',
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: PRECINCT_CGY_JHB_ID,
    destination_precinct_id: PRECINCT_CGY_CT_ID,
    stops: twoStops(TRIP_0038_ID, PRECINCT_CGY_JHB_ID, PRECINCT_CGY_CT_ID, '2026-05-09T06:00:00Z'),
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-05-09T10:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-05-10T08:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_GULTIG_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_3_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_5_ID),
    handshakes: HANDSHAKES_0038,
    exceptions: [],
    blockchain_receipts: [],
    created_at: '2026-05-09T06:00:00Z',
    updated_at: '2026-05-09T06:00:00Z',
  },

  // TRP-2026-0039 — origin_gate_in
  {
    id: TRIP_0039_ID,
    trip_reference: 'TRP-2026-0039',
    order_number: 'FX-ORD-2026-0039',
    status: 'origin_gate_in',
    journey_lock_hash: 'f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',
    idvs_check_status: 'verified',
    origin_precinct_id: PRECINCT_FEDEX_DBN_ID,
    destination_precinct_id: PRECINCT_FEDEX_JHB_ID,
    stops: twoStops(TRIP_0039_ID, PRECINCT_FEDEX_DBN_ID, PRECINCT_FEDEX_JHB_ID, '2026-05-09T04:30:00Z'),
    pulsit_trip_reference_id: 'PLT-2026-0039',
    planned_departure_at: '2026-05-09T08:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-05-09T17:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_KASONGO_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_2_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_3_ID || t.id === TRAILER_4_ID),
    handshakes: HANDSHAKES_0039,
    exceptions: EXCEPTIONS_0039,
    blockchain_receipts: [
      {
        id: 'bcr-0039-h0', receipt_type: 'journey_lock',
        subject_type: 'trip', subject_id: '0039-h0',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1856,
        hedera_tx_id: null,
        data_hash: 'f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',
        hedera_consensus_timestamp: '2026-05-09T04:34:00Z', created_at: '2026-05-09T04:32:00Z',
      },
    ],
    created_at: '2026-05-09T04:30:00Z',
    updated_at: '2026-05-09T07:04:00Z',
  },

  // TRP-2026-0040 — dest_gate_in
  {
    id: TRIP_0040_ID,
    trip_reference: 'TRP-2026-0040',
    order_number: 'FX-ORD-2026-0040',
    status: 'dest_gate_in',
    journey_lock_hash: 'b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8',
    idvs_check_status: 'verified',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    stops: twoStops(TRIP_0040_ID, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, '2026-05-08T06:00:00Z'),
    pulsit_trip_reference_id: 'PLT-2026-0040',
    planned_departure_at: '2026-05-08T09:00:00Z',
    actual_departure_at: '2026-05-08T09:22:00Z',
    planned_arrival_at: '2026-05-09T17:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_FORMBY_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_2_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_2_ID),
    handshakes: HANDSHAKES_0040,
    exceptions: EXCEPTIONS_0040,
    blockchain_receipts: [
      {
        id: 'bcr-0040-h0', receipt_type: 'journey_lock',
        subject_type: 'trip', subject_id: '0040-h0',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1848,
        hedera_tx_id: null,
        data_hash: 'b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8',
        hedera_consensus_timestamp: '2026-05-08T06:04:00Z', created_at: '2026-05-08T06:02:00Z',
      },
      {
        id: 'bcr-0040-h2', receipt_type: 'pickup',
        subject_type: 'trip', subject_id: '0040-h2',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1849,
        hedera_tx_id: null,
        data_hash: 'e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
        hedera_consensus_timestamp: '2026-05-08T09:04:00Z', created_at: '2026-05-08T09:00:00Z',
      },
    ],
    created_at: '2026-05-08T06:00:00Z',
    updated_at: '2026-05-09T17:05:00Z',
  },

  // TRP-2026-0041 — in_transit (CANONICAL DEMO TRIP)
  {
    id: TRIP_0041_ID,
    trip_reference: 'TRP-2026-0041',
    order_number: 'FX-ORD-2026-0041',
    status: 'in_transit',
    journey_lock_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    idvs_check_status: 'verified',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    stops: twoStops(TRIP_0041_ID, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, '2026-05-09T05:30:00Z'),
    pulsit_trip_reference_id: 'PLT-2026-0041',
    planned_departure_at: '2026-05-09T08:00:00Z',
    actual_departure_at: '2026-05-09T08:32:00Z',
    planned_arrival_at: '2026-05-09T17:30:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_DLAMINI_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_1_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_2_ID || t.id === TRAILER_3_ID),
    handshakes: HANDSHAKES_0041,
    exceptions: EXCEPTIONS_0041,
    blockchain_receipts: [
      {
        id: 'bcr-0041-h0', receipt_type: 'journey_lock',
        subject_type: 'trip', subject_id: '0041-h0',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1851,
        hedera_tx_id: null,
        data_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        hedera_consensus_timestamp: '2026-05-09T05:34:00Z', created_at: '2026-05-09T05:32:00Z',
      },
      {
        id: 'bcr-0041-h2', receipt_type: 'pickup',
        subject_type: 'trip', subject_id: '0041-h2',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1852,
        hedera_tx_id: null,
        data_hash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
        hedera_consensus_timestamp: '2026-05-09T08:22:00Z', created_at: '2026-05-09T08:18:00Z',
      },
    ],
    created_at: '2026-05-09T05:30:00Z',
    updated_at: '2026-05-09T13:35:00Z',
  },

  // TRP-2026-0042 — in_transit
  {
    id: TRIP_0042_ID,
    trip_reference: 'TRP-2026-0042',
    order_number: 'FX-ORD-2026-0042',
    status: 'in_transit',
    journey_lock_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    idvs_check_status: 'verified',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    stops: twoStops(TRIP_0042_ID, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, '2026-05-08T14:00:00Z'),
    pulsit_trip_reference_id: 'PLT-2026-0042',
    planned_departure_at: '2026-05-08T17:00:00Z',
    actual_departure_at: '2026-05-08T17:10:00Z',
    planned_arrival_at: '2026-05-09T10:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_FORMBY_ID) ?? null,
    horse: mockHorses.find(h => h.id === HORSE_3_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_4_ID),
    handshakes: HANDSHAKES_0042,
    exceptions: EXCEPTIONS_0042,
    blockchain_receipts: [
      {
        id: 'bcr-0042-h0', receipt_type: 'journey_lock',
        subject_type: 'trip', subject_id: '0042-h0',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1853,
        hedera_tx_id: null,
        data_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        hedera_consensus_timestamp: '2026-05-08T14:04:00Z', created_at: '2026-05-08T14:02:00Z',
      },
      {
        id: 'bcr-0042-h2', receipt_type: 'pickup',
        subject_type: 'trip', subject_id: '0042-h2',
        hedera_topic_id: '0.0.4829301', hedera_sequence_number: 1854,
        hedera_tx_id: null,
        data_hash: '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
        hedera_consensus_timestamp: '2026-05-08T16:52:00Z', created_at: '2026-05-08T16:48:00Z',
      },
    ],
    created_at: '2026-05-08T14:00:00Z',
    updated_at: '2026-05-09T07:41:00Z',
  },

  // TRP-2026-0043 — created, not yet started (upcoming for Dlamini)
  {
    id: TRIP_0043_ID,
    trip_reference: 'TRP-2026-0043',
    order_number: 'FX-ORD-2026-0043',
    status: 'created',
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: PRECINCT_FEDEX_JHB_ID,
    destination_precinct_id: PRECINCT_FEDEX_DBN_ID,
    stops: twoStops(TRIP_0043_ID, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, '2026-06-22T09:00:00Z'),
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-06-25T07:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-06-25T16:00:00Z',
    actual_arrival_at: null,
    closed_at: null,
    driver: mockDrivers.find(d => d.id === DRIVER_DLAMINI_ID) ?? null,
    // HORSE_2_ID, not HORSE_1_ID: HORSE_1_ID is already committed to TRP-2026-0041
    // (in_transit, no actual_arrival_at/closed_at) — reusing it here would imply the
    // same horse is simultaneously still on the road and assigned to a new future trip.
    // HORSE_2_ID's only open assignment (TRP-2026-0040) is at dest_gate_in, the
    // second-to-last handshake, making it the most-resolved open conflict in the mock set.
    horse: mockHorses.find(h => h.id === HORSE_2_ID) ?? null,
    trailers: mockTrailers.filter(t => t.id === TRAILER_2_ID),
    handshakes: [],
    exceptions: [],
    blockchain_receipts: [],
    created_at: '2026-06-22T09:00:00Z',
    updated_at: '2026-06-22T09:00:00Z',
  },
]
