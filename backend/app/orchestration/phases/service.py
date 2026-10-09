"""Phase completion engine — advance_activation through advance_confirmation.

Replaces the old fixed-5-handshake model (advance_h1..advance_h5, gated on
Trip.status). A trip's full phase plan is written at
trip creation — every PhaseEvent row a driver will ever complete
already exists, `pending`, before any of these functions ever runs. No code
path in this module may insert a PhaseEvent row.

Two shared core helpers do the gate-and-load and finish-phase work that is identical across
every phase (_gate_and_load / _finish_phase); five thin wrappers keep today's
per-phase payload shapes and evidence-writing logic and route through that
shared core for everything generic:
  1. _gate_and_load() loads the trip + phase event, verifies trip ownership,
     rejects a closed/cancelled/held trip, short-circuits an idempotent replay
     of an already-completed phase, and gates on every
     lower-sequence PhaseEvent being resolved (PhaseSequenceError otherwise) —
     the gate reads the plan (PhaseEvent.sequence_number), never trip.status.
  2. The wrapper writes its own phase-specific evidence fields — unchanged
     from the old advance_h1..h5 bodies; this task only re-routes them through
     the shared core.
  3. The wrapper sets event.status (COMPLETED or EXCEPTION) per its own
     evidence-checking logic — _finish_phase never sets it.
  4. _finish_phase() stamps idempotency_key/completed_at, recomputes
     trip.current_phase/current_stop from the ledger, closes the trip if
     nothing remains pending, and returns the updated TripDetailResponse.

advance_departure (P3) and advance_confirmation (P6) anchor to Hedera HCS: a
JSON-native canonical payload is
built by explicit versioned departure/confirmation payload builders,
hashed via the shared compute_payload_hash()
(app/blockchain/anchor_service.py — the same hasher trips and vehicles use),
then anchor_subject() submits it to Hedera and persists a BlockchainReceipt.
The seal — and with it the anchor — moved whole from
loading to departure: the driver applies and photographs the seal at
departure, not loading, so that is where the anchorable evidence now exists.
Both anchors are fail-open via _anchor_or_fail_open(): a
Hedera failure is caught, event.anchor_status is set to FAILED (a retry is
owed) instead of raising, and the phase still completes — a seal/delivery
event is evidence that already happened and must not be blocked by a Hedera
outage. event.anchor_status is set to ANCHORED on success.

Neither anchor is AWAITED any more (2026-08-05). _dispatch_anchor queues the
Hedera submit on the Celery worker once this request's transaction commits,
because a ~4-6s submit inside the request meant the driver stood holding the
swipe control for the whole round trip. The phase completes and returns with
anchor_status still PENDING; the receipt lands moments later and the driver
app already renders that interval ("anchoring in progress", AnchorProgress).
If the broker is unreachable an in-process async fallback starts immediately;
the request does not wait for Hedera, and failures remain visible through
anchor_status and logs. A periodic worker also recovers overdue receipts from
the committed phase ledger, including dispatches lost during process failure.
Every other phase anchors the same way since 2026-09-23: each
advance_* builds its own v2 canonical payload and queues it through _anchor_phase,
and a dispatcher override anchors its own PHASE_OVERRIDE record. Anchoring triggers
on the driver resolving the phase, COMPLETED or EXCEPTION alike: a phase that
recorded an anomaly is exactly the evidence a dispute needs sealed.
"""

import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PhaseTypeMismatchError
from app.db.models.enums import PhaseType
from app.orchestration.phases.advance_activation import advance_activation
from app.orchestration.phases.advance_arrival import advance_arrival
from app.orchestration.phases.advance_confirmation import advance_confirmation
from app.orchestration.phases.advance_departure import advance_departure
from app.orchestration.phases.advance_in_transit import advance_in_transit
from app.orchestration.phases.advance_loading import advance_loading
from app.orchestration.phases.advance_unloading import advance_unloading
from app.orchestration.phases.loaders import _load_phase_event, _load_trip_for_driver
from app.schemas.phases import PhaseCompleteRequest
from app.schemas.trips import TripDetailResponse


# The single entry point the API calls. The five wrappers stay —
# each writes genuinely different evidence — but the phase-type
# dispatch and the body/row cross-check live exactly once, here.
# Per-wrapper payload types differ, so the table is typed by its shared contract
# rather than per-member: complete_phase has already proven actual == payload.phase_type
# before dispatching, which is the check a precise signature would have given us.
_WrapperFn = Callable[..., Awaitable[TripDetailResponse]]


_WRAPPER_BY_PHASE_TYPE: dict[PhaseType, _WrapperFn] = {
    PhaseType.ACTIVATION: advance_activation,
    PhaseType.LOADING: advance_loading,
    PhaseType.DEPARTURE: advance_departure,
    PhaseType.IN_TRANSIT: advance_in_transit,
    PhaseType.ARRIVAL: advance_arrival,
    PhaseType.UNLOADING: advance_unloading,
    PhaseType.CONFIRMATION: advance_confirmation,
}


async def complete_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    phase_event_id: uuid.UUID, payload: PhaseCompleteRequest,
) -> TripDetailResponse:
    """Complete the addressed phase. Idempotent by payload.idempotency_key.

    Raises PhaseTypeMismatchError when the body's phase_type does not match the
    addressed row's — including when the row is trip_creation, which no driver action
    completes (create_trip writes it before a driver is involved). in_transit IS
    driver-completable as of 2026-08-09 (advance_in_transit); it used to be listed here
    alongside trip_creation.
    """
    # Ownership BEFORE the type cross-check, not after. The wrappers below all
    # gate on it too, but PhaseTypeMismatchError returns ahead of them, and its
    # 409 body names the row's real phase_type — so without this line a driver
    # holding someone else's trip_id/phase_event_id could probe a foreign trip's
    # plan by sending a deliberately wrong phase_type and reading the error.
    # A non-owner must get the same 404 as for a trip that does not exist.
    #
    # Locked here as well as in _gate_and_load: the phase row is locked on the next line, and
    # the trip lock must always come first (see loaders._lock_trip) or this would wait on the
    # phase row while an override holds the trip and waits on the same row.
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id, lock=True)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)
    actual = PhaseType(event.phase_type)
    if actual != payload.phase_type:
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    wrapper = _WRAPPER_BY_PHASE_TYPE.get(actual)
    if wrapper is None:
        # Unreachable via the API (the union has no member for these types), but
        # a direct service caller must get the same clear error, not a KeyError.
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    return await wrapper(
        db, trip_id=trip_id, driver_id=driver_id,
        phase_event_id=phase_event_id, payload=payload,
    )
