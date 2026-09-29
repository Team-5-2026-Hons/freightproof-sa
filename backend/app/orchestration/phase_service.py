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

import asyncio
import hashlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import event as event_module
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.config import settings
from app.core.geo import haversine_metres
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.core.exceptions import (
    HederaServiceError, HederaTimeoutError, PhaseBlockedError, PhaseSequenceError, PhaseTooEarlyError,
    PhaseTypeMismatchError, ResourceNotFoundError, TripActivationBlockedError, TripStateError,
)
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, ExceptionReviewStatus, ExceptionSeverity,
    ExceptionSource, ExceptionType, PhaseStatus, PhaseType, SealCondition, SubjectType, TripStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix
from app.integrations.scan_feed import ScanDirection
from app.orchestration import action_location_service, corroboration_service, scan_service
from app.orchestration.phase_gate import blocked_on_by_stop
from app.orchestration.resource_service import get_trip_detail
from app.schemas.phases import (
    ActivationCompleteRequest, ArrivalCompleteRequest, ConfirmationCompleteRequest,
    DepartureCompleteRequest, InTransitCompleteRequest, LoadingCompleteRequest,
    PhaseCompleteRequest, UnloadingCompleteRequest,
)
from app.schemas.trips import TripDetailResponse

logger = logging.getLogger(__name__)

PHASE_PAYLOAD_VERSION_V2 = 2

# Every driver-completable phase has a receipt type. trip_creation is absent on purpose:
# it is anchored by create_trip as the JOURNEY_LOCK, not through this path.
_PHASE_RECEIPT_TYPES = {
    PhaseType.ACTIVATION: BlockchainReceiptType.ACTIVATION,
    PhaseType.LOADING: BlockchainReceiptType.LOADING,
    PhaseType.DEPARTURE: BlockchainReceiptType.PICKUP,
    PhaseType.IN_TRANSIT: BlockchainReceiptType.TRANSIT_ARRIVAL,
    PhaseType.ARRIVAL: BlockchainReceiptType.ARRIVAL_INSPECTION,
    PhaseType.UNLOADING: BlockchainReceiptType.UNLOADING,
    PhaseType.CONFIRMATION: BlockchainReceiptType.DELIVERY,
}


def receipt_type_for(event: PhaseEvent) -> BlockchainReceiptType:
    """The receipt type this row's anchor must carry. An overridden row anchors the
    override record, never the phase's own type: the receipt must not claim the driver
    evidenced a phase a dispatcher resolved on their behalf."""
    if event.status == PhaseStatus.OVERRIDDEN:
        return BlockchainReceiptType.PHASE_OVERRIDE
    return _PHASE_RECEIPT_TYPES[PhaseType(event.phase_type)]

# asyncio keeps only weak references to scheduled tasks. Retain dispatches and
# fallback anchors until their completion callback has observed the result.
_BACKGROUND_ANCHOR_TASKS: set[asyncio.Task[bool]] = set()


def _initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:
    """Delegates to exception_service.initial_review_status so every
    TripException this module writes routes its review_status through the same
    severity->status rule as the driver-raised path, instead of hand-coding a value or
    relying on the column's server_default.

    Imported lazily, not at module scope: exception_service imports
    phase_service.current_phase_event at ITS module load, so a top-level import here
    would try to read exception_service while it is still mid-import — deadlocking on
    the partially-initialised module. This function only runs at request time, by
    which point both modules have finished loading.
    """
    from app.orchestration.exception_service import initial_review_status

    return initial_review_status(severity)


async def _load_trip_for_driver(db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID) -> Trip:
    result = await db.execute(select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_trip_for_dispatcher(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
) -> Trip:
    """Dispatcher-scoped trip lookup — the override counterpart to _load_trip_for_driver.

    Filters by org, not driver: overriding a phase is a dispatcher action, and the
    org boundary is the caller's real authorisation scope. 404, never 403, on a
    trip belonging to another org — same no-existence-disclosure rule as everywhere
    else in this module.
    """
    result = await db.execute(
        select(Trip).where(
            Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id,
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_phase_event(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
) -> PhaseEvent:
    """The single load point every completion path (complete_phase's five
    advance_* wrappers, and override_phase) shares — which is why
    the lock below covers all of them from one place.

    Row-locked with FOR UPDATE. Two concurrent completions of the SAME
    phase both pass _gate_and_load's sequence gate and would both dispatch to
    Hedera before the partial unique index on idempotency_key ever fires —
    that index only fires at flush, which is AFTER the anchor has already been
    queued (_dispatch_anchor's after_commit hook), and a DB rollback cannot
    un-submit an on-chain message. The lock, not the index, is what stops the
    second submission from happening at all: the second transaction blocks
    here until the first commits, then re-reads this row as resolved and
    returns _gate_and_load's existing idempotent-replay 200 — no new code path.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip_id)
        .with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ResourceNotFoundError("PhaseEvent", str(phase_event_id))
    return event


async def _assert_artifacts_belong_to_trip(
    db: AsyncSession, *, trip_id: uuid.UUID, artifact_ids: tuple[uuid.UUID | None, ...],
) -> dict[uuid.UUID, str]:
    """Every artifact a phase cites as its evidence must belong to THIS trip.

    Without this, a caller could attach any artifact UUID in the system to a phase:
    another trip's seal photo standing in as this trip's, or a POD from an entirely
    different delivery. The FK alone does not prevent that — it only proves the row
    exists somewhere. On a platform whose whole claim is "this photo is what happened
    on this trip", an unowned artifact is a forged evidence chain, and it would still
    hash into the journey record as if genuine.

    Raises ResourceNotFoundError (404 at the endpoint) rather than a 4xx that
    distinguishes "wrong trip" from "no such artifact": from this trip's perspective
    both are the same fact — the artifact is not available here — and saying which
    would confirm the existence of another trip's evidence to a caller who cannot
    otherwise see it.

    None entries are skipped so optional artifact fields can pass through unchanged.
    Returns the owned artifacts' stored SHA-256 digests so an anchoring caller does
    not need a second database round trip after this ownership check.
    """
    present = {aid for aid in artifact_ids if aid is not None}
    if not present:
        return {}

    result = await db.execute(
        select(EvidenceArtifact.id, EvidenceArtifact.file_hash).where(
            EvidenceArtifact.id.in_(present),
            EvidenceArtifact.trip_id == trip_id,
        )
    )
    owned = {artifact_id: file_hash for artifact_id, file_hash in result.all()}

    missing = present - owned.keys()
    if missing:
        # Sorted so the message is deterministic across runs — this ends up in an
        # API error body and in test assertions.
        raise ResourceNotFoundError(
            "EvidenceArtifact", ", ".join(sorted(str(m) for m in missing)),
        )
    return owned


def _is_resolved(status: PhaseStatus) -> bool:
    # A phase blocks the NEXT phase only while PENDING/IN_PROGRESS. EXCEPTION is
    # resolved for gating purposes — it already happened, the trip already moved
    # on, and the anomaly is recorded on the row itself.
    #
    # No phase completion holds a trip any more: the last writer of
    # TripStatus.EXCEPTION_HOLD (advance_unloading's seal mismatch) was removed —
    # see the rationale on that branch. EXCEPTION_HOLD survives as a status only
    # for a future MANUAL dispatcher hold; nothing in app/ sets it today, so the
    # _gate_and_load check that reads it is currently unreachable.
    return status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)


async def _gate_and_load(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    phase_label: str,
) -> tuple[Trip, PhaseEvent] | TripDetailResponse:
    """Loads and validates the trip and phase event before completion. Returns
    (trip, event) to continue, or a TripDetailResponse if idempotent replay
    already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if _is_resolved(event.status):
        # Idempotent replay — COMPLETED, EXCEPTION, and OVERRIDDEN
        # are all "already decided" per _is_resolved's own predicate, matched here so a
        # replayed completion that landed in EXCEPTION — e.g. a resent
        # offline-queue entry for a seal mismatch — is caught here too,
        # instead of falling through to re-execute the wrapper body and
        # double-write evidence/exceptions on every resend). Checked BEFORE
        # the trip-status check below on purpose: a phase whose own
        # completion is what closed/held the trip (e.g. advance_confirmation's
        # count-mismatch branch, which sets EXCEPTION and lets the trip close)
        # must still replay as an idempotent 200 — not a 409 — even though
        # trip.status now reads CLOSED as a result of that same completion.
        # (CLOSED is the only status a completion can produce today; see
        # _is_resolved on why EXCEPTION_HOLD no longer occurs here.)
        # A genuinely new attempt at a still-PENDING phase on a
        # dead/held trip falls through to the trip-status check unaffected,
        # since _is_resolved(PENDING) is False.
        return await get_trip_detail(
            db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id,
        )

    # EXCEPTION_HOLD is listed but no production path sets it (see _is_resolved).
    # Kept deliberately so a manual dispatcher hold, when it lands, gates phase
    # completion by construction rather than needing this check re-derived — and
    # the behaviour stays covered meanwhile by
    # test_phases.py::test_activation_complete_wrong_state_returns_409, which sets
    # the status directly. Do not read its presence here as evidence that some
    # mismatch still holds a trip: none does.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD):
        # Trip.status is a plain String(30) column: a freshly DB-loaded trip
        # (every real request — get_db() hands out a fresh session per call)
        # yields a raw str here, not the TripStatus enum, so `.value` alone
        # would crash on the single most common path to this branch.
        # TripStatus(...) normalises either shape before reading .value.
        raise PhaseSequenceError(f"trip status is '{TripStatus(trip.status).value}'", phase_label)

    # No phase-type exclusion here. IN_TRANSIT used to be skipped, and had to be: since it
    # stopped auto-completing on departure it stayed PENDING for the whole drive at a LOWER
    # sequence than the arrival phase, so gating on it made advance_unloading unreachable —
    # the call was rejected here, hundreds of lines before the branch that closed the row.
    # The trip could never leave the driving leg.
    #
    # The exclusion went away with its cause (2026-08-09): in_transit is now closed by the
    # driver's own arrival submission (advance_in_transit), at its own sequence position,
    # so the ordinary ordering rule covers it and a PENDING in_transit correctly blocks an
    # unloading — an arrival that was never attested to is exactly the gap this platform
    # exists to surface. A driver who cannot submit it (dead phone) is recovered by the
    # dispatcher's in_transit override, which resolves the row through the normal path.
    lower_result = await db.execute(
        select(PhaseEvent.status).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.sequence_number < event.sequence_number,
        )
    )
    if any(not _is_resolved(PhaseStatus(status)) for (status,) in lower_result.all()):
        # trip.status is usually just ACTIVE/CREATED here — it isn't the real
        # blocker, an unresolved earlier phase is, so the message says that
        # instead of misleadingly implying trip.status caused the 409.
        raise PhaseSequenceError("an earlier phase in the plan is still unresolved", phase_label)

    # AFTER the _is_resolved replay short-circuit above, never before it. A resent
    # offline-queue entry for an already-successful completion must return current
    # state, not 409 — otherwise the driver app's queue never drains. This ordering
    # is covered by test_an_idempotent_replay_of_a_completed_phase_does_not_409.
    if event.trip_stop_id is not None:
        gate = await blocked_on_by_stop(db, trip_id=trip_id)
        if gate.get((PhaseType(event.phase_type), event.trip_stop_id)) is not None:
            raise PhaseBlockedError(phase_label)

    return trip, event


async def recompute_position(db: AsyncSession, trip: Trip) -> None:
    """Recomputes trip.current_phase/current_stop from the ledger. Public because
    create_trip must seed the cache the moment the plan exists — before this, a
    freshly created trip reported current_phase = NULL until its first advance.

    trip_stop_id is a FK, not the sequence int the cache wants — the join to
    TripStop.sequence is why this can't be a plain PhaseEvent-only query.
    """
    result = await db.execute(
        select(PhaseEvent.phase_type, PhaseEvent.status, TripStop.sequence)
        .outerjoin(TripStop, TripStop.id == PhaseEvent.trip_stop_id)
        .where(PhaseEvent.trip_id == trip.id)
        .order_by(PhaseEvent.sequence_number)
    )
    for phase_type, status, stop_sequence in result.all():
        if not _is_resolved(PhaseStatus(status)):
            trip.current_phase = phase_type
            trip.current_stop = stop_sequence
            return
    trip.current_phase = None
    trip.current_stop = None
    trip.status = TripStatus.CLOSED
    trip.closed_at = datetime.now(UTC)


async def current_phase_event(db: AsyncSession, trip_id: uuid.UUID) -> PhaseEvent | None:
    """The phase row a trip is sitting on right now — the same ledger walk
    recompute_position does, returning the row itself instead of caching its type and
    stop onto the trip.

    Exists so an event that happens OUTSIDE a phase completion — a panic hold, a
    breakdown — can still be tagged with the phase it happened during. Every
    TripException this module writes already carries phase_event_id because it has an
    `event` in hand; the driver-raised ones (exception_service) have no such handle and
    were landing untagged, which pushed placement onto the dispatcher's render-time
    fallback and let an exception appear to move between phases as the trip advanced.

    Falls back to the highest-sequence row once every phase is resolved: on a closed
    trip nothing is unresolved, and confirmation is genuinely where the trip is — that
    is placement, not a guess. Returns None only for a trip with no plan at all.

    Resolved by sequence_number, never by matching on phase_type: a cross-dock plan
    carries one in_transit row per leg and only the ordering identifies the right one.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    events = list(result.scalars().all())
    for event in events:
        if not _is_resolved(PhaseStatus(event.status)):
            return event
    return events[-1] if events else None


async def anchor_phase_event(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> bool:
    """Load a phase event by id and anchor it. Returns whether a receipt was written.

    The entry point tasks/blockchain.py re-enters this module through, so the anchoring
    contract (canonical payload in, fail-open on Hedera trouble) stays defined here
    rather than being duplicated in a worker.
    """
    result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id).with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        # Nothing to anchor and nothing to retry — the row a receipt was owed against is
        # gone. Loud, because it should be impossible: the dispatch only happens after
        # the transaction that wrote this row has committed.
        logger.error("Anchor requested for unknown phase_event_id=%s", phase_event_id)
        return False

    event.updated_at = datetime.now(UTC)

    # Celery delivery is at-least-once. Serialize duplicate workers on this row and
    # never submit a second HCS message once the first worker linked its receipt.
    if event.blockchain_receipt_id is not None:
        event.anchor_status = AnchorStatus.ANCHORED
        return True

    payload_hash = compute_payload_hash(canonical_payload)
    expected_receipt_type = (
        receipt_type_for(event) if event.phase_type in _PHASE_RECEIPT_TYPES else None
    )
    if event.event_hash != payload_hash or receipt_type != expected_receipt_type:
        logger.error(
            "Rejected invalid anchor task for phase_event_id=%s: payload or receipt type mismatch",
            phase_event_id,
        )
        event.anchor_status = AnchorStatus.FAILED
        return False

    await _anchor_or_fail_open(
        db, event=event, canonical_payload=canonical_payload, receipt_type=receipt_type,
    )
    return event.anchor_status == AnchorStatus.ANCHORED


async def recover_phase_anchor(db: AsyncSession, *, due_before: datetime) -> bool | None:
    """Attempt one overdue receipt; None means no eligible unlocked row remains.

    Each attempt gets its own transaction in the task. SKIP LOCKED prevents two
    recovery workers from waiting on the same phase, and updated_at rotates failures
    to the back of the queue instead of starving newer debts.
    """
    from app.orchestration.verification_service import reconstruct_pending_phase_payload

    event = (await db.execute(
        select(PhaseEvent).where(
            PhaseEvent.phase_type.in_(_PHASE_RECEIPT_TYPES),
            PhaseEvent.status.in_((PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)),
            PhaseEvent.anchor_status.in_((AnchorStatus.PENDING, AnchorStatus.FAILED)),
            PhaseEvent.event_hash.is_not(None),
            PhaseEvent.blockchain_receipt_id.is_(None),
            PhaseEvent.completed_at.is_not(None),
            PhaseEvent.updated_at < due_before,
        ).order_by(PhaseEvent.updated_at, PhaseEvent.id).limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if event is None:
        return None

    event.updated_at = datetime.now(UTC)
    payload = await reconstruct_pending_phase_payload(db, event)
    if payload is None:
        event.anchor_status = AnchorStatus.FAILED
        logger.error("Cannot recover original payload for phase_event_id=%s; receipt still owed", event.id)
        return False
    return await anchor_phase_event(
        db, phase_event_id=event.id, canonical_payload=payload,
        receipt_type=receipt_type_for(event),
    )


def _dispatch_anchor(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Queue this event's anchor for the worker, AFTER this request's transaction commits.

    Anchoring moved off the request path because a Hedera submit takes ~4-6s and the
    driver was holding a swipe control for all of it. The phase is evidence the moment it
    is written; the receipt is a separate fact that lands shortly after, which is exactly
    what anchor_status (PENDING -> ANCHORED/FAILED) and the driver app's "anchoring in
    progress" state already describe.

    Two things make this safe rather than merely faster:

    * It fires on after_commit, never before. The worker opens its OWN session, so a task
      dispatched mid-transaction could look for a phase_event row that isn't committed yet
      and find nothing.
    * If the broker cannot be reached, it schedules an immediate in-process fallback.
      This preserves the anchor attempt without turning the API event loop into a
      blocking Hedera worker.
    """
    # Imported at call time: tasks/blockchain.py imports this module back, and Celery's
    # own import is heavy enough to be worth keeping out of the request path's cold start.
    from app.tasks.blockchain import anchor_phase_event_task

    event_id = event.id
    payload = dict(canonical_payload)
    event.anchor_status = AnchorStatus.PENDING

    async def _publish() -> bool:
        try:
            await asyncio.to_thread(
                anchor_phase_event_task.delay, str(event_id), payload, receipt_type.value,
            )
        except Exception:  # noqa: BLE001 — any broker failure, not just one library's
            logger.exception(
                "Could not queue the anchor for phase_event_id=%s — scheduling local fallback",
                event_id,
            )
            _schedule_anchor_after_dispatch_failure(
                phase_event_id=event_id, canonical_payload=payload, receipt_type=receipt_type,
            )
        return True

    def _send(_session: Any) -> None:
        _retain_anchor_task(asyncio.get_running_loop().create_task(_publish()), event_id)

    # sync_session: SQLAlchemy's event system is synchronous, and after_commit is the
    # only hook that fires once this request's write is actually durable.
    event_module.listens_for(db.sync_session, "after_commit", once=True)(_send)


def _schedule_anchor_after_dispatch_failure(
    *, phase_event_id: uuid.UUID, canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
) -> None:
    """Start a last-resort in-process anchor when the broker is unreachable.

    The coroutine uses its own session because the request transaction has committed.
    Scheduling it on the existing server loop avoids both illegal nested asyncio.run()
    calls and blocking every request while Hedera responds.
    """
    from app.tasks.blockchain import _anchor

    anchor = _anchor(
        phase_event_id=phase_event_id,
        canonical_payload=canonical_payload,
        receipt_type=receipt_type,
    )
    task = asyncio.get_running_loop().create_task(anchor)
    _retain_anchor_task(task, phase_event_id)


def _retain_anchor_task(task: asyncio.Task[bool], phase_event_id: uuid.UUID) -> None:
    """Observe best-effort dispatch/fallback work; the ledger backs crash recovery."""
    _BACKGROUND_ANCHOR_TASKS.add(task)

    def _observe_result(completed: asyncio.Task[bool]) -> None:
        _BACKGROUND_ANCHOR_TASKS.discard(completed)
        try:
            completed.result()
        except asyncio.CancelledError:
            logger.warning(
                "Background anchor work cancelled for phase_event_id=%s; recovery will retry",
                phase_event_id,
            )
        except Exception:  # noqa: BLE001 — task boundary must observe every failure
            logger.exception(
                "Background anchor work failed for phase_event_id=%s; recovery will retry",
                phase_event_id,
            )

    task.add_done_callback(_observe_result)


def _anchor_phase(db: AsyncSession, *, event: PhaseEvent, canonical_payload: dict[str, Any]) -> None:
    """Commit this row to its payload hash and queue the anchor.

    The hash is written on the row in the same transaction as the evidence, so the
    recovery sweep and verification can rebuild the payload later and prove it
    unchanged. Call only once the row's status is final for this request (COMPLETED,
    EXCEPTION or OVERRIDDEN), because receipt_type_for reads it.
    """
    event.event_hash = compute_payload_hash(canonical_payload)
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload, receipt_type=receipt_type_for(event),
    )


async def _anchor_or_fail_open(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Anchor a phase event to Hedera without ever blocking phase completion.

    subject_id/trip_id are deliberately not separate parameters — both are always
    event.id/event.trip_id at every call site, and taking them independently would
    let a future caller anchor one subject while stamping the receipt onto a
    different, mismatched event. Deriving them from `event` makes that impossible.

    Unlike P0's (create_trip's) anchor, which must stay fail-closed because there
    is no committed trip yet to salvage, a phase event already represents evidence
    that genuinely happened — driver custody didn't pause because Hedera was slow.
    A failed anchor is recorded as a retry-owed debt (`anchor_status = FAILED`)
    rather than raised, so the caller can still flip the phase to COMPLETED.

    Also the first place in this module that ever sets `anchor_status` post-creation
    (the plan generator only ever set it to PENDING) — ANCHORED on success,
    FAILED on failure, matching the AnchorStatus contract that `anchor_status` is
    the one place to check whether a receipt is actually owed.
    """
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
            canonical_payload=canonical_payload, receipt_type=receipt_type, trip_id=event.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as exc:
        # Preserve the failure reason while the worker retries the durable debt.
        logger.exception(
            "Anchor failed for phase_event_id=%s (fail-open): retry owed — %s", event.id, exc,
        )
        event.anchor_status = AnchorStatus.FAILED
        return
    event.blockchain_receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED


# Where a rendered separation crosses from metres to kilometres. A gap under a
# kilometre printed as "0.3 km" reads as rounding noise, when 300 m is the
# difference between standing at the gate and standing across the yard.
_SEPARATION_KM_THRESHOLD_METRES = 1000


def _format_separation(metres: float) -> str:
    """A distance in the units a dispatcher reads at a glance."""
    if metres < _SEPARATION_KM_THRESHOLD_METRES:
        return f"{round(metres)} m"
    return f"{metres / _SEPARATION_KM_THRESHOLD_METRES:.1f} km"


def _phone_tracker_separation_metres(event: PhaseEvent) -> float | None:
    """How far apart the two independent position sources were, or None.

    None means "not measurable" — one of the two sources recorded no fix — and is
    never conflated with 0.0, which is a real and opposite claim: the phone and the
    tracker agreed exactly. Mirrors separationMetres() in the dispatcher's
    lib/phase/geo.ts, which computes the same number from the same two columns for
    the same card.
    """
    if (
        event.driver_phone_lat is None or event.driver_phone_lng is None
        or event.horse_gps_lat is None or event.horse_gps_lng is None
    ):
        return None
    return haversine_metres(
        event.driver_phone_lat, event.driver_phone_lng,
        event.horse_gps_lat, event.horse_gps_lng,
    )


async def _raise_position_disagreement_if_unrecorded(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
) -> None:
    """Record GPS_MISMATCH when Pulsit measured the vehicle away from this stop (FP-145).

    Consumes what FP-143's corroboration_service wrote moments earlier in this same
    request; computes nothing about geofences itself.

    ── ONLY FALSE RAISES. NEVER NULL. ────────────────────────────────────────────
    `is False`, deliberately, and never `not confirmed`. FP-143's three-state column
    reads NULL for "we could not check" — an unreachable tracker, a dark unit, a
    precinct with no coordinates — and `not None` is True, so the looser test would
    put a position disagreement against the name of every driver who drove through a
    coverage dead zone on the N3. FALSE is a measurement; NULL is an admission that
    no measurement exists. This one line is what keeps them apart.

    ── Why this lives here and not in exception_service ──────────────────────────
    exception_service owns DRIVER-raised exceptions: its entry point asserts the
    caller is the trip's assigned driver and stamps ExceptionSource.DRIVER on the
    row. Routing a system measurement through it would file the finding as something
    the driver reported about themselves, which is precisely backwards — the value of
    this exception is that a source the driver cannot influence produced it. Every
    other system-detected exception (parcel count, seal mismatch, seal unverified,
    waybill count) is written here, in this module, with source=SYSTEM; this follows
    that path rather than inventing a second one. exception_service also imports this
    module, so the reverse import would be circular.

    ── Idempotent against the phase event ────────────────────────────────────────
    _gate_and_load already short-circuits a replayed completion before any wrapper
    body runs, so a re-synced offline handshake should never reach here twice. The
    existence check is kept anyway, for the same reason FP-143 re-checks a fix's
    timestamp it has been promised: evidence writes should not depend on another
    function's invariant holding. One exception per phase event, and the check is
    NOT filtered on `resolved` — a dispatcher who has already actioned this finding
    must not have a duplicate reappear when the driver app flushes its queue again.

    Never raises. A handshake is evidence that already physically happened; a fault
    while annotating it must not undo it. Same fail-open stance as
    _anchor_or_fail_open and record_phase_corroboration.
    """
    if event.pulsit_geofence_confirmed is not False:
        return

    try:
        existing = (await db.execute(
            select(TripException.id).where(
                TripException.phase_event_id == event.id,
                TripException.exception_type == ExceptionType.GPS_MISMATCH,
            )
        )).first()
        if existing is not None:
            return

        separation = _phone_tracker_separation_metres(event)
        if separation is None:
            description = (
                "The vehicle tracker's position is outside this stop's geofence at this "
                "handshake. Only one of the two position sources recorded a fix, so the "
                "separation between them could not be measured."
            )
        else:
            description = (
                f"Driver phone and vehicle tracker reported positions "
                f"{_format_separation(separation)} apart at this handshake. The tracker's "
                f"position is outside this stop's geofence."
            )

        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=event.id,
            # Scoped to the stop the phase is anchored to, as every other
            # system-detected exception in this module already does.
            trip_stop_id=event.trip_stop_id,
            exception_type=ExceptionType.GPS_MISMATCH,
            source=ExceptionSource.SYSTEM,
            # WARNING, not CRITICAL, and the choice is the copy rule in code form.
            # CRITICAL is this codebase's alarm tier: a seal mismatch, a panic button,
            # a seal broken in transit — findings with no benign reading. A single
            # geofence measurement has several: tracker drift, a stale cached fix, a
            # vehicle legitimately parked outside the fence while the driver walks in
            # to the gate office, or a precinct row whose coordinates or radius are
            # wrong. Putting a class of finding with real false-positive modes into
            # the alarm lane is how a dispatcher learns to ignore the alarm lane.
            # WARNING is also what the comparable measurement disagreement
            # (PARCEL_COUNT_MISMATCH) already uses. The separation is reported; the
            # dispatcher decides what it means.
            severity=ExceptionSeverity.WARNING,
            review_status=_initial_review_status(ExceptionSeverity.WARNING),
            description=description,
            # The driver's own fix, which is what this column means on every other
            # writer. The tracker's fix has no column here and needs none: both
            # positions live on the phase_events row this exception points at, and
            # copying them into the exception would create a second version of the
            # same coordinates that could drift out of step with the first. The
            # separation is likewise recomputed at render time from those two
            # columns, per FP-143's note — no derived value is persisted.
            gps_lat=event.driver_phone_lat,
            gps_lng=event.driver_phone_lng,
        ))

        logger.info(
            "Recorded GPS_MISMATCH for phase_event_id=%s trip_id=%s: separation=%s",
            event.id, trip.id,
            "not measurable" if separation is None else f"{separation:.1f}m",
        )

        # FP-147's invariant: a system-detected exception that tells no one leaves the
        # dispatcher's screen showing a trip that no longer matches the record. WARNING
        # to match the row written above — event_severity widens the same value rather
        # than restating it, so the toast band cannot drift from the stored severity.
        # Inside the try: enqueue_event only appends to a session-local buffer, but if
        # it ever raises, a handshake the driver already completed must not 400.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    except Exception:
        # Deliberate broad catch, logged with a traceback per the project's error
        # rules, not a silent swallow. The driver is standing at a gate and has
        # already done the thing being recorded.
        logger.exception(
            "Could not record a position disagreement for phase_event_id=%s — the "
            "handshake stands and the corroboration columns still carry the finding",
            event.id,
        )


async def _raise_trailer_decoupling_if_unrecorded(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
) -> None:
    """Record TRAILER_LOCATION_MISMATCH when a trailer was measured away from its horse.

    Three conditions, all measurements, all required:
      1. the horse was measured INSIDE this stop's precinct (TRUE, not NULL),
      2. a trailer was measured OUTSIDE it (its snapshot's FALSE, not NULL), and
      3. that trailer's fix is further than TRAILER_HORSE_MAX_SEPARATION_METRES from
         the horse's own fix.

    CRITICAL, unlike GPS_MISMATCH's WARNING (see its reasoning above), because the
    conditions remove GPS_MISMATCH's benign readings. The horse's own TRUE shows the
    precinct's coordinates and the horse tracker are sound, so "wrong precinct data" is
    out. The separation rule removes the fence-edge case: a coupled trailer ~20 m behind
    a horse at the boundary can read outside while its horse reads inside, but it cannot
    be hundreds of metres from it. What is left is a trailer that is not where its horse
    is: uncoupled, one of the strongest theft signals the system can see.

    Same stance as _raise_position_disagreement_if_unrecorded: NULL never raises,
    idempotent per phase event, and never raises out of here.
    """
    if event.pulsit_geofence_confirmed is not True:
        return
    if event.horse_gps_lat is None or event.horse_gps_lng is None:
        return

    try:
        outside = (await db.execute(
            select(TrailerGpsSnapshot, Vehicle.registration)
            .join(Vehicle, Vehicle.id == TrailerGpsSnapshot.trailer_id)
            .where(
                TrailerGpsSnapshot.phase_event_id == event.id,
                TrailerGpsSnapshot.geofence_confirmed.is_(False),
            )
        )).all()
        decoupled: list[tuple[str, float]] = []
        for snapshot, registration in outside:
            separation = haversine_metres(
                snapshot.lat, snapshot.lng, event.horse_gps_lat, event.horse_gps_lng,
            )
            if separation > settings.TRAILER_HORSE_MAX_SEPARATION_METRES:
                decoupled.append((registration, separation))
        if not decoupled:
            return

        existing = (await db.execute(
            select(TripException.id).where(
                TripException.phase_event_id == event.id,
                TripException.exception_type == ExceptionType.TRAILER_LOCATION_MISMATCH,
            )
        )).first()
        if existing is not None:
            return

        # Registrations identify vehicles, not people, so they may be named here.
        trailers = "; ".join(
            f"trailer {registration} is {_format_separation(separation)} from the horse"
            for registration, separation in decoupled
        )
        db.add(TripException(
            trip_id=trip.id, phase_event_id=event.id, trip_stop_id=event.trip_stop_id,
            exception_type=ExceptionType.TRAILER_LOCATION_MISMATCH,
            source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            review_status=_initial_review_status(ExceptionSeverity.CRITICAL),
            description=(
                f"The horse's tracker is inside this stop's geofence, but {trailers} and "
                f"outside the geofence. The trailer may have been uncoupled."
            ),
        ))
        logger.info(
            "Recorded TRAILER_LOCATION_MISMATCH for phase_event_id=%s trip_id=%s: %s",
            event.id, trip.id, trailers,
        )
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )

    except Exception:
        # Same deliberate, logged broad catch as the GPS_MISMATCH check above: the
        # snapshots still carry every verdict, so nothing recorded is lost.
        logger.exception(
            "Could not record a trailer decoupling for phase_event_id=%s — the handshake "
            "stands and the trailer snapshots still carry their verdicts",
            event.id,
        )


async def _finish_phase(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent, idempotency_key: str,
    horse_fix: PulsitFix | None = None, driver_accuracy_metres: float | None = None,
) -> TripDetailResponse:
    """`horse_fix`/`driver_accuracy_metres`: the SAME Pulsit fix each
    wrapper's own call to corroboration_service.record_phase_corroboration already
    obtained a few lines earlier, and the request's own driver-claimed phone
    accuracy — both threaded through as keyword-only, defaulted, arguments rather
    than positional ones, so every existing call site not yet touched keeps
    compiling unchanged. See action_location_service.build_phase_assessment's
    own docstring for why this function does not re-fetch the fix itself."""
    event.idempotency_key = idempotency_key
    event.completed_at = event.completed_at or datetime.now(UTC)

    if event.phase_type == PhaseType.IN_TRANSIT and event.status == PhaseStatus.COMPLETED:
        # The trip-wide arrival is the final driving leg's evidence timestamp.
        # Intermediate stops and dispatcher overrides do not attest final arrival.
        later_leg = await db.execute(
            select(PhaseEvent.id).where(
                PhaseEvent.trip_id == trip.id,
                PhaseEvent.phase_type == PhaseType.IN_TRANSIT,
                PhaseEvent.sequence_number > event.sequence_number,
            ).limit(1)
        )
        if later_leg.scalar_one_or_none() is None:
            trip.actual_arrival_at = event.completed_at

    # FP-145. Placed on the one path every handshake converges on, and AFTER each
    # wrapper's own call to record_phase_corroboration, so the verdict being read
    # here is the one this handshake just produced. Before the flush below, so the
    # finding is already in the TripDetailResponse this request returns.
    await _raise_position_disagreement_if_unrecorded(db, trip=trip, event=event)
    # A separate question from the horse's: is each TRAILER where its horse is?
    await _raise_trailer_decoupling_if_unrecorded(db, trip=trip, event=event)

    # Independent of the GPS_MISMATCH check above — that asks "does the
    # TRACKER agree with the PRECINCT?"; this asks "does the DRIVER'S OWN PHONE agree
    # with the TRACKER?" — two different pairs of things that can each fail alone, or
    # together, on the same handshake. evaluated_at is stamped fresh HERE, not reused
    # from event.completed_at, because it is the instant the SERVER is judging the
    # separation, not the instant the driver's phone claims to have submitted it (the
    # skew between those two is exactly what the assessment's own reasons can surface).
    #
    # Fail-open, for exactly the reason record_phase_corroboration is: the driver has
    # already physically performed this handshake, and the assessment is a derived
    # comparison of telemetry, not the evidence itself. If assembling or recording it
    # fails for any reason, the column stays NULL — which the schema defines as "not
    # assessed" — the traceback is logged, and the completion still lands. A 500 here
    # would roll back a swipe the offline queue could then only ever replay into the
    # same failure. The separation finding uses its own SAVEPOINT for its insert, so
    # a failure inside it leaves the outer transaction usable for the flush below.
    evaluated_at = datetime.now(UTC)
    try:
        assessment = await action_location_service.build_phase_assessment(
            db, trip=trip, event=event, horse_fix=horse_fix,
            driver_accuracy_metres=driver_accuracy_metres, evaluated_at=evaluated_at,
        )
        event.action_location_assessment = assessment.model_dump(mode="json")
        await action_location_service.record_separation_finding(
            db, trip=trip, phase_event_id=event.id, checkpoint_id=None, assessment=assessment,
            driver_reason=event.location_warning_reason,
        )
        # Closes the gap DRIVER_VEHICLE_SEPARATION alone leaves open (see that
        # function's own docstring and action_location_service's module docstring):
        # a phone measurably outside the precinct with a stale/unavailable tracker
        # fix would otherwise raise nothing at all. Same fail-open block, same
        # driver-typed reason, same event.
        await action_location_service.record_driver_location_finding(
            db, trip=trip, phase_event_id=event.id, assessment=assessment,
            driver_reason=event.location_warning_reason,
        )
    except Exception:
        logger.exception(
            "Action-location assessment failed for phase_event_id=%s — handshake continues, "
            "assessment recorded as not assessed", event.id,
        )

    await recompute_position(db, trip)
    await db.flush()

    # Notify dispatchers watching this trip. The completion may also have CLOSED the trip
    # (advance_confirmation, phase_service.py) — distinguish the two so the UI raises the
    # right signal. Published on commit, never here; a thin ping, no trip data.
    kind = RealtimeKind.TRIP_CLOSED if TripStatus(trip.status) == TripStatus.CLOSED else RealtimeKind.PHASE_COMPLETED
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=kind))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


async def override_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
    operator_organization_id: uuid.UUID, user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for ONE phase the driver physically cannot
    complete — lost phone, left the depot, device wiped, bound to a device that
    is gone. Without this, a single unreachable phase blocked every
    later phase forever (_gate_and_load's lower-sequence gate has no other exit).

    Lives here, not in trip_admin.py: it writes a PhaseEvent and must call
    recompute_position, both of which this module owns.

    Raises ResourceNotFoundError (404) if the trip doesn't exist/belongs to
    another org, or the phase_event doesn't belong to this trip. Raises
    TripStateError (409) on a trip that has already reached a terminal state, and
    PhaseSequenceError (409) if the row is already COMPLETED — a resolved row
    needs no override, and completed evidence must not be rewritable.
    """
    trip = await _load_trip_for_dispatcher(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id,
    )

    # A terminal trip is not overridable, and this guard is load-bearing rather
    # than defensive. cancel_trip deliberately leaves every phase row PENDING —
    # that is the honest record of a plan abandoned partway through — so on a
    # CANCELLED trip every row still looks overridable. recompute_position()
    # below ends with an UNCONDITIONAL trip.status = CLOSED once nothing is
    # unresolved, so overriding the last pending row of a cancelled trip would
    # silently rewrite CANCELLED as CLOSED and destroy the terminal fact the
    # cancellation recorded. complete_phase never hits this because it goes
    # through _gate_and_load, which already checks trip status; override_phase
    # deliberately does not use that driver-scoped gate, so it needs its own.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(
            current_status=TripStatus(trip.status).value,
            attempted_action="override a phase on",
        )

    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if event.status not in (PhaseStatus.PENDING, PhaseStatus.IN_PROGRESS):
        # Matches PhaseSequenceError's existing vocabulary ("cannot complete X:
        # reason") rather than inventing a new exception type for one more state
        # check — the reason clause just names the row's real status.
        raise PhaseSequenceError(f"phase status is '{PhaseStatus(event.status).value}'", "Override")

    event.status = PhaseStatus.OVERRIDDEN
    event.dispatcher_override_user_id = user_id
    event.dispatcher_override_note = note
    # Dated even though not completed. `status` already carries the "this
    # didn't really happen" truth — an undated row in the dispatcher's
    # chronological timeline (which reads completed_at for its card timestamp)
    # is a worse lie than a dated one. Mirrors _finish_phase's own
    # `event.completed_at = event.completed_at or now()` above.
    event.completed_at = event.completed_at or datetime.now(UTC)

    # Revised 2026-09-23: the override itself is anchored, with its own
    # PHASE_OVERRIDE receipt type. An override is exactly what a dispute questions, so
    # who did it, to which phase and why must be as tamper-evident as a driver's
    # completion. It used to leave anchor_status PENDING forever, so the gap read as a
    # receipt still owed. The gap is now carried honestly by status OVERRIDDEN and by
    # the receipt type, which can never be mistaken for the phase's own receipt
    # (receipt_type_for). No driver evidence is claimed: the payload commits only to
    # the override record, and the note (free text) only as a keyed hash.
    _anchor_phase(db, event=event, canonical_payload=compute_override_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id, phase_type=PhaseType(event.phase_type),
        override_user_id=user_id, override_note=note,
    ))

    # The human intervention lands on the ledger, not just in an audit column.
    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        exception_type=ExceptionType.DISPATCHER_NOTE, source=ExceptionSource.DISPATCHER,
        severity=ExceptionSeverity.WARNING,
        review_status=_initial_review_status(ExceptionSeverity.WARNING),
        description=note,
    ))

    if event.phase_type == PhaseType.ARRIVAL:
        # The seal check lives in advance_arrival, so overriding arrival skips it and
        # nothing downstream would notice. Record the gap on the leg itself. WARNING,
        # not CRITICAL, for the same reason an overridden departure's missing seal is
        # WARNING in advance_arrival: the absence is explained by an authorised action
        # that is already on the ledger as the DISPATCHER_NOTE above.
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_UNVERIFIED, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            review_status=_initial_review_status(ExceptionSeverity.WARNING),
            description=(
                "The seal was not inspected at arrival: a dispatcher overrode the "
                "arrival phase, so seal continuity for this leg cannot be verified."
            ),
        ))

    # May legitimately CLOSE the trip if this was the last unresolved row — that
    # is correct and must not be special-cased; _is_resolved already treats
    # OVERRIDDEN as resolved for gating purposes.
    await recompute_position(db, trip)
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    # Always PHASE_COMPLETED for an override — the plan position moved, same
    # refetch as any completion (unlike _finish_phase, this is not conditional on
    # the trip closing; that distinction belongs to cancel_trip's TRIP_CLOSED).
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.PHASE_COMPLETED))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


# Display format for the date a driver is told to come back on. Day-month-year with a
# full month name: unambiguous to a South African reader, and never confusable with the
# US month-first ordering the way a numeric date would be.
_SCHEDULED_DATE_FORMAT = "%d %B %Y"


def operating_day(moment: datetime) -> date:
    """The calendar date `moment` falls on in the operator's local timezone.

    A naive datetime is read as UTC rather than left to .astimezone()'s default, which
    would interpret it as the SERVER's local time — making the same trip activatable or
    not depending on which machine happened to answer the request.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    local = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
    return moment.astimezone(local).date()


def is_before_scheduled_day(now: datetime, scheduled: datetime) -> bool:
    """True when `now` falls on an EARLIER operating day than `scheduled`.

    Strictly earlier, so any time on the scheduled day passes — a 04:00 start against an
    08:00 slot is a driver ahead of schedule, not a driver on the wrong day. Activating
    LATE is never blocked either: a delayed trip still needs its evidence captured, and
    refusing it would only push the driver to work around the system entirely.
    """
    return operating_day(now) < operating_day(scheduled)


async def _scheduled_departure(db: AsyncSession, trip: Trip) -> datetime | None:
    """When the trip is due to start: the trip-level plan, else its first booked stop.

    The fallback exists because planned_departure_at is nullable and a multi-stop trip
    can carry its timing entirely on the stops. Ordered by stop sequence — the earliest
    stop that actually has a slot is the one activation is measured against, since
    activation happens at the origin gate.
    """
    if trip.planned_departure_at is not None:
        return trip.planned_departure_at

    result = await db.execute(
        select(TripStop.slot_time)
        .where(TripStop.trip_id == trip.id, TripStop.slot_time.is_not(None))
        .order_by(TripStop.sequence)
        .limit(1)
    )
    return result.scalars().first()


async def _reject_if_not_due(db: AsyncSession, trip: Trip) -> None:
    """Block activation of a trip before the day it is scheduled to run.

    Deliberately enforced here and NOT in _gate_and_load: that gate runs for every phase,
    and a trip that legitimately runs overnight would have its departure/unloading phases
    rejected the following day. Only the act of STARTING a trip is date-sensitive.

    Also deliberately after _gate_and_load in the caller, so an idempotent replay of an
    already-completed activation still short-circuits to 200 and never begins failing
    "too early" — a queued offline submission resent days later must not be rejected for
    the very schedule it already satisfied.
    """
    scheduled = await _scheduled_departure(db, trip)
    if scheduled is None:
        # No schedule at all is treated as not-yet-due rather than always-allowed: an
        # unscheduled trip is a dispatcher data gap, and letting it activate would mean
        # the rule silently does nothing on exactly the records least under control.
        raise PhaseTooEarlyError(None, "Activation")

    if is_before_scheduled_day(datetime.now(UTC), scheduled):
        raise PhaseTooEarlyError(
            operating_day(scheduled).strftime(_SCHEDULED_DATE_FORMAT).lstrip("0"), "Activation",
        )


async def _other_trips_for_driver(db: AsyncSession, trip: Trip) -> list[Trip]:
    """Every other non-terminal trip assigned to this trip's driver.

    Terminal trips are excluded because they cannot obstruct anything — a closed or
    cancelled trip is history, and counting it would mean a driver's very first completed
    trip permanently blocked their second.
    """
    result = await db.execute(
        select(Trip).where(
            Trip.driver_id == trip.driver_id,
            Trip.id != trip.id,
            Trip.status.notin_((TripStatus.CLOSED, TripStatus.CANCELLED)),
        )
    )
    return list(result.scalars().all())


def _reject_if_another_trip_underway(others: list[Trip]) -> None:
    """One trip at a time: a trip already underway blocks starting any other.

    Nothing at trip creation stops a dispatcher assigning a driver two overlapping trips,
    and until now nothing stopped the driver activating both — leaving two trips claiming
    the same driver, horse and trailers at the same moment, which makes the custody chain
    of both unprovable. ACTIVE and EXCEPTION_HOLD both count: a held trip is still the
    trip the driver is on, it is merely blocked from advancing.
    """
    for other in others:
        if other.status in (TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD):
            raise TripActivationBlockedError(
                other.trip_reference, "another trip is already underway"
            )


async def _reject_if_an_earlier_trip_is_due(
    db: AsyncSession, trip: Trip, others: list[Trip]
) -> None:
    """Within one operating day, trips must be started in departure order.

    Scoped to the SAME operating day on purpose. Trips on other days are already governed
    by _reject_if_not_due, and widening this rule across days would let a trip that was
    never run last week permanently block today's work until a dispatcher cancelled it.

    A trip with no resolvable schedule is skipped rather than assumed earliest: it cannot
    be activated at all (_reject_if_not_due rejects it outright), so it has no business
    blocking a properly scheduled trip on its way through.
    """
    scheduled = await _scheduled_departure(db, trip)
    if scheduled is None:
        return
    day = operating_day(scheduled)

    earliest: Trip | None = None
    earliest_at: datetime | None = None
    for other in others:
        if other.status != TripStatus.CREATED:
            continue
        other_scheduled = await _scheduled_departure(db, other)
        if other_scheduled is None or operating_day(other_scheduled) != day:
            continue
        if other_scheduled >= scheduled:
            continue
        if earliest_at is None or other_scheduled < earliest_at:
            earliest, earliest_at = other, other_scheduled

    if earliest is not None:
        raise TripActivationBlockedError(
            earliest.trip_reference, "an earlier trip today has to be started first"
        )


def _record_driver_position(event: PhaseEvent, payload: PhaseCompleteRequest) -> None:
    """Stamp the driver's phone fix and capture instant onto the phase event.

    Called by every advance_*, not just activation: the PWA no longer has manual
    "Capture GPS Location" steps, it takes a fix silently as the driver swipes to
    confirm, so every phase event can now say where it was completed.

    Only writes when a value is present. A None must never overwrite something already
    stored by an earlier attempt — a replayed offline submission whose original capture
    succeeded would otherwise erase it on retry. The GPS pair and driver_captured_at
    are gated independently of each other: a phase can carry a capture time
    with no GPS fix (a denied permission) or an older client's GPS fix with no capture
    time at all, and neither absence should suppress the other.

    POPIA: these columns stay in Postgres. Every canonical payload builder in this
    module is an explicit whitelist, so nothing written here can reach a Hedera hash.
    """
    if payload.driver_phone_lat is not None and payload.driver_phone_lng is not None:
        # str() before Decimal: handing a float straight to a Numeric(10, 7) column
        # carries the float's binary rounding error into fixed point (-26.0942 stores
        # as -26.0941999...). The string form is the coordinate the phone actually
        # reported.
        event.driver_phone_lat = Decimal(str(payload.driver_phone_lat))
        event.driver_phone_lng = Decimal(str(payload.driver_phone_lng))

    # Never substituted with completed_at or datetime.now(UTC) when absent —
    # an invented capture instant would defeat the entire point of corroboration_
    # service's skew check, which exists specifically to distrust a value this code
    # made up.
    if payload.driver_captured_at is not None:
        event.driver_captured_at = payload.driver_captured_at

    # A preview is advisory and non-writing; completion always assembles its own
    # ActionLocationAssessment afterwards. Keep the driver's acknowledgement in its
    # own columns so it cannot be mistaken for, or suppress, the measured result.
    if payload.location_warning_acknowledged_at is not None:
        event.location_warning_acknowledged_at = payload.location_warning_acknowledged_at
    if payload.location_warning_reason is not None:
        event.location_warning_reason = payload.location_warning_reason


async def advance_activation(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ActivationCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Activation",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    await _reject_if_not_due(db, trip)

    # Both gates sit AFTER _gate_and_load's idempotent-replay short-circuit, for the same
    # reason _reject_if_not_due does: a queued offline activation resent later must not
    # start failing on a rule it already satisfied when it was captured.
    others = await _other_trips_for_driver(db, trip)
    _reject_if_another_trip_underway(others)
    await _reject_if_an_earlier_trip_is_due(db, trip, others)

    # Two sources, recorded together: the driver's phone says where the phone is,
    # then Pulsit says where the vehicle is. The second is what makes the first
    # corroborated rather than merely asserted. A feeder check — P1 is unanchored,
    # and a Pulsit outage leaves the columns null ("could not check") rather than
    # failing the handshake. See orchestration/corroboration_service.py.
    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    # First phase off CREATED. LEGACY per-handshake TripStatus values are gone —
    # ACTIVE is the coarse "trip is underway" state until CLOSED.
    trip.status = TripStatus.ACTIVE

    _anchor_phase(db, event=event, canonical_payload=compute_activation_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


def compute_departure_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
) -> dict[str, str]:
    """Reproduce the legacy departure payload for pre-FP-154 receipts.

    JSON-native (UUIDs stringified explicitly) so compute_payload_hash's plain
    json.dumps (no default=str fallback) never has to guess how to serialize a
    value. Deliberately excludes GPS, photos, and artifact IDs — only hashes of
    evidence belong on-chain, never GPS/PII (POPIA); completed_at is excluded
    too, to avoid datetime round-trip fragility when verification reconstructs
    this payload later. driver_visual_count is gone: the count
    stays on loading, unanchored, and departure has no reason to fetch a value
    from a different PhaseEvent row just to anchor it.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": seal_number,
    }


def compute_departure_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
    seal_photo_sha256: str, waybill_photo_sha256: str | None,
) -> dict[str, str | int | None]:
    """Canonical departure payload with role-labelled evidence commitments.

    Artifact IDs and Storage paths remain off-chain. The optional waybill key is
    always present so reconstruction has one deterministic v2 shape.
    """
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": seal_number,
        "seal_photo_sha256": seal_photo_sha256,
        "waybill_photo_sha256": waybill_photo_sha256,
    }


def _phase_payload_base(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, phase_type: PhaseType,
) -> dict[str, str | int | None]:
    """The v2 keys every phase payload starts with. Same rules as the departure payload:
    no GPS, no artifact IDs or storage paths, no PII, and no completed_at (a datetime
    would have to round-trip exactly through the database for verification to rebuild
    the same hash). Location evidence stays off-chain on the row this payload names."""
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": phase_type.value,
    }


def compute_activation_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: the fact anchored is that the driver took custody, and when HCS saw it."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.ACTIVATION,
    )


def compute_loading_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, parcel_count_origin: int | None,
    linehaul_photo_sha256: str | None,
) -> dict[str, str | int | None]:
    """The scanned-out count and the linehaul sheet. Both keys are always present, None
    when absent, so reconstruction has one deterministic shape (see the departure
    payload's optional waybill key)."""
    return {
        **_phase_payload_base(
            phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.LOADING,
        ),
        "parcel_count_origin": parcel_count_origin,
        "linehaul_photo_sha256": linehaul_photo_sha256,
    }


def compute_in_transit_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: the driver's "I have arrived" attestation is itself the fact."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.IN_TRANSIT,
    )


def compute_arrival_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str | None,
    seal_condition: str, seal_photo_sha256: str,
) -> dict[str, str | int | None]:
    """The seal as found at the gate. seal_number is None only for a missing seal."""
    return {
        **_phase_payload_base(
            phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.ARRIVAL,
        ),
        "seal_number": seal_number,
        "seal_condition": seal_condition,
        "seal_photo_sha256": seal_photo_sha256,
    }


def compute_unloading_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID,
) -> dict[str, str | int | None]:
    """IDs only: unloading's counts are reconciled and anchored at confirmation."""
    return _phase_payload_base(
        phase_event_id=phase_event_id, trip_id=trip_id, phase_type=PhaseType.UNLOADING,
    )


def _override_commitment(phase_event_id: uuid.UUID, value: str) -> str:
    """SHA-256 of a value salted with its phase row's id.

    What the salt does: the same note or dispatcher id hashes differently on every row,
    so one precomputed table of guesses cannot be matched against every override at
    once, and two overrides cannot be linked by an identical hash. What it does NOT do:
    the salt (phase_event_id) is in the payload itself, so anyone holding a payload can
    still test candidate notes against that one row. It is a commitment, not
    encryption. That is acceptable because the plain note stays in PostgreSQL (POPIA)
    and a short note guessed back reveals only what an auditor would be shown anyway.
    Verification rehashes the plain value stored on the row."""
    return hashlib.sha256(f"{phase_event_id}:{value}".encode("utf-8")).hexdigest()


def compute_override_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, phase_type: PhaseType,
    override_user_id: uuid.UUID, override_note: str,
) -> dict[str, str | int | None]:
    """Who overrode which phase, and why, as commitments. The note is free text that may
    name a person, so only its keyed hash leaves the database (POPIA)."""
    return {
        **_phase_payload_base(phase_event_id=phase_event_id, trip_id=trip_id, phase_type=phase_type),
        "phase_status": PhaseStatus.OVERRIDDEN.value,
        "overridden_by_sha256": _override_commitment(phase_event_id, str(override_user_id)),
        "override_note_sha256": _override_commitment(phase_event_id, override_note),
    }


async def advance_loading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: LoadingCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Loading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Optional evidence: a warehouse that has already gone paperless has no linehaul
    # sheet to hand the driver, and this must never block completion (schema docstring).
    linehaul_photo_sha256: str | None = None
    if payload.linehaul_photo_artifact_id is not None:
        linehaul_hashes = await _assert_artifacts_belong_to_trip(
            db, trip_id=trip_id, artifact_ids=(payload.linehaul_photo_artifact_id,),
        )
        event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id
        linehaul_photo_sha256 = linehaul_hashes[payload.linehaul_photo_artifact_id]

    # The observed set, not a driver-entered number. The gate in _gate_and_load has
    # already established that the warehouse closed its session at this stop, so these
    # counts are final for this loading — which is what makes stamping the aggregate
    # here safe under the "anchored payload contains only data that existed at close"
    # rule. driver_visual_count is accepted on the payload (schema) but
    # deliberately never read here — see LoadingCompleteRequest's docstring.
    #
    # trip_stop_id is Optional on PhaseEvent (only TRIP_CREATION is ever NULL, per
    # its own uq_phase_events_trip_stop_type comment) — a LOADING row always carries
    # one, so the None branch is unreachable in practice. Narrowed explicitly rather
    # than asserted, since scan_service.load_consignments_at_stop requires a UUID.
    consignments = (
        await scan_service.load_consignments_at_stop(
            db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
            direction=ScanDirection.OUT,
        )
        if event.trip_stop_id is not None
        else []
    )

    scanned_out_total = 0
    expected_total = 0
    shortfall_recorded = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_out_total += counts.scanned_out
        expected_total += counts.expected

        if counts.scanned_out != counts.expected:
            # BACKSTOP ONLY — scan_service._reconcile_consignment is the primary
            # writer of this exception and it already fired at ingest, naming the
            # missing barcodes. Raising unconditionally here would put TWO rows on
            # the dispatcher's list for one short count: scan_service's dedup
            # compares descriptions verbatim, so a differently-worded second row
            # sails straight past it.
            #
            # The one case scan_service genuinely cannot cover: it guards on
            # `if events and (missing or unexpected)`, so a session closed with
            # NOTHING scanned at all raises nothing there — no events, no row. That
            # is the most serious short count there is and it must not go unrecorded.
            # Hence a presence check rather than an unconditional add.
            shortfall_recorded |= await _raise_scan_shortfall_if_unrecorded(
                db, trip_id=trip_id, event=event, consignment=consignment,
                scanned_out=counts.scanned_out, expected=counts.expected,
            )

    if shortfall_recorded:
        # After the loop, and only for rows this call actually wrote — the helper
        # suppresses duplicates of what scan_service already raised at ingest, and a
        # suppressed duplicate is not news to the dispatcher.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    # None, not 0, when this stop has no consignments at all: a trip created without
    # a Parcel Perfect reference has no manifest baseline, and 0 would read as
    # "nothing was loaded" rather than "nothing was declared". Same None-is-not-zero
    # principle as the old _expected_parcel_count (removed by this task — advance_loading
    # was its only caller).
    event.parcel_count_origin = scanned_out_total if consignments else None

    # A short scan is recorded, never blocking — FreightProof records what happened,
    # it does not dispatch. Matches departure's and unloading's seal-mismatch precedent.
    event.status = (
        PhaseStatus.EXCEPTION
        if consignments and scanned_out_total != expected_total
        else PhaseStatus.COMPLETED
    )

    _anchor_phase(db, event=event, canonical_payload=compute_loading_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        parcel_count_origin=event.parcel_count_origin,
        linehaul_photo_sha256=linehaul_photo_sha256,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


async def _raise_scan_shortfall_if_unrecorded(
    db: AsyncSession, *, trip_id: uuid.UUID, event: PhaseEvent,
    consignment: Consignment, scanned_out: int, expected: int,
) -> bool:
    """Record a scan-out shortfall only if scan_service has not already recorded one.

    Returns True when a row was written, False when an existing unresolved one made
    this a no-op. The caller needs the distinction to decide whether to publish a
    realtime event: it holds the Trip (and so the org id) that this helper does not,
    and a suppressed duplicate must not wake the dispatcher a second time.

    Deliberately keyed on (consignment, stop, type, unresolved) rather than on the
    description string scan_service's own dedup compares: the two writers word the
    same finding differently, so a text comparison would let both through. The
    question being asked here is "is this discrepancy already on the dispatcher's
    list", and the answer must not depend on who phrased it.
    """
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.consignment_id == consignment.id,
            TripException.trip_stop_id == event.trip_stop_id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
            TripException.review_status != ExceptionReviewStatus.REVIEWED,
        )
    )).first()
    if existing is not None:
        return False

    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        review_status=_initial_review_status(ExceptionSeverity.WARNING),
        description=(
            f"Warehouse closed its scan-out session on waybill "
            f"{consignment.parcel_perfect_reference} with "
            f"{scanned_out} of {expected} parcel(s) scanned."
        ),
    ))
    return True


def _normalized_seal(seal: str) -> str:
    # Deliberately NOT Optional. None is not a single concept here: for a stored
    # phase_events.seal_number it means "seal unknown" (an anomaly), but for
    # payload.seal_number_confirmed it means "no guard re-entry", which is the
    # normal case and must never be flagged (see advance_departure). Swallowing
    # None here would let that second, far more common case silently become a
    # CRITICAL mismatch on every trip. Callers holding a nullable value resolve
    # what their own None means before calling.
    return seal.strip().upper()


async def _find_departure_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The departure that opened the leg ending at `before_sequence`. Well-defined
    because the plan generator (phase_plan.build_phase_plan) interleaves exactly
    one `in_transit` between any departure and the unloading/confirmation that
    closes its leg — there is never a second departure to be confused with the
    right one.

    Caller contract: `before_sequence` must be the sequence_number of the
    closing phase's OWN row (the event being validated) — never a hardcoded
    or otherwise-derived reference. Passing the wrong row's sequence silently
    resolves the wrong leg's departure instead of raising."""
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.DEPARTURE,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    departure = result.scalar_one_or_none()
    if departure is None:
        raise ResourceNotFoundError("PhaseEvent", "departure")
    return departure


async def advance_departure(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: DepartureCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Departure",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Before any evidence is written: every photo cited must be this trip's own. The
    # waybill id is normally None now (its step was removed 2026-08-10 — see
    # DepartureCompleteRequest); the helper skips None entries, so a replayed offline
    # entry that still carries one is checked exactly as before.
    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.waybill_photo_artifact_id, payload.seal_photo_artifact_id),
    )

    # The seal is applied HERE now, not at loading.
    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id

    # Intra-request seal continuity — compared against THIS SAME
    # request's seal_number, not a fetched prior row: the driver applies and
    # photographs the seal, the exit guard independently re-enters what they
    # physically see, in one submission.
    #
    # Three states, not two. `guard_verified_seal` is now Optional[bool] (see
    # DepartureCompleteRequest) because the driver app no longer collects a guard's
    # re-entry at all — guards have no accounts. The absence of an independent
    # confirmation is the NORMAL case and must not be recorded as an anomaly: a
    # falsy-check here would stamp a CRITICAL seal_mismatch exception on every
    # single trip the current app submits, drowning the real mismatches this
    # platform exists to surface. Only an explicit False (a guard who was asked and
    # could not verify) or a real re-entered seal that fails to match is evidence of
    # anything.
    seal_mismatch_description: str | None = None
    if payload.seal_number_confirmed is not None:
        confirmed = _normalized_seal(payload.seal_number_confirmed)
        if confirmed != _normalized_seal(payload.seal_number):
            seal_mismatch_description = (
                f"Seal at origin gate-out ('{confirmed}') does not match "
                f"the seal applied at departure ('{payload.seal_number}')."
            )
    elif payload.guard_verified_seal is False:
        seal_mismatch_description = "Exit-gate guard could not verify the seal at origin gate-out."

    if seal_mismatch_description is not None:
        # Recorded as evidence, but the trip still departs — a departure
        # mismatch doesn't hold the trip, it's anchored regardless below.
        # Unloading's seal mismatch (destination) matches this precedent too —
        # neither ever holds the trip, only flags it (critical exception).
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL,
            review_status=_initial_review_status(ExceptionSeverity.CRITICAL),
            description=seal_mismatch_description,
        ))
        # Emitted for consistency with the other system sites, but deliberately
        # untested: BOTH entry paths above are dead from any current client. The driver
        # app sends neither seal_number_confirmed nor guard_verified_seal
        # (driver-pwa/lib/api/phases.ts:50) — the guard re-entry step was removed
        # 2026-08-05. The fields survive only so a departure queued offline by an older
        # build can replay instead of 422-ing forever, which is also why this stays.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )
    else:
        event.status = PhaseStatus.COMPLETED

    # The anchor moves whole to departure. Runs unconditionally regardless
    # of the mismatch outcome above — a mismatch is evidence in its own right,
    # not a reason to withhold the anchor (matching confirmation's precedent).
    canonical_payload = compute_departure_canonical_payload_v2(
        phase_event_id=event.id,
        trip_id=trip_id,
        seal_number=payload.seal_number,
        seal_photo_sha256=artifact_hashes[payload.seal_photo_artifact_id],
        waybill_photo_sha256=(
            artifact_hashes[payload.waybill_photo_artifact_id]
            if payload.waybill_photo_artifact_id is not None
            else None
        ),
    )
    event.event_hash = compute_payload_hash(canonical_payload)
    # Queued, not awaited: this used to hold the driver's swipe open for the whole
    # Hedera submit. anchor_status stays PENDING until the worker lands the receipt —
    # which is precisely what the driver app's "anchoring in progress" state reports.
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    trip.actual_departure_at = datetime.now(UTC)
    # IN_TRANSIT stays PENDING while the driver is moving. It is closed by the driver's own
    # arrival submission (advance_in_transit), which is what gives the dispatcher a drive
    # time measured from departure to actual arrival rather than to whenever the unloading
    # paperwork happened to land.

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


async def advance_in_transit(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: InTransitCompleteRequest,
) -> TripDetailResponse:
    """The driver attesting arrival — the act that closes the driving leg.

    The thinnest wrapper in this module, and that is the design. It writes no evidence of
    its own beyond the phone fix _record_driver_position stores for every phase, and it
    anchors nothing. What it changes is WHO owns the row: before 2026-08-09 in_transit was
    opened by advance_departure and closed as a side effect of advance_unloading, which
    meant its completed_at recorded when the unloading paperwork was submitted, not when
    the truck actually arrived — the dispatcher's elapsed drive time silently swallowed
    the entire unloading phase. It also meant an overridden unloading left the row PENDING
    with no actor able to resolve it, stranding the trip ACTIVE forever.

    No _reject_if_not_due and no scan gate: IN_TRANSIT is absent from
    phase_gate.GATED_PHASES on purpose. The destination warehouse has not scanned anything
    when the driver pulls up at the boom — gating arrival on a scan that only happens
    after arrival would deadlock the leg. UNLOADING carries that gate instead, which is
    the correct place for it.

    The driver app submits this from the in-transit hub's existing "Arrive at destination"
    swipe, NOT from a step page: STEP_SLUGS[in_transit] stays empty so actionablePhase()
    keeps skipping the row and driver-pwa routing is unchanged.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Arrival",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    _anchor_phase(db, event=event, canonical_payload=compute_in_transit_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


def _record_seal_finding(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent,
    exception_type: ExceptionType, severity: ExceptionSeverity, description: str,
) -> None:
    """Write one seal finding against the arrival row and publish it. The phase row
    becomes EXCEPTION, which _is_resolved treats as resolved: the finding is recorded
    without stopping the ledger (see the SEAL_MISMATCH comment in advance_arrival)."""
    event.status = PhaseStatus.EXCEPTION
    db.add(TripException(
        trip_id=trip.id, phase_event_id=event.id,
        exception_type=exception_type, source=ExceptionSource.SYSTEM,
        severity=severity,
        review_status=_initial_review_status(severity),
        description=description,
    ))
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(severity)),
    )


def _seal_unverified_severity(departure_event: PhaseEvent) -> ExceptionSeverity:
    """Severity of a SEAL_UNVERIFIED finding for a leg whose departure has no seal.
    See the comment above its use in advance_arrival for why the split exists."""
    absence_is_explained = departure_event.status == PhaseStatus.OVERRIDDEN
    return ExceptionSeverity.WARNING if absence_is_explained else ExceptionSeverity.CRITICAL


async def advance_arrival(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ArrivalCompleteRequest,
) -> TripDetailResponse:
    """The seal inspection at the destination gate, before anything is opened.

    Holds the seal comparison that used to sit in advance_unloading. Being its own
    phase, completed before unloading can start (_gate_and_load's sequence rule), is
    what makes "inspected before opened" enforced rather than hoped for.

    No _reject_if_not_due and no scan gate: ARRIVAL is absent from
    phase_gate.GATED_PHASES for the reason advance_in_transit gives. The warehouse
    scans after arrival, so gating on the scan here would deadlock the leg.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Seal inspection",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # This LEG's departure (strictly before this row), not "the trip's" —
    # a multi-stop trip can have several DEPARTURE rows, and a plain
    # phase_type == DEPARTURE trip-wide lookup would raise MultipleResultsFound
    # on a real cross-dock trip.
    departure_event = await _find_departure_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, artifact_ids=(payload.seal_photo_artifact_id,),
    )

    # None only when the seal is MISSING (the schema requires a number otherwise).
    seal_at_arrival = (
        None if payload.seal_number_at_arrival is None
        else _normalized_seal(payload.seal_number_at_arrival)
    )
    event.seal_number = seal_at_arrival
    event.seal_condition = payload.seal_condition.value
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.status = PhaseStatus.COMPLETED

    # "" when the departure row carries no seal at all. Reachable in normal
    # operation, not just from bad data: override_phase resolves a departure
    # WITHOUT ever writing a seal (it anchors only the override record, never seal
    # evidence), and _is_resolved treats
    # OVERRIDDEN as resolved, so the trip runs on to arrival with a NULL seal.
    # Normalizing first collapses NULL, "" and whitespace to one "not recorded"
    # case rather than leaving " " to masquerade as a real seal.
    departure_seal = _normalized_seal(departure_event.seal_number or "")

    # Independent of the number comparison below, so a broken seal is recorded even
    # when there is no departure seal to compare against, and a broken seal that also
    # carries the wrong number records both findings. Always CRITICAL: a seal found
    # damaged or missing at the gate is the in-transit opening this phase exists to catch.
    if payload.seal_condition != SealCondition.INTACT:
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_COMPROMISED, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal found {payload.seal_condition.value} at arrival "
                f"(seal number read: '{seal_at_arrival or 'none'}')."
            ),
        )

    if not departure_seal:
        # NOT a SEAL_MISMATCH. There is no second seal here to differ from, so
        # claiming a mismatch would put a false theft indicator into the anchored
        # record and fire the driver app's critical alert (it treats seal_mismatch
        # as one of three alarm types) for something the driver did not cause and
        # cannot fix. The honest fact is narrower: continuity for this leg cannot
        # be checked. Severity splits on whether that absence is EXPLAINED, because
        # severity is what the dispatcher actually triages on (its exception list
        # keys the row's border accent and chip off severity; nothing anywhere reads
        # this description text, so the distinction cannot live in wording alone):
        #
        #   OVERRIDDEN — a dispatcher resolved the departure without a seal being
        #     captured. Authorised, and already on the ledger as its own
        #     DISPATCHER_NOTE. WARNING: worth seeing, not an alarm.
        #   anything else — the departure ran the seal-capture path (advance_departure
        #     writes seal_number unconditionally from a required field) and STILL has
        #     no seal. Nothing legitimate produces that, so it is a data-integrity
        #     anomaly and must stay loud. CRITICAL.
        #
        # Neither is INFO: an unverifiable seal chain is exactly what a real seal swap
        # would hide behind. _record_seal_finding writes the row and derives the
        # realtime severity from the same value, so the two cannot drift apart.
        seal_unverified_severity = _seal_unverified_severity(departure_event)
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_UNVERIFIED, severity=seal_unverified_severity,
            description=(
                f"Seal continuity could not be verified for this leg: no seal was "
                f"recorded at departure (departure phase is "
                f"'{PhaseStatus(departure_event.status).value}'). Seal at arrival "
                f"was '{seal_at_arrival or 'none'}'."
            ),
        )
    elif seal_at_arrival is not None and seal_at_arrival != departure_seal:
        # Recorded as evidence, but does NOT hold the trip. This branch used to set
        # trip.status = EXCEPTION_HOLD; three reasons it must not:
        #
        # 1. There is no release or override path anywhere in this codebase. A held
        #    trip could never reach confirmation, so it could never record POD or
        #    anchor its delivery receipt — the hold DESTROYED the remaining evidence
        #    of the very trip whose integrity it was reacting to. On an evidence
        #    platform that is the wrong failure direction: record more, not less.
        # 2. It contradicted _is_resolved, which already treats EXCEPTION as resolved
        #    for gating, precisely so an anomaly is recorded without stopping the
        #    ledger. Holding here re-introduced the blocking behaviour by the back
        #    door, at trip level instead of phase level.
        # 3. Departure's own seal mismatch (advance_departure) has never held the trip. Two
        #    seal mismatches on the same trip behaving differently was inconsistent
        #    with nothing to justify it.
        #
        # The mismatch stays fully visible: the phase row is EXCEPTION and a CRITICAL
        # TripException is written. A dispatcher acts on that, not on a stuck trip.
        # If a hold is ever genuinely wanted it belongs as a manual dispatcher action
        # with an explicit release path — not as an automatic dead end.
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at arrival ('{seal_at_arrival}') does not match "
                f"the seal applied at departure ('{departure_seal}')."
            ),
        )
    # No LEGACY trip.status assignment here (DEST_GATE_IN is deleted) — the trip
    # simply stays ACTIVE; recompute_position derives the ledger position generically.

    # After every finding above: the anchor fires on EXCEPTION as well as COMPLETED.
    # A seal found broken or wrong is the evidence a dispute turns on, so it is the
    # last row that should go unanchored (departure's precedent).
    _anchor_phase(db, event=event, canonical_payload=compute_arrival_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        seal_number=seal_at_arrival,
        seal_condition=payload.seal_condition.value,
        seal_photo_sha256=artifact_hashes[payload.seal_photo_artifact_id],
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


async def advance_unloading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: UnloadingCompleteRequest,
) -> TripDetailResponse:
    """Unloading only. The seal comparison moved to advance_arrival, which must
    complete first: _gate_and_load's lower-sequence rule already guarantees that,
    so nothing here re-checks it."""
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Unloading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    _anchor_phase(db, event=event, canonical_payload=compute_unloading_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


def compute_confirmation_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int,
    driver_visual_count: int | None,
) -> dict[str, str | int | None]:
    """Reproduce the legacy confirmation payload for pre-FP-154 receipts.

    Anchored unconditionally, independent of whether the counts match — a
    mismatch is evidence in its own right (recorded separately as a
    TripException), not a reason to withhold the anchor. Same POPIA/JSON-native
    rules as the departure payload: no GPS/photos/PII, no completed_at.

    phase_type is "confirmation", not "unloading" — this corrects a
    pre-existing mislabel, not just a rename: this builder has only ever been
    called from the confirmation phase, the old value was simply wrong from
    day one. It does not change which phase anchors.

    driver_visual_count is Optional (the driver may skip the count): the key
    stays PRESENT with value None rather than being omitted when absent.
    canonicalize_payload is a plain json.dumps(sort_keys=True), so None
    serialises to `null` deterministically either way — but an omitted key
    would change the payload's SHAPE, not just one value, and
    verification_service._reconstruct_phase_event_payload rebuilds this exact
    dict from the stored column on every verify, so the key's presence must be
    unconditional for that rebuild to reproduce the original hash.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
    }


def compute_confirmation_canonical_payload_v2(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int,
    driver_visual_count: int | None, pod_photo_sha256: str,
    pod_signature_sha256: str,
) -> dict[str, str | int | None]:
    """Canonical confirmation payload with separate POD and signature commitments."""
    return {
        "payload_version": PHASE_PAYLOAD_VERSION_V2,
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
        "pod_photo_sha256": pod_photo_sha256,
        "pod_signature_sha256": pod_signature_sha256,
    }


async def advance_confirmation(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ConfirmationCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Confirmation",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.pod_photo_artifact_id, payload.pod_signature_artifact_id),
    )

    event.pod_photo_artifact_id = payload.pod_photo_artifact_id
    event.pod_signature_artifact_id = payload.pod_signature_artifact_id

    # Per consignment delivered at THIS stop, not per leg. A consignment picked up at
    # stop 1 and delivered at stop 3 has its scan-out at stop 1; the old leg-based
    # lookup this replaced would have resolved stop 2's loading row instead and
    # manufactured a mismatch on a healthy cross-dock trip. Consignment.pickup_stop_id
    # / delivery_stop_id (FP-112) is the partition that makes this correct.
    #
    # trip_stop_id is Optional on PhaseEvent (only TRIP_CREATION is ever NULL, per
    # its own uq_phase_events_trip_stop_type comment) — a CONFIRMATION row always
    # carries one, so the None branch is unreachable in practice. Narrowed
    # explicitly rather than asserted, matching advance_loading's own precedent.
    consignments = (
        await scan_service.load_consignments_at_stop(
            db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
            direction=ScanDirection.IN,
        )
        if event.trip_stop_id is not None
        else []
    )

    scanned_in_total = 0
    mismatched = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_in_total += counts.scanned_in

        if counts.scanned_out == 0 and counts.scanned_in == 0:
            # No baseline at either end — nothing to compare. Covers empty-leg trips
            # and dispatcher-overridden loadings alike, without either needing its own
            # branch keyed on a field that no longer exists.
            continue

        if counts.scanned_out != counts.scanned_in:
            mismatched = True
            db.add(TripException(
                trip_id=trip_id, phase_event_id=event.id,
                consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
                exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH,
                source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
                review_status=_initial_review_status(ExceptionSeverity.WARNING),
                description=(
                    f"Parcel count changed in transit on waybill "
                    f"{consignment.parcel_perfect_reference}: "
                    f"{counts.scanned_out} scanned out at origin, "
                    f"{counts.scanned_in} scanned in at destination."
                ),
            ))

    if mismatched:
        # Once, after the loop — a three-waybill discrepancy is still one trip to
        # refetch, and three identical events would only make the client do it thrice.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = scanned_in_total

    canonical_payload = compute_confirmation_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        # Key name unchanged — see the schema comment. Its provenance is now the
        # warehouse feed rather than Parcel Perfect; its name is a mild misnomer and
        # stays, because verification_service rebuilds every historical anchor from it.
        pp_scan_in_count=scanned_in_total,
        driver_visual_count=payload.driver_visual_count,
        pod_photo_sha256=artifact_hashes[payload.pod_photo_artifact_id],
        pod_signature_sha256=artifact_hashes[payload.pod_signature_artifact_id],
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchors unconditionally, fail-open — a Hedera outage no longer
    # blocks delivery confirmation from completing; the anchor path records the debt on
    # event.anchor_status instead of raising. Queued rather than awaited (see
    # _dispatch_anchor) so the driver isn't held on the swipe for the Hedera round trip.
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.DELIVERY,
    )

    event.status = PhaseStatus.EXCEPTION if mismatched else PhaseStatus.COMPLETED

    # No explicit trip.status = CLOSED / closed_at here anymore — this is
    # confirmation's real point: recompute_position (called inside
    # _finish_phase) finds no unresolved rows left and closes the trip
    # generically, instead of this wrapper hardcoding "I am always last."
    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )


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
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
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


async def next_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> PhaseEvent | None:
    """The lowest-sequence unresolved row.

    Re-derived from the ledger, never read off trip.current_phase: the cache is a
    cache, and if it ever diverges this endpoint tells the truth
    instead of laundering the divergence. Returns None for a closed trip.
    """
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    for event in result.scalars().all():
        if not _is_resolved(PhaseStatus(event.status)):
            return event
    return None


async def list_phases(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> list[PhaseEvent]:
    """The trip's committed plan, in plan order. Length is data — never sliced,
    never padded to six."""
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    return list(result.scalars().all())
