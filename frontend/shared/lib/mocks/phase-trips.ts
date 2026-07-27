// Phase-shaped trip mocks — the artifact that unblocks driver-pwa work against the
// frozen contract before the live endpoints exist (parent plan §6.2, the Tim Gate).
//
// Deliberately a NEW file rather than a rewrite of ./trips.ts: that file has 14 consumers
// across both apps and `Trip.handshakes` has 6 more, so changing its shape in place would
// break both builds immediately. The handshake-shaped mocks stay until their last consumer
// goes in Stages 4 and 5. Add alongside; subtract later.

import type { PhaseDescriptor, PhaseEventId, PhaseType } from '@shared/lib/types/phase'
import { ANCHORED_PHASES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'

const peId = (v: string): PhaseEventId => v as unknown as PhaseEventId

// One stop's routing role, which is all the generator needs to decide what happens there.
// Derived on the backend from the trip's consignments (which pick up / deliver where).
export interface PlanStopInput {
  trip_stop_id: string
  sequence: number
  /** Any consignment collects cargo at this stop. */
  picks_up: boolean
  /** Any consignment delivers cargo at this stop. */
  drops_off: boolean
}

function pendingPhase(
  id: string,
  tripId: string,
  phaseType: PhaseType,
  sequenceNumber: number,
  stop: PlanStopInput | null,
  at: string,
): PhaseDescriptor {
  return {
    phase_event_id: peId(id),
    trip_id: tripId,
    phase_type: phaseType,
    trip_stop_id: stop ? stop.trip_stop_id : null,
    stop_sequence: stop ? stop.sequence : null,
    sequence_number: sequenceNumber,
    status: 'pending',
    anchor_status: ANCHORED_PHASES.includes(phaseType) ? 'pending' : 'not_required',
    step_recipe: STEP_SLUGS[phaseType],
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
    completed_at: null,
    created_at: at,
    updated_at: at,
  }
}

/**
 * Generate a trip's phase plan from its stops — parent plan §2.2.
 *
 * The rule, in words: emit `trip_creation` once with no stop; then for each stop in
 * sequence emit `activation` (first stop only) or `unloading` (if anything delivers
 * here); then `loading` (if anything collects here); then `departure` + `in_transit`
 * unless it is the final stop, where `confirmation` is emitted instead.
 *
 * `sequence_number` is simply the row's index in the emitted list — NOT an enum index.
 * A 2-stop trip yields 7 rows, a 3-stop cross-dock yields 11. The single-leg trip is the
 * degenerate case of the multi-stop plan: one code path, forever.
 *
 * This mirrors the generator Stage 2.1 implements in orchestration/trip_service.py. If
 * the two ever disagree, the backend wins and this is the bug.
 */
export function makePhasePlan(
  tripId: string,
  stops: readonly PlanStopInput[],
  at: string,
  idPrefix: string,
): PhaseDescriptor[] {
  const plan: PhaseDescriptor[] = []
  const push = (phaseType: PhaseType, stop: PlanStopInput | null): void => {
    const seq = plan.length
    plan.push(pendingPhase(`${idPrefix}-${String(seq).padStart(4, '0')}`, tripId, phaseType, seq, stop, at))
  }

  push('trip_creation', null)

  const lastIndex = stops.length - 1
  stops.forEach((stop, i) => {
    if (i === 0) push('activation', stop)
    else if (stop.drops_off) push('unloading', stop)

    if (stop.picks_up) push('loading', stop)

    if (i < lastIndex) {
      push('departure', stop)
      // in_transit anchors to the stop it DEPARTS FROM, never to the one it arrives at.
      push('in_transit', stop)
    } else {
      if (i !== 0 && !stop.drops_off) push('unloading', stop)
      push('confirmation', stop)
    }
  })

  return plan
}

// ── Canonical fixtures ────────────────────────────────────────────────────────

const AT = '2026-07-27T08:00:00Z'

export const SINGLE_LEG_TRIP_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
export const CROSS_DOCK_TRIP_ID = 'a1b2c3d4-0000-4000-8000-000000000002'

export const SINGLE_LEG_STOPS: readonly PlanStopInput[] = [
  { trip_stop_id: 'b1000000-0000-4000-8000-000000000001', sequence: 1, picks_up: true, drops_off: false },
  { trip_stop_id: 'b1000000-0000-4000-8000-000000000002', sequence: 2, picks_up: false, drops_off: true },
]

// Three-stop cross-dock: consignment A runs 1->3, B runs 1->2, C runs 2->3.
// Stop 2 therefore both drops off (B) and picks up (C) — the shape the old
// UNIQUE(trip_id, handshake_type) constraint made unrepresentable.
export const CROSS_DOCK_STOPS: readonly PlanStopInput[] = [
  { trip_stop_id: 'b2000000-0000-4000-8000-000000000001', sequence: 1, picks_up: true, drops_off: false },
  { trip_stop_id: 'b2000000-0000-4000-8000-000000000002', sequence: 2, picks_up: true, drops_off: true },
  { trip_stop_id: 'b2000000-0000-4000-8000-000000000003', sequence: 3, picks_up: false, drops_off: true },
]

/** 7 rows. */
export const SINGLE_LEG_PHASE_PLAN: PhaseDescriptor[] = makePhasePlan(
  SINGLE_LEG_TRIP_ID,
  SINGLE_LEG_STOPS,
  AT,
  'c1000000-0000-4000-8000',
)

/** 11 rows — the multi-stop proof. */
export const CROSS_DOCK_PHASE_PLAN: PhaseDescriptor[] = makePhasePlan(
  CROSS_DOCK_TRIP_ID,
  CROSS_DOCK_STOPS,
  AT,
  'c2000000-0000-4000-8000',
)
