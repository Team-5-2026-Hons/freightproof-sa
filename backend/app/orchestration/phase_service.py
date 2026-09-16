"""Phase completion engine — advance_activation through advance_confirmation.

A trip's full phase plan (parent plan §2.2/D5) is written at trip creation: every
PhaseEvent row a driver will ever complete already exists, `pending`, before any of
these functions runs. No code path here may insert a PhaseEvent row.

Two shared core helpers do the generic work (_gate_and_load / _finish_phase); five
thin wrappers write their own phase-specific evidence and status, then route through
that shared core. _gate_and_load loads trip+event, verifies ownership, rejects a
closed/cancelled/held trip, short-circuits an idempotent replay, and gates on every
lower-sequence PhaseEvent being resolved — reading the plan, never trip.status.
_finish_phase stamps idempotency_key/completed_at, recomputes trip.current_phase/
current_stop from the ledger, closes the trip if nothing remains pending, and
returns the updated TripDetailResponse.

advance_departure (P3) and advance_confirmation (P6) anchor to Hedera HCS: a
JSON-native canonical payload is built by versioned payload builders, hashed via
compute_payload_hash(), then anchor_subject() submits it and persists a
BlockchainReceipt. Both anchors are fail-open via _anchor_or_fail_open(): a Hedera
failure sets anchor_status=FAILED (retry owed) instead of raising, since a seal/
delivery event is evidence that already happened and must not be blocked by a
Hedera outage.

Neither anchor is awaited. _dispatch_anchor queues the Hedera submit on the Celery
worker once this request's transaction commits, so the driver isn't held on the
swipe for the ~4-6s round trip; the phase returns with anchor_status PENDING and
the receipt lands moments later. If the broker is unreachable, an in-process async
fallback starts immediately. A periodic worker recovers overdue receipts from the
committed phase ledger. advance_activation, advance_loading, advance_unloading
remain unanchored feeders by design — they record cross-checks that support the
anchored phases but are not themselves committed to chain.
"""

import asyncio
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
    ExceptionSource, ExceptionType, PhaseStatus, PhaseType, SubjectType, TripStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop
from app.integrations.scan_feed import ScanDirection
from app.orchestration import corroboration_service, scan_service
from app.orchestration.phase_gate import blocked_on_by_stop
from app.orchestration.resource_service import get_trip_detail
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    InTransitCompleteRequest, LoadingCompleteRequest, PhaseCompleteRequest, UnloadingCompleteRequest,
)
from app.schemas.trips import TripDetailResponse

logger = logging.getLogger(__name__)

PHASE_PAYLOAD_VERSION_V2 = 2

_PHASE_RECEIPT_TYPES = {
    PhaseType.DEPARTURE: BlockchainReceiptType.PICKUP,
    PhaseType.CONFIRMATION: BlockchainReceiptType.DELIVERY,
}

# asyncio keeps only weak references to scheduled tasks. Retain dispatches and
# fallback anchors until their completion callback has observed the result.
_BACKGROUND_ANCHOR_TASKS: set[asyncio.Task[bool]] = set()


def _initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:
    """Delegate to exception_service.initial_review_status so every TripException
    this module writes uses the same severity->status rule as the driver-raised path.

    Imported lazily: exception_service imports phase_service.current_phase_event at
    module load, so a top-level import here would deadlock on the partial import.
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

    Filters by org, not driver. 404, never 403, on a trip belonging to another
    org, matching the no-existence-disclosure rule used elsewhere in this module.
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
    """The single load point every completion path (the advance_* wrappers and
    override_phase) shares, so the row lock below covers all of them.

    Row-locked with FOR UPDATE: two concurrent completions of the SAME phase would
    both pass _gate_and_load's sequence gate and dispatch to Hedera before the
    idempotency_key unique index fires at flush — which is after the anchor is
    already queued, and a DB rollback can't un-submit an on-chain message. The lock
    blocks the second transaction until the first commits, then it re-reads the row
    as resolved and returns the existing idempotent-replay 200.
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

    The FK alone doesn't prevent another trip's photo being cited as this trip's
    evidence; an unowned artifact would hash into the journey record as if genuine.
    Raises ResourceNotFoundError (404) without distinguishing "wrong trip" from "no
    such artifact" — the same fact from this trip's perspective, and distinguishing
    them would leak another trip's evidence to a caller who can't otherwise see it.

    None entries are skipped. Returns the owned artifacts' SHA-256 digests so an
    anchoring caller doesn't need a second DB round trip.
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
        # Sorted for a deterministic message across runs (API error body, test assertions).
        raise ResourceNotFoundError(
            "EvidenceArtifact", ", ".join(sorted(str(m) for m in missing)),
        )
    return owned


def _is_resolved(status: PhaseStatus) -> bool:
    # A phase blocks the NEXT phase only while PENDING/IN_PROGRESS. EXCEPTION is
    # resolved for gating purposes — it already happened and the anomaly is
    # recorded on the row itself. No phase completion holds a trip any more;
    # EXCEPTION_HOLD survives as a status only for a future manual dispatcher hold.
    return status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN)


async def _gate_and_load(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    phase_label: str,
) -> tuple[Trip, PhaseEvent] | TripDetailResponse:
    """Steps 1-4 of parent §2.4. Returns (trip, event) to continue, or a
    TripDetailResponse if idempotent replay already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if _is_resolved(event.status):
        # Idempotent replay: COMPLETED, EXCEPTION and OVERRIDDEN are all "already
        # decided", so a resent offline-queue entry is caught here rather than
        # re-executing the wrapper body and double-writing evidence/exceptions.
        # Checked BEFORE the trip-status check below: a phase whose own completion
        # closed the trip (e.g. confirmation's count-mismatch branch) must still
        # replay as an idempotent 200, even though trip.status now reads CLOSED.
        return await get_trip_detail(
            db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id,
        )

    # EXCEPTION_HOLD is listed but no production path sets it today; kept so a future
    # manual dispatcher hold gates phase completion by construction.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED, TripStatus.EXCEPTION_HOLD):
        # Trip.status is a plain String(30) column, so a freshly loaded trip yields a
        # raw str here, not the enum — TripStatus(...) normalises before reading .value.
        raise PhaseSequenceError(f"trip status is '{TripStatus(trip.status).value}'", phase_label)

    # No phase-type exclusion here: in_transit is closed by the driver's own arrival
    # submission (advance_in_transit) at its own sequence position, so the ordinary
    # ordering rule correctly blocks unloading on a still-PENDING in_transit. A driver
    # who cannot submit it is recovered via the dispatcher's in_transit override.
    lower_result = await db.execute(
        select(PhaseEvent.status).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.sequence_number < event.sequence_number,
        )
    )
    if any(not _is_resolved(PhaseStatus(status)) for (status,) in lower_result.all()):
        # An unresolved earlier phase is the real blocker, not trip.status.
        raise PhaseSequenceError("an earlier phase in the plan is still unresolved", phase_label)

    # AFTER the _is_resolved replay short-circuit above: a resent offline-queue entry
    # for an already-successful completion must return current state, not 409.
    if event.trip_stop_id is not None:
        gate = await blocked_on_by_stop(db, trip_id=trip_id)
        if gate.get((PhaseType(event.phase_type), event.trip_stop_id)) is not None:
            raise PhaseBlockedError(phase_label)

    return trip, event


async def recompute_position(db: AsyncSession, trip: Trip) -> None:
    """Recompute trip.current_phase/current_stop from the ledger. Public because
    create_trip must seed the cache the moment the plan exists.

    trip_stop_id is a FK, not the sequence int the cache wants — hence the join to
    TripStop.sequence rather than a plain PhaseEvent-only query.
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
    """The phase row a trip is sitting on right now — same ledger walk as
    recompute_position, but returns the row itself instead of caching it onto the trip.

    Exists so an event outside a phase completion (a panic hold, a breakdown) can
    still be tagged with the phase it happened during; driver-raised exceptions have
    no `event` in hand otherwise. Falls back to the highest-sequence row once every
    phase is resolved. Resolved by sequence_number, never phase_type, since a
    cross-dock plan carries one in_transit row per leg.
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

    The entry point tasks/blockchain.py re-enters this module through, so the
    anchoring contract stays defined here rather than duplicated in a worker.
    """
    result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id).with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        # Should be impossible: dispatch only happens after the row's transaction commits.
        logger.error("Anchor requested for unknown phase_event_id=%s", phase_event_id)
        return False

    event.updated_at = datetime.now(UTC)

    # Celery delivery is at-least-once; never submit a second HCS message once the
    # first worker linked its receipt.
    if event.blockchain_receipt_id is not None:
        event.anchor_status = AnchorStatus.ANCHORED
        return True

    payload_hash = compute_payload_hash(canonical_payload)
    expected_receipt_type = _PHASE_RECEIPT_TYPES.get(event.phase_type)
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

    SKIP LOCKED prevents two recovery workers waiting on the same phase; updated_at
    rotates failures to the back of the queue instead of starving newer debts.
    """
    from app.orchestration.verification_service import reconstruct_pending_phase_payload

    event = (await db.execute(
        select(PhaseEvent).where(
            PhaseEvent.phase_type.in_(_PHASE_RECEIPT_TYPES),
            PhaseEvent.status.in_((PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION)),
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
        receipt_type=_PHASE_RECEIPT_TYPES[event.phase_type],
    )


def _dispatch_anchor(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Queue this event's anchor for the worker, AFTER this request's transaction commits.

    Fires on after_commit, never before: the worker opens its own session, so a task
    dispatched mid-transaction could find the row not yet committed. If the broker is
    unreachable, schedules an immediate in-process fallback instead.
    """
    # Imported at call time: tasks/blockchain.py imports this module back, and Celery's
    # own import is heavy enough to keep out of the request path's cold start.
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

    # sync_session: SQLAlchemy's event system is synchronous; after_commit is the
    # only hook that fires once this request's write is durable.
    event_module.listens_for(db.sync_session, "after_commit", once=True)(_send)


def _schedule_anchor_after_dispatch_failure(
    *, phase_event_id: uuid.UUID, canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
) -> None:
    """Start a last-resort in-process anchor when the broker is unreachable.

    Runs on the existing server loop, using its own session, to avoid an illegal
    nested asyncio.run() while still not blocking the request on Hedera.
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


async def _anchor_or_fail_open(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Anchor a phase event to Hedera without ever blocking phase completion.

    subject_id/trip_id are derived from `event` rather than taken as separate
    parameters, so a future caller can't anchor one subject while stamping the
    receipt onto a mismatched event. Unlike create_trip's anchor, which stays
    fail-closed with no committed trip to salvage, a phase event already represents
    evidence that happened — a failed anchor is recorded as a retry-owed debt
    (`anchor_status = FAILED`) rather than raised.
    """
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
            canonical_payload=canonical_payload, receipt_type=receipt_type, trip_id=event.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as exc:
        # Preserve the failure reason while the worker retries the durable debt.
        logger.exception(
            "Anchor failed for phase_event_id=%s (fail-open, D7): retry owed — %s", event.id, exc,
        )
        event.anchor_status = AnchorStatus.FAILED
        return
    event.blockchain_receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED


# Below this, a "0.3 km" reading would understate a 300 m gap as rounding noise.
_SEPARATION_KM_THRESHOLD_METRES = 1000


def _format_separation(metres: float) -> str:
    """A distance in the units a dispatcher reads at a glance."""
    if metres < _SEPARATION_KM_THRESHOLD_METRES:
        return f"{round(metres)} m"
    return f"{metres / _SEPARATION_KM_THRESHOLD_METRES:.1f} km"


def _phone_tracker_separation_metres(event: PhaseEvent) -> float | None:
    """How far apart the two independent position sources were, or None if one
    recorded no fix (never conflated with 0.0, a real "they agreed exactly" claim).
    Mirrors separationMetres() in the dispatcher's lib/phase/geo.ts.
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

    Consumes what corroboration_service wrote moments earlier in this same request;
    computes nothing about geofences itself. `is False`, deliberately, and never
    `not confirmed`: NULL means "could not check" (dark tracker, no coordinates),
    and `not None` would flag every driver who drove through a coverage dead zone.

    Lives here rather than exception_service, which stamps ExceptionSource.DRIVER
    and would misfile a system measurement as the driver's own report; every other
    system-detected exception is written here for the same reason, and
    exception_service imports this module, so the reverse import would be circular.

    The existence check below is not redundant with _gate_and_load's replay
    short-circuit — evidence writes shouldn't depend on another function's
    invariant. Not filtered on `resolved`: an actioned finding must not reappear
    when the driver app's queue flushes again. Never raises, matching
    _anchor_or_fail_open's fail-open stance.
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
            trip_stop_id=event.trip_stop_id,
            exception_type=ExceptionType.GPS_MISMATCH,
            source=ExceptionSource.SYSTEM,
            # WARNING, not CRITICAL: a geofence measurement has real false-positive
            # modes (tracker drift, a stale fix, a legitimately parked vehicle), unlike
            # CRITICAL's no-benign-reading findings. Matches PARCEL_COUNT_MISMATCH.
            severity=ExceptionSeverity.WARNING,
            review_status=_initial_review_status(ExceptionSeverity.WARNING),
            description=description,
            # The tracker's fix has no column here: both positions already live on
            # the phase_events row this exception points at, so copying them in
            # would risk drift. Recomputed at render time instead.
            gps_lat=event.driver_phone_lat,
            gps_lng=event.driver_phone_lng,
        ))

        logger.info(
            "Recorded GPS_MISMATCH for phase_event_id=%s trip_id=%s: separation=%s",
            event.id, trip.id,
            "not measurable" if separation is None else f"{separation:.1f}m",
        )

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
        # Deliberate broad catch: the driver already did the thing being recorded.
        logger.exception(
            "Could not record a position disagreement for phase_event_id=%s — the "
            "handshake stands and the corroboration columns still carry the finding",
            event.id,
        )


async def _finish_phase(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent, idempotency_key: str,
) -> TripDetailResponse:
    event.idempotency_key = idempotency_key
    event.completed_at = event.completed_at or datetime.now(UTC)

    if event.phase_type == PhaseType.IN_TRANSIT and event.status == PhaseStatus.COMPLETED:
        # Only the final driving leg's completion attests trip-wide arrival.
        later_leg = await db.execute(
            select(PhaseEvent.id).where(
                PhaseEvent.trip_id == trip.id,
                PhaseEvent.phase_type == PhaseType.IN_TRANSIT,
                PhaseEvent.sequence_number > event.sequence_number,
            ).limit(1)
        )
        if later_leg.scalar_one_or_none() is None:
            trip.actual_arrival_at = event.completed_at

    # Runs after each wrapper's own record_phase_corroboration call, so the verdict
    # read here is the one this handshake just produced; before the flush, so the
    # finding is already in the TripDetailResponse this request returns.
    await _raise_position_disagreement_if_unrecorded(db, trip=trip, event=event)

    await recompute_position(db, trip)
    await db.flush()

    # The completion may also have CLOSED the trip — distinguish so the UI raises
    # the right signal. Published on commit, never here; a thin ping, no trip data.
    kind = RealtimeKind.TRIP_CLOSED if TripStatus(trip.status) == TripStatus.CLOSED else RealtimeKind.PHASE_COMPLETED
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=kind))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


async def override_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
    operator_organization_id: uuid.UUID, user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for ONE phase the driver physically cannot
    complete — lost phone, left the depot, device wiped. Without this, a single
    unreachable phase blocked every later phase forever.

    Lives here, not in trip_admin.py: it writes a PhaseEvent and calls
    recompute_position, both owned by this module.

    Raises ResourceNotFoundError (404) if the trip or phase_event doesn't exist/
    belong here. Raises TripStateError (409) on a terminal trip, and
    PhaseSequenceError (409) if the row is already COMPLETED.
    """
    trip = await _load_trip_for_dispatcher(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id,
    )

    # Load-bearing, not defensive: cancel_trip leaves every phase row PENDING, so a
    # CANCELLED trip's rows still look overridable, and recompute_position
    # unconditionally sets CLOSED once nothing is unresolved — overriding the last
    # pending row would silently overwrite the CANCELLED fact. override_phase
    # doesn't go through _gate_and_load's driver-scoped status check, so it needs
    # this one of its own.
    if trip.status in (TripStatus.CLOSED, TripStatus.CANCELLED):
        raise TripStateError(
            current_status=TripStatus(trip.status).value,
            attempted_action="override a phase on",
        )

    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if event.status not in (PhaseStatus.PENDING, PhaseStatus.IN_PROGRESS):
        # Matches PhaseSequenceError's existing "cannot complete X: reason" vocabulary.
        raise PhaseSequenceError(f"phase status is '{PhaseStatus(event.status).value}'", "Override")

    event.status = PhaseStatus.OVERRIDDEN
    event.dispatcher_override_user_id = user_id
    event.dispatcher_override_note = note
    # Dated even though not completed: an undated row in the dispatcher's
    # chronological timeline is a worse lie than a dated one.
    event.completed_at = event.completed_at or datetime.now(UTC)

    # anchor_status is deliberately left UNTOUCHED: PENDING honestly reads "a
    # receipt was owed and never landed". NOT_REQUIRED/FAILED would both claim
    # something about the anchor attempt that isn't true.

    # The human intervention lands on the ledger, not just in an audit column.
    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        exception_type=ExceptionType.DISPATCHER_NOTE, source=ExceptionSource.DISPATCHER,
        severity=ExceptionSeverity.WARNING,
        review_status=_initial_review_status(ExceptionSeverity.WARNING),
        description=note,
    ))

    # May legitimately CLOSE the trip if this was the last unresolved row.
    await recompute_position(db, trip)
    await db.flush()

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.WARNING),
        ),
    )

    # Always PHASE_COMPLETED for an override, unlike _finish_phase's conditional kind.
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.PHASE_COMPLETED))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


# Day-month-year with a full month name: unambiguous, never confusable with US
# month-first ordering.
_SCHEDULED_DATE_FORMAT = "%d %B %Y"


def operating_day(moment: datetime) -> date:
    """The calendar date `moment` falls on in the operator's local timezone.

    A naive datetime is read as UTC rather than left to .astimezone()'s default,
    which would interpret it as the server's local time.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    local = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
    return moment.astimezone(local).date()


def is_before_scheduled_day(now: datetime, scheduled: datetime) -> bool:
    """True when `now` falls on an EARLIER operating day than `scheduled`.

    Strictly earlier, so any time on the scheduled day passes. Activating LATE is
    never blocked either: a delayed trip still needs its evidence captured.
    """
    return operating_day(now) < operating_day(scheduled)


async def _scheduled_departure(db: AsyncSession, trip: Trip) -> datetime | None:
    """When the trip is due to start: the trip-level plan, else its first booked stop.

    The fallback exists because planned_departure_at is nullable and a multi-stop
    trip can carry its timing entirely on the stops.
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

    Enforced here and NOT in _gate_and_load, which runs for every phase: a trip
    running overnight would otherwise have its later phases wrongly rejected the
    following day. Called after _gate_and_load's idempotent-replay short-circuit,
    so a resent offline activation never starts failing "too early".
    """
    scheduled = await _scheduled_departure(db, trip)
    if scheduled is None:
        # Treated as not-yet-due rather than always-allowed: an unscheduled trip
        # is a dispatcher data gap, not a free pass.
        raise PhaseTooEarlyError(None, "Activation")

    if is_before_scheduled_day(datetime.now(UTC), scheduled):
        raise PhaseTooEarlyError(
            operating_day(scheduled).strftime(_SCHEDULED_DATE_FORMAT).lstrip("0"), "Activation",
        )


async def _other_trips_for_driver(db: AsyncSession, trip: Trip) -> list[Trip]:
    """Every other non-terminal trip assigned to this trip's driver.

    Terminal trips are excluded because they cannot obstruct anything — a closed or
    cancelled trip is history.
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

    Without this, two trips could claim the same driver, horse and trailers at the
    same moment, making the custody chain of both unprovable. ACTIVE and
    EXCEPTION_HOLD both count: a held trip is still the trip the driver is on.
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

    Scoped to the SAME operating day: widening this across days would let a trip
    that was never run last week permanently block today's work. A trip with no
    resolvable schedule is skipped, since _reject_if_not_due rejects it outright.
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

    Called by every advance_*: the PWA takes a fix silently as the driver swipes to
    confirm, so every phase event can say where it was completed.

    Only writes when a value is present, so a replayed offline submission never
    erases what an earlier attempt already stored. The GPS pair and
    driver_captured_at are gated independently: a phase can carry a capture time
    with no GPS fix (denied permission) or vice versa.

    POPIA: these columns stay in Postgres. Every canonical payload builder in this
    module is an explicit whitelist, so nothing written here reaches a Hedera hash.
    """
    if payload.driver_phone_lat is not None and payload.driver_phone_lng is not None:
        # str() before Decimal: a float straight into Numeric(10, 7) carries binary
        # rounding error into fixed point (-26.0942 stores as -26.0941999...).
        event.driver_phone_lat = Decimal(str(payload.driver_phone_lat))
        event.driver_phone_lng = Decimal(str(payload.driver_phone_lng))

    # Never substituted with now() when absent — an invented capture instant would
    # defeat corroboration_service's skew check.
    if payload.driver_captured_at is not None:
        event.driver_captured_at = payload.driver_captured_at


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

    # Both gates sit AFTER _gate_and_load's idempotent-replay short-circuit: a queued
    # offline activation resent later must not fail a rule it already satisfied.
    others = await _other_trips_for_driver(db, trip)
    _reject_if_another_trip_underway(others)
    await _reject_if_an_earlier_trip_is_due(db, trip, others)

    _record_driver_position(event, payload)
    await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    # ACTIVE is the coarse "trip is underway" state until CLOSED.
    trip.status = TripStatus.ACTIVE

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


def compute_departure_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
) -> dict[str, str]:
    """Reproduce the legacy departure payload for pre-FP-154 receipts.

    JSON-native (UUIDs stringified) so compute_payload_hash's plain json.dumps
    never has to guess how to serialize a value. Excludes GPS/PII (POPIA) and
    completed_at (datetime round-trip fragility on reconstruction).
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
    await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Optional evidence: a paperless warehouse has no linehaul sheet to hand the
    # driver, and this must never block completion.
    if payload.linehaul_photo_artifact_id is not None:
        await _assert_artifacts_belong_to_trip(
            db, trip_id=trip_id, artifact_ids=(payload.linehaul_photo_artifact_id,),
        )
        event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id

    # The observed set, not a driver-entered number: the gate in _gate_and_load has
    # already established the warehouse closed its session at this stop.
    #
    # trip_stop_id is Optional on PhaseEvent (only TRIP_CREATION is ever NULL), so a
    # LOADING row always carries one — narrowed explicitly since
    # scan_service.load_consignments_at_stop requires a UUID.
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
            # BACKSTOP ONLY: scan_service._reconcile_consignment is the primary
            # writer and already fired at ingest, naming the missing barcodes. This
            # covers the one case it can't — a session closed with NOTHING scanned
            # raises no events there at all — hence the presence check, not an
            # unconditional add that would duplicate scan_service's row.
            shortfall_recorded |= await _raise_scan_shortfall_if_unrecorded(
                db, trip_id=trip_id, event=event, consignment=consignment,
                scanned_out=counts.scanned_out, expected=counts.expected,
            )

    if shortfall_recorded:
        # Only for rows this call actually wrote — a suppressed duplicate is not news.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    # None, not 0, when this stop has no consignments: a trip with no Parcel
    # Perfect reference has no manifest baseline, and 0 would read as "nothing was
    # loaded" rather than "nothing was declared".
    event.parcel_count_origin = scanned_out_total if consignments else None

    # A short scan is recorded, never blocking — FreightProof records, it doesn't dispatch.
    event.status = (
        PhaseStatus.EXCEPTION
        if consignments and scanned_out_total != expected_total
        else PhaseStatus.COMPLETED
    )

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


async def _raise_scan_shortfall_if_unrecorded(
    db: AsyncSession, *, trip_id: uuid.UUID, event: PhaseEvent,
    consignment: Consignment, scanned_out: int, expected: int,
) -> bool:
    """Record a scan-out shortfall only if scan_service has not already recorded one.

    Returns True when a row was written, so the caller (which holds the Trip/org id
    this helper doesn't) knows whether to publish a realtime event.

    Keyed on (consignment, stop, type, unresolved) rather than scan_service's own
    description-string dedup, since the two writers word the same finding
    differently and a text comparison would let both through.
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
    # Deliberately NOT Optional: None means different things at different call
    # sites (seal unknown vs. no guard re-entry), so callers resolve their own
    # None before calling rather than this function guessing.
    return seal.strip().upper()


async def _find_departure_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The departure that opened the leg ending at `before_sequence`. Well-defined
    because the plan generator interleaves exactly one `in_transit` between any
    departure and the unloading/confirmation that closes its leg.

    Caller contract: `before_sequence` must be the closing phase's OWN
    sequence_number — passing the wrong one silently resolves the wrong leg's
    departure instead of raising.
    """
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
    await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Before any evidence is written: every photo cited must be this trip's own. The
    # waybill id is normally None now; the helper skips None entries, so a replayed
    # offline entry that still carries one is checked exactly as before.
    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.waybill_photo_artifact_id, payload.seal_photo_artifact_id),
    )

    # The seal is applied HERE now, not at loading.
    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id

    # Intra-request seal continuity: compared against THIS SAME request's
    # seal_number, not a fetched prior row.
    #
    # Three states, not two. `guard_verified_seal` is Optional[bool] because guards
    # have no accounts and the app no longer collects a re-entry at all — absence of
    # confirmation is the NORMAL case and must not be flagged, or every trip would
    # get a false CRITICAL mismatch. Only an explicit False or a real re-entered
    # seal that fails to match is evidence of anything.
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
        # Recorded as evidence, but the trip still departs — a mismatch doesn't
        # hold the trip, it's anchored regardless below (same for unloading's).
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL,
            review_status=_initial_review_status(ExceptionSeverity.CRITICAL),
            description=seal_mismatch_description,
        ))
        # Both entry paths above are dead from any current client — the fields
        # survive only so a departure queued offline by an older build can still
        # replay instead of 422-ing forever.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )
    else:
        event.status = PhaseStatus.COMPLETED

    # Runs unconditionally regardless of the mismatch outcome above — a mismatch is
    # evidence in its own right, not a reason to withhold the anchor.
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
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    trip.actual_departure_at = datetime.now(UTC)
    # IN_TRANSIT stays PENDING while driving; closed by the driver's own arrival
    # submission (advance_in_transit), giving a drive time measured to actual
    # arrival rather than to whenever unloading paperwork happened to land.

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


async def advance_in_transit(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: InTransitCompleteRequest,
) -> TripDetailResponse:
    """The driver attesting arrival — the act that closes the driving leg.

    The thinnest wrapper in this module, deliberately: it writes no evidence beyond
    the phone fix every phase stores, and anchors nothing. What it changes is WHO
    owns the row — previously in_transit closed as a side effect of advance_unloading,
    so completed_at recorded when unloading paperwork was submitted, not when the
    truck actually arrived, and an overridden unloading stranded the trip ACTIVE.

    No _reject_if_not_due and no scan gate: IN_TRANSIT is absent from
    phase_gate.GATED_PHASES since the destination warehouse hasn't scanned anything
    yet when the driver pulls up — UNLOADING carries that gate instead.

    Submitted from the in-transit hub's "Arrive at destination" swipe, not a step
    page: STEP_SLUGS[in_transit] stays empty so driver-pwa routing is unchanged.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Arrival",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )
    event.status = PhaseStatus.COMPLETED

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


async def advance_unloading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: UnloadingCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Unloading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # This LEG's departure, not "the trip's": a multi-stop trip can have several
    # DEPARTURE rows, and a trip-wide lookup would raise MultipleResultsFound.
    departure_event = await _find_departure_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )

    await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, artifact_ids=(payload.gate_photo_artifact_id,),
    )

    seal_at_destination = _normalized_seal(payload.seal_number_at_destination)
    event.seal_number = seal_at_destination
    event.gate_photo_artifact_id = payload.gate_photo_artifact_id

    # "" when the departure row carries no seal at all — reachable in normal
    # operation, since override_phase can resolve a departure without ever writing
    # one. Normalizing first collapses NULL/""/whitespace to one "not recorded" case.
    departure_seal = _normalized_seal(departure_event.seal_number or "")

    if not departure_seal:
        # NOT a SEAL_MISMATCH: there's no second seal to differ from, so claiming a
        # mismatch would be a false theft indicator for something the driver can't
        # fix. Severity splits on whether the absence is EXPLAINED (an authorised
        # override vs. a data-integrity anomaly on a departure that should have a
        # seal); neither is INFO, since an unverifiable chain is what a real seal
        # swap would hide behind.
        absence_is_explained = departure_event.status == PhaseStatus.OVERRIDDEN
        # Bound once so the realtime kind below can't drift from this row's severity.
        seal_unverified_severity = (
            ExceptionSeverity.WARNING if absence_is_explained
            else ExceptionSeverity.CRITICAL
        )
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_UNVERIFIED, source=ExceptionSource.SYSTEM,
            severity=seal_unverified_severity,
            review_status=_initial_review_status(seal_unverified_severity),
            description=(
                f"Seal continuity could not be verified for this leg: no seal was "
                f"recorded at departure (departure phase is "
                f"'{PhaseStatus(departure_event.status).value}'). Seal at destination "
                f"was '{seal_at_destination}'."
            ),
        ))
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(seal_unverified_severity),
            ),
        )
    elif seal_at_destination != departure_seal:
        # Recorded as evidence, but does NOT hold the trip (no release/override path
        # exists for a held trip, and holding would destroy the trip's remaining
        # evidence — the wrong failure direction on an evidence platform). The
        # mismatch stays fully visible via the EXCEPTION status and CRITICAL row below.
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            review_status=_initial_review_status(ExceptionSeverity.CRITICAL),
            description=(
                f"Seal at destination ('{seal_at_destination}') does not match "
                f"the seal applied at departure ('{departure_seal}')."
            ),
        ))
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.CRITICAL),
            ),
        )
    else:
        event.status = PhaseStatus.COMPLETED
        # Trip simply stays ACTIVE; recompute_position derives the ledger position.

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


def compute_confirmation_canonical_payload_v1(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int,
    driver_visual_count: int | None,
) -> dict[str, str | int | None]:
    """Reproduce the legacy confirmation payload for pre-FP-154 receipts.

    Anchored unconditionally, independent of whether the counts match — a mismatch
    is evidence in its own right, not a reason to withhold the anchor. Same POPIA/
    JSON-native rules as the departure payload: no GPS/photos/PII, no completed_at.

    driver_visual_count is Optional: the key stays PRESENT with value None rather
    than omitted, since verification_service rebuilds this exact dict from the
    stored column on every verify, and an omitted key would change the payload's
    shape, not just one value.
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
    await corroboration_service.record_phase_corroboration(
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
            continue  # No baseline at either end — nothing to compare

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
        # Once, after the loop — a multi-waybill discrepancy is still one trip to refetch.
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
        # Key name unchanged though its provenance is now the warehouse feed, not
        # Parcel Perfect: verification_service rebuilds every historical anchor from it.
        pp_scan_in_count=scanned_in_total,
        driver_visual_count=payload.driver_visual_count,
        pod_photo_sha256=artifact_hashes[payload.pod_photo_artifact_id],
        pod_signature_sha256=artifact_hashes[payload.pod_signature_artifact_id],
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchors unconditionally, fail-open: a Hedera outage no longer blocks delivery
    # confirmation, the debt is recorded on event.anchor_status instead of raising.
    _dispatch_anchor(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.DELIVERY,
    )

    event.status = PhaseStatus.EXCEPTION if mismatched else PhaseStatus.COMPLETED

    # No explicit trip.status = CLOSED here: recompute_position (inside _finish_phase)
    # finds no unresolved rows left and closes the trip generically.
    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


# The single entry point the API calls. The five wrappers stay, each writing
# genuinely different evidence, but the phase-type dispatch and body/row
# cross-check live exactly once, here.
_WrapperFn = Callable[..., Awaitable[TripDetailResponse]]
_WRAPPER_BY_PHASE_TYPE: dict[PhaseType, _WrapperFn] = {
    PhaseType.ACTIVATION: advance_activation,
    PhaseType.LOADING: advance_loading,
    PhaseType.DEPARTURE: advance_departure,
    PhaseType.IN_TRANSIT: advance_in_transit,
    PhaseType.UNLOADING: advance_unloading,
    PhaseType.CONFIRMATION: advance_confirmation,
}


async def complete_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    phase_event_id: uuid.UUID, payload: PhaseCompleteRequest,
) -> TripDetailResponse:
    """Complete the addressed phase. Idempotent by payload.idempotency_key.

    Raises PhaseTypeMismatchError when the body's phase_type does not match the
    addressed row's — including trip_creation, which no driver action completes.
    """
    # Ownership BEFORE the type cross-check: PhaseTypeMismatchError's 409 body names
    # the row's real phase_type, so without this a driver holding someone else's
    # trip_id/phase_event_id could probe a foreign trip's plan via the error.
    await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)
    actual = PhaseType(event.phase_type)
    if actual != payload.phase_type:
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    wrapper = _WRAPPER_BY_PHASE_TYPE.get(actual)
    if wrapper is None:
        # Unreachable via the API, but a direct service caller needs the same
        # clear error, not a KeyError.
        raise PhaseTypeMismatchError(expected=actual.value, received=payload.phase_type.value)

    return await wrapper(
        db, trip_id=trip_id, driver_id=driver_id,
        phase_event_id=phase_event_id, payload=payload,
    )


async def next_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> PhaseEvent | None:
    """The lowest-sequence unresolved row.

    Re-derived from the ledger, never read off trip.current_phase: if the cache
    ever diverges, this endpoint tells the truth instead of laundering it.
    Returns None for a closed trip.
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
