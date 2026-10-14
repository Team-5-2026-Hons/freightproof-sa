// frontend/driver-pwa/components/phase/__tests__/testFixtures.ts
//
// Shared PhaseDescriptor factory for step-component tests. Every step now takes a real
// `phase: PhaseDescriptor` prop (StepHeader derives its title/progress from it), so each
// test needs a fixture rather than the old literal `handshake={1} step={1}` — this is the
// one place that shape is built, imported via the `@/` alias so nesting depth under
// components/phase/steps/<type>/__tests__/ never matters.
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
    blocked_on: null,
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
