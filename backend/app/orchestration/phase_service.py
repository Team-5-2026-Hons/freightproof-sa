"""Phase completion engine — advance_activation through advance_confirmation.

Replaces the old fixed-5-handshake model (advance_h1..advance_h5, gated on
Trip.status). A trip's full phase plan (parent plan §2.2/D5) is written at
trip creation (task 2.1) — every PhaseEvent row a driver will ever complete
already exists, `pending`, before any of these functions ever runs. No code
path in this module may insert a PhaseEvent row (T2's fence).

Two shared core helpers do steps 1-9 of parent §2.4 that are identical across
every phase (_gate_and_load / _finish_phase); five thin wrappers keep today's
per-phase payload shapes and evidence-writing logic and route through that
shared core for everything generic:
  1. _gate_and_load() loads the trip + phase event, verifies trip ownership,
     rejects a closed/cancelled/held trip, short-circuits an idempotent replay
     of an already-completed phase (task 2.4), and gates on every
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

advance_departure (P3) and advance_confirmation (P6) anchor to Hedera HCS per
api_contract_dispatcher_driver.md §3.4: a JSON-native canonical payload is
built (compute_departure_canonical_payload / compute_confirmation_canonical_payload),
hashed via the shared compute_payload_hash()
(app/blockchain/anchor_service.py — the same hasher trips and vehicles use),
then anchor_subject() submits it to Hedera and persists a BlockchainReceipt.
As of task 2.6 (D7/T5), the seal — and with it the anchor — moved whole from
loading to departure: the driver applies and photographs the seal at
departure, not loading, so that is where the anchorable evidence now exists.
Both anchors are fail-open via _anchor_or_fail_open() (task 2.5's D7): a
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
If the broker is unreachable the anchor runs inline exactly as it used to —
nothing in this codebase retries a FAILED anchor, so a dropped dispatch would
mean permanently unanchored evidence.
advance_activation, advance_loading, advance_unloading remain unanchored
feeders by design — they record cross-checks (GPS, driver visual count, seal
continuity at destination) that support the anchored departure/confirmation
phases but are not themselves committed to chain.
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
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.core.exceptions import (
    HederaServiceError, HederaTimeoutError, PhaseBlockedError, PhaseSequenceError, PhaseTooEarlyError,
    PhaseTypeMismatchError, ResourceNotFoundError, TripActivationBlockedError, TripStateError,
)
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType,
    PhaseStatus, PhaseType, SubjectType, TripStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop
from app.integrations.scan_feed import ScanDirection
from app.orchestration import scan_service
from app.orchestration.phase_gate import blocked_on_by_stop
from app.orchestration.resource_service import get_trip_detail
from app.schemas.phases import (
    ActivationCompleteRequest, ConfirmationCompleteRequest, DepartureCompleteRequest,
    LoadingCompleteRequest, PhaseCompleteRequest, UnloadingCompleteRequest,
)
from app.schemas.trips import TripDetailResponse

logger = logging.getLogger(__name__)


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
    advance_* wrappers, and task 6.1's override_phase) shares — which is why
    the lock below covers all of them from one place.

    D8: row-locked with FOR UPDATE. Two concurrent completions of the SAME
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
) -> None:
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
    """
    present = {aid for aid in artifact_ids if aid is not None}
    if not present:
        return

    result = await db.execute(
        select(EvidenceArtifact.id).where(
            EvidenceArtifact.id.in_(present),
            EvidenceArtifact.trip_id == trip_id,
        )
    )
    owned = {row for (row,) in result.all()}

    missing = present - owned
    if missing:
        # Sorted so the message is deterministic across runs — this ends up in an
        # API error body and in test assertions.
        raise ResourceNotFoundError(
            "EvidenceArtifact", ", ".join(sorted(str(m) for m in missing)),
        )


def _is_resolved(status: PhaseStatus) -> bool:  # T3
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
    """Steps 1-4 of parent §2.4. Returns (trip, event) to continue, or a
    TripDetailResponse if idempotent replay already short-circuited."""
    trip = await _load_trip_for_driver(db, trip_id=trip_id, driver_id=driver_id)
    event = await _load_phase_event(db, trip_id=trip_id, phase_event_id=phase_event_id)

    if _is_resolved(event.status):
        # Idempotent replay (task 2.4) — COMPLETED, EXCEPTION, and OVERRIDDEN
        # are all "already decided" (T3's own predicate, matched here so a
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
    """Steps 8-9 of parent §2.4. Public because create_trip must seed the cache the
    moment the plan exists (U4) — before this, a freshly created trip reported
    current_phase = NULL until its first advance.

    trip_stop_id is a FK, not the sequence int D6 wants cached — the join to
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


async def anchor_phase_event(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> bool:
    """Load a phase event by id and anchor it. Returns whether a receipt was written.

    The entry point tasks/blockchain.py re-enters this module through, so the anchoring
    contract (canonical payload in, fail-open on Hedera trouble) stays defined here
    rather than being duplicated in a worker.
    """
    result = await db.execute(select(PhaseEvent).where(PhaseEvent.id == phase_event_id))
    event = result.scalar_one_or_none()
    if event is None:
        # Nothing to anchor and nothing to retry — the row a receipt was owed against is
        # gone. Loud, because it should be impossible: the dispatch only happens after
        # the transaction that wrote this row has committed.
        logger.error("Anchor requested for unknown phase_event_id=%s", phase_event_id)
        return False
    await _anchor_or_fail_open(
        db, event=event, canonical_payload=canonical_payload, receipt_type=receipt_type,
    )
    return event.anchor_status == AnchorStatus.ANCHORED


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
    * If the broker cannot be reached, it anchors INLINE instead, exactly as this code did
      before. Nothing in this codebase retries an anchor_status = FAILED debt, so a
      silently dropped dispatch would mean permanently unanchored evidence — a slow
      submit is a far better failure than that.
    """
    # Imported at call time: tasks/blockchain.py imports this module back, and Celery's
    # own import is heavy enough to be worth keeping out of the request path's cold start.
    from app.tasks.blockchain import anchor_phase_event_task

    event_id = event.id
    payload = dict(canonical_payload)

    def _send(_session: Any) -> None:
        try:
            anchor_phase_event_task.delay(str(event_id), payload, receipt_type.value)
        except Exception:  # noqa: BLE001 — any broker failure, not just one library's
            logger.exception(
                "Could not queue the anchor for phase_event_id=%s — anchoring inline instead",
                event_id,
            )
            _anchor_inline_after_dispatch_failure(
                phase_event_id=event_id, canonical_payload=payload, receipt_type=receipt_type,
            )

    # sync_session: SQLAlchemy's event system is synchronous, and after_commit is the
    # only hook that fires once this request's write is actually durable.
    event_module.listens_for(db.sync_session, "after_commit", once=True)(_send)


def _anchor_inline_after_dispatch_failure(
    *, phase_event_id: uuid.UUID, canonical_payload: dict[str, Any],
    receipt_type: BlockchainReceiptType,
) -> None:
    """Last-resort synchronous anchor when the broker is unreachable.

    Runs in its own session because the request's transaction has already committed by
    the time this is reachable (see _dispatch_anchor's after_commit hook), so the anchor
    lands as its own small write rather than reopening a closed transaction.
    """
    from app.tasks.blockchain import _anchor

    try:
        asyncio.run(_anchor(
            phase_event_id=phase_event_id,
            canonical_payload=canonical_payload,
            receipt_type=receipt_type,
        ))
    except Exception:  # noqa: BLE001 — this is already the fallback path
        logger.exception(
            "Inline anchor fallback failed for phase_event_id=%s — receipt owed", phase_event_id,
        )


async def _anchor_or_fail_open(
    db: AsyncSession, *, event: PhaseEvent,
    canonical_payload: dict[str, Any], receipt_type: BlockchainReceiptType,
) -> None:
    """Anchor a phase event to Hedera without ever blocking phase completion (D7).

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
    (task 2.1's plan generator only ever set it to PENDING) — ANCHORED on success,
    FAILED on failure, matching D4's contract that `anchor_status` is the one place
    to check whether a receipt is actually owed.
    """
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
            canonical_payload=canonical_payload, receipt_type=receipt_type, trip_id=event.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as exc:
        # logger.exception (not .error) so the traceback and the caught exception's
        # own message are captured — with no retry mechanism yet, this log line is
        # the only trail that a receipt is owed at all.
        logger.exception(
            "Anchor failed for phase_event_id=%s (fail-open, D7): retry owed — %s", event.id, exc,
        )
        event.anchor_status = AnchorStatus.FAILED
        return
    event.blockchain_receipt_id = receipt.id
    event.anchor_status = AnchorStatus.ANCHORED


async def _finish_phase(
    db: AsyncSession, *, trip: Trip, event: PhaseEvent, idempotency_key: str,
) -> TripDetailResponse:
    event.idempotency_key = idempotency_key
    event.completed_at = event.completed_at or datetime.now(UTC)
    await recompute_position(db, trip)
    await db.flush()

    # Notify dispatchers watching this trip. The completion may also have CLOSED the trip
    # (advance_confirmation, phase_service.py) — distinguish the two so the UI raises the
    # right signal. Published on commit, never here (D9); a thin ping, no trip data.
    kind = RealtimeKind.TRIP_CLOSED if TripStatus(trip.status) == TripStatus.CLOSED else RealtimeKind.PHASE_COMPLETED
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=kind))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


async def override_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
    operator_organization_id: uuid.UUID, user_id: uuid.UUID, note: str,
) -> TripDetailResponse:
    """Dispatcher-only terminal exit for ONE phase the driver physically cannot
    complete — lost phone, left the depot, device wiped, bound to a device that
    is gone (task 6.1). Without this, a single unreachable phase blocked every
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
    # D4: dated even though not completed. `status` already carries the "this
    # didn't really happen" truth — an undated row in the dispatcher's
    # chronological timeline (which reads completed_at for its card timestamp)
    # is a worse lie than a dated one. Mirrors _finish_phase's own
    # `event.completed_at = event.completed_at or now()` above.
    event.completed_at = event.completed_at or datetime.now(UTC)

    # D3: anchor_status is deliberately left UNTOUCHED. If this is a departure,
    # no seal evidence exists to anchor — leaving PENDING honestly reads "a
    # receipt was owed here and never landed" (which the dispatcher's
    # anchorTally surfaces as owed > anchored). Setting NOT_REQUIRED would
    # launder a real gap in the evidence chain; setting FAILED would claim an
    # anchor was attempted. Neither is true, so neither is written.

    # D5: the human intervention lands on the ledger, not just in an audit column.
    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        exception_type=ExceptionType.DISPATCHER_NOTE, source=ExceptionSource.DISPATCHER,
        severity=ExceptionSeverity.WARNING, description=note,
    ))

    # May legitimately CLOSE the trip if this was the last unresolved row — that
    # is correct and must not be special-cased; _is_resolved already treats
    # OVERRIDDEN as resolved for gating purposes.
    await recompute_position(db, trip)
    await db.flush()

    # D9: always PHASE_COMPLETED for an override — the plan position moved, same
    # refetch as any completion (unlike _finish_phase, this is not conditional on
    # the trip closing; that distinction belongs to cancel_trip's TRIP_CLOSED).
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip.id, kind=RealtimeKind.PHASE_COMPLETED))

    return await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)


# Display format for the date a driver is told to come back on. Day-month-year with a
# full month name: unambiguous to a South African reader, and never confusable with the
# US month-first ordering the way a numeric date would be.
_SCHEDULED_DATE_FORMAT = "%-d %B %Y"


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
            operating_day(scheduled).strftime(_SCHEDULED_DATE_FORMAT), "Activation",
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
    """Stamp the driver's phone fix onto the phase event, when the app sent one.

    Called by every advance_*, not just activation: the PWA no longer has manual
    "Capture GPS Location" steps, it takes a fix silently as the driver swipes to
    confirm, so every phase event can now say where it was completed.

    Only writes when a fix is present. A None must never overwrite a position already
    stored by an earlier attempt — a replayed offline submission whose original capture
    succeeded would otherwise erase it on retry.

    POPIA: these columns stay in Postgres. Every canonical payload builder in this
    module is an explicit whitelist, so nothing written here can reach a Hedera hash.
    """
    if payload.driver_phone_lat is None or payload.driver_phone_lng is None:
        return
    # str() before Decimal: handing a float straight to a Numeric(10, 7) column carries
    # the float's binary rounding error into fixed point (-26.0942 stores as
    # -26.0941999...). The string form is the coordinate the phone actually reported.
    event.driver_phone_lat = Decimal(str(payload.driver_phone_lat))
    event.driver_phone_lng = Decimal(str(payload.driver_phone_lng))


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

    # GPS cross-reference against Pulsit horse GPS is a feeder check (P1 is not
    # anchored to Hedera) — Pulsit integration itself is out of scope for this
    # plan; until it lands, horse_gps fields stay null and the check is skipped
    # rather than faked, so dispatchers see an honest "not yet cross-checked" state.
    _record_driver_position(event, payload)
    event.status = PhaseStatus.COMPLETED

    # First phase off CREATED. LEGACY per-handshake TripStatus values are gone
    # (T6) — ACTIVE is the coarse "trip is underway" state until CLOSED.
    trip.status = TripStatus.ACTIVE

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


def compute_departure_canonical_payload(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str,
) -> dict[str, str]:
    """Canonical departure payload anchored to Hedera (PICKUP receipt).

    JSON-native (UUIDs stringified explicitly) so compute_payload_hash's plain
    json.dumps (no default=str fallback) never has to guess how to serialize a
    value. Deliberately excludes GPS, photos, and artifact IDs — only hashes of
    evidence belong on-chain, never GPS/PII (POPIA); completed_at is excluded
    too, to avoid datetime round-trip fragility when verification reconstructs
    this payload later. driver_visual_count is gone (T5/task 2.6): the count
    stays on loading, unanchored, and departure has no reason to fetch a value
    from a different PhaseEvent row just to anchor it.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "departure",
        "seal_number": seal_number,
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

    # Optional evidence: a warehouse that has already gone paperless has no linehaul
    # sheet to hand the driver, and this must never block completion (schema docstring).
    if payload.linehaul_photo_artifact_id is not None:
        await _assert_artifacts_belong_to_trip(
            db, trip_id=trip_id, artifact_ids=(payload.linehaul_photo_artifact_id,),
        )
        event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id

    # The observed set, not a driver-entered number. The gate in _gate_and_load has
    # already established that the warehouse closed its session at this stop, so these
    # counts are final for this loading — which is what makes stamping the aggregate
    # here safe under the "anchored payload contains only data that existed at close"
    # rule (design §2.1). driver_visual_count is accepted on the payload (schema) but
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
            await _raise_scan_shortfall_if_unrecorded(
                db, trip_id=trip_id, event=event, consignment=consignment,
                scanned_out=counts.scanned_out, expected=counts.expected,
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

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


async def _raise_scan_shortfall_if_unrecorded(
    db: AsyncSession, *, trip_id: uuid.UUID, event: PhaseEvent,
    consignment: Consignment, scanned_out: int, expected: int,
) -> None:
    """Record a scan-out shortfall only if scan_service has not already recorded one.

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
            TripException.resolved.is_(False),
        )
    )).first()
    if existing is not None:
        return

    db.add(TripException(
        trip_id=trip_id, phase_event_id=event.id,
        consignment_id=consignment.id, trip_stop_id=event.trip_stop_id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        description=(
            f"Warehouse closed its scan-out session on waybill "
            f"{consignment.parcel_perfect_reference} with "
            f"{scanned_out} of {expected} parcel(s) scanned."
        ),
    ))


def _normalized_seal(seal: str) -> str:
    return seal.strip().upper()


async def _find_departure_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The departure that opened the leg ending at `before_sequence`. Well-defined
    because the plan generator (phase_plan.build_phase_plan) interleaves exactly
    one `in_transit` between any departure and the unloading/confirmation that
    closes its leg (§2.2's generation rule) — there is never a second departure
    to be confused with the right one.

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


async def _find_in_transit_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """Find the IN_TRANSIT row that opened the leg ending at `before_sequence`.

    Mirrors _find_departure_for_leg: the plan generator guarantees exactly one
    IN_TRANSIT between any DEPARTURE and the stop's closing phase (UNLOADING or
    CONFIRMATION). This row represents the driving interval for this leg —
    opened when departure completes, closed when the driver arrives.

    Caller contract: `before_sequence` must be the sequence_number of the
    arrival phase's OWN row (UNLOADING or CONFIRMATION).
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.IN_TRANSIT,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    in_transit = result.scalar_one_or_none()
    if in_transit is None:
        raise ResourceNotFoundError("PhaseEvent", "in_transit")
    return in_transit


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

    # Pulsit geofence departure confirmation is out of scope until the Pulsit
    # integration lands; pulsit_geofence_confirmed stays null until then.

    # Before any evidence is written: both photos must be this trip's own.
    await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.waybill_photo_artifact_id, payload.seal_photo_artifact_id),
    )

    # T5: the seal is applied HERE now, not at loading.
    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id

    # Intra-request seal continuity (T5) — compared against THIS SAME
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
        # mismatch doesn't hold the trip (T3), it's anchored regardless below.
        # Unloading's seal mismatch (destination) matches this precedent too —
        # neither ever holds the trip, only flags it (critical exception).
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL,
            description=seal_mismatch_description,
        ))
    else:
        event.status = PhaseStatus.COMPLETED

    # D7: the anchor moves whole to departure. Runs unconditionally regardless
    # of the mismatch outcome above — a mismatch is evidence in its own right,
    # not a reason to withhold the anchor (matching confirmation's precedent).
    canonical_payload = compute_departure_canonical_payload(
        phase_event_id=event.id, trip_id=trip_id, seal_number=payload.seal_number,
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
    # IN_TRANSIT stays PENDING while the driver is moving. It will be closed by
    # advance_unloading when the driver arrives. This gives the dispatcher a real
    # elapsed-time window to view the leg, rather than auto-closing at the same
    # millisecond as departure (which was the old stopgap behaviour).

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

    # Close the IN_TRANSIT row for this leg: the driver has arrived. IN_TRANSIT
    # opened when departure completed, now closes with a real completion time.
    # The dispatcher timeline shows the leg with elapsed time between departure
    # and arrival, and all exceptions logged during the drive.
    in_transit_event = await _find_in_transit_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )
    if in_transit_event.status == PhaseStatus.PENDING:
        in_transit_event.status = PhaseStatus.COMPLETED
        in_transit_event.completed_at = datetime.now(UTC)

    # T4: this LEG's departure (strictly before this row), not "the trip's" —
    # a multi-stop trip can have several DEPARTURE rows, and a plain
    # phase_type == LOADING (or DEPARTURE) trip-wide lookup would raise
    # MultipleResultsFound on a real cross-dock trip.
    departure_event = await _find_departure_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )

    await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, artifact_ids=(payload.gate_photo_artifact_id,),
    )

    event.seal_number = payload.seal_number_at_destination
    event.gate_photo_artifact_id = payload.gate_photo_artifact_id

    if payload.seal_number_at_destination != departure_event.seal_number:
        # Recorded as evidence, but does NOT hold the trip. This branch used to set
        # trip.status = EXCEPTION_HOLD; three reasons it must not:
        #
        # 1. There is no release or override path anywhere in this codebase. A held
        #    trip could never reach confirmation, so it could never record POD or
        #    anchor its delivery receipt — the hold DESTROYED the remaining evidence
        #    of the very trip whose integrity it was reacting to. On an evidence
        #    platform that is the wrong failure direction: record more, not less.
        # 2. It contradicted T3. _is_resolved already treats EXCEPTION as resolved
        #    for gating, precisely so an anomaly is recorded without stopping the
        #    ledger. Holding here re-introduced the blocking behaviour by the back
        #    door, at trip level instead of phase level.
        # 3. Departure's own seal mismatch (above) has never held the trip. Two
        #    seal mismatches on the same trip behaving differently was inconsistent
        #    with nothing to justify it.
        #
        # The mismatch stays fully visible: the phase row is EXCEPTION and a CRITICAL
        # TripException is written. A dispatcher acts on that, not on a stuck trip.
        # If a hold is ever genuinely wanted it belongs as a manual dispatcher action
        # with an explicit release path — not as an automatic dead end.
        event.status = PhaseStatus.EXCEPTION
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at destination ('{payload.seal_number_at_destination}') does not match "
                f"the seal applied at departure ('{departure_event.seal_number}')."
            ),
        ))
    else:
        event.status = PhaseStatus.COMPLETED
        # No LEGACY trip.status assignment here (DEST_GATE_IN is deleted, T6) —
        # the trip simply stays ACTIVE; recompute_position derives the ledger
        # position generically.

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


def compute_confirmation_canonical_payload(
    *, phase_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int, driver_visual_count: int,
) -> dict[str, str | int]:
    """Canonical confirmation payload anchored to Hedera (DELIVERY receipt).

    Anchored unconditionally, independent of whether the counts match — a
    mismatch is evidence in its own right (recorded separately as a
    TripException), not a reason to withhold the anchor. Same POPIA/JSON-native
    rules as compute_departure_canonical_payload: no GPS/photos/PII, no completed_at.

    phase_type is "confirmation", not "unloading" — task 2.7 corrects a
    pre-existing mislabel, not just a rename: this builder has only ever been
    called from the confirmation phase, the old value was simply wrong from
    day one. It does not change which phase anchors.
    """
    return {
        "phase_event_id": str(phase_event_id),
        "trip_id": str(trip_id),
        "phase_type": "confirmation",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
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

    await _assert_artifacts_belong_to_trip(
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
                description=(
                    f"Parcel count changed in transit on waybill "
                    f"{consignment.parcel_perfect_reference}: "
                    f"{counts.scanned_out} scanned out at origin, "
                    f"{counts.scanned_in} scanned in at destination."
                ),
            ))

    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = scanned_in_total

    canonical_payload = compute_confirmation_canonical_payload(
        phase_event_id=event.id, trip_id=trip_id,
        # Key name unchanged — see the schema comment. Its provenance is now the
        # warehouse feed rather than Parcel Perfect; its name is a mild misnomer and
        # stays, because verification_service rebuilds every historical anchor from it.
        pp_scan_in_count=scanned_in_total,
        driver_visual_count=payload.driver_visual_count,
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchors unconditionally, fail-open (D7, task 2.5) — a Hedera outage no longer
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
    trip.actual_arrival_at = trip.actual_arrival_at or datetime.now(UTC)

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


# Decision S6: the single entry point the API calls. The five wrappers stay —
# each writes genuinely different evidence (Stage 2's T1) — but the phase-type
# dispatch and the body/row cross-check live exactly once, here.
# Per-wrapper payload types differ, so the table is typed by its shared contract
# rather than per-member: complete_phase has already proven actual == payload.phase_type
# before dispatching, which is the check a precise signature would have given us.
_WrapperFn = Callable[..., Awaitable[TripDetailResponse]]
_WRAPPER_BY_PHASE_TYPE: dict[PhaseType, _WrapperFn] = {
    PhaseType.ACTIVATION: advance_activation,
    PhaseType.LOADING: advance_loading,
    PhaseType.DEPARTURE: advance_departure,
    PhaseType.UNLOADING: advance_unloading,
    PhaseType.CONFIRMATION: advance_confirmation,
}


async def complete_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    phase_event_id: uuid.UUID, payload: PhaseCompleteRequest,
) -> TripDetailResponse:
    """Complete the addressed phase. Idempotent by payload.idempotency_key.

    Raises PhaseTypeMismatchError when the body's phase_type does not match the
    addressed row's — including when the row is trip_creation or in_transit,
    neither of which any driver action completes (create_trip writes the first;
    advance_departure's NEW-8 stopgap writes the second).
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
    """The lowest-sequence unresolved row — decision S7.

    Re-derived from the ledger, never read off trip.current_phase: the cache is a
    cache (parent §2.3), and if it ever diverges this endpoint tells the truth
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
