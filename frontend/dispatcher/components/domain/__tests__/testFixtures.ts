// frontend/dispatcher/components/domain/__tests__/testFixtures.ts
//
// Shared PhaseDescriptor factory for dispatcher detail-panel tests (LoadingDetail,
// ConfirmationDetail, ...). Mirrors the driver-pwa fixture of the same name
// (components/phase/__tests__/testFixtures.ts) field-for-field, but is a separate
// file — driver-pwa is owned by another dev and out of scope for this surface, and
// the two apps must not import across the surface boundary.
import type { PhaseDescriptor, PhaseEventId, PhaseType } from '@shared/lib/types/phase'

export function makePhase(phaseType: PhaseType, overrides: Partial<PhaseDescriptor> = {}): PhaseDescriptor {
  return {
    phase_event_id: 'phase-event-1' as PhaseEventId,
    trip_id: 'trip-1',
    phase_type: phaseType,
    trip_stop_id: null,
    stop_sequence: null,
    sequence_number: 1,
    status: 'in_progress',
    anchor_status: 'not_required',
    step_recipe: [],
    dispatcher_override_user_id: null,
    dispatcher_override_note: null,
    driver_phone_lat: null,
    driver_phone_lng: null,
    horse_gps_lat: null,
    horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null,
    seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null,
    gate_photo_artifact_id: null,
    pod_photo_artifact_id: null,
    pod_signature_artifact_id: null,
    parcel_count_origin: null,
    parcel_count_destination: null,
    driver_visual_count: null,
    event_hash: null,
    blockchain_receipt_id: null,
    idempotency_key: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
