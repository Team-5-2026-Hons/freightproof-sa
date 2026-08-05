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
advance_activation, advance_loading, advance_unloading remain unanchored
feeders by design — they record cross-checks (GPS, driver visual count, seal
continuity at destination) that support the anchored departure/confirmation
phases but are not themselves committed to chain.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.config import settings
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.core.exceptions import (
    HederaServiceError, HederaTimeoutError, PhaseSequenceError, PhaseTooEarlyError,
    PhaseTypeMismatchError, ResourceNotFoundError,
)
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType,
    PhaseStatus, PhaseType, SubjectType, TripStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop
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


async def _load_phase_event(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID,
) -> PhaseEvent:
    result = await db.execute(
        select(PhaseEvent).where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip_id)
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

    # GPS cross-reference against Pulsit horse GPS is a feeder check (P1 is not
    # anchored to Hedera) — Pulsit integration itself is out of scope for this
    # plan; until it lands, horse_gps fields stay null and the check is skipped
    # rather than faked, so dispatchers see an honest "not yet cross-checked" state.
    event.driver_phone_lat = payload.driver_phone_lat
    event.driver_phone_lng = payload.driver_phone_lng
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


async def _expected_parcel_count(db: AsyncSession, *, trip_id: uuid.UUID) -> int | None:
    """The manifest's declared total, trip-wide — same grain TripCreatedDetail sums
    client-side. Returns None (not 0) when the trip has no consignments at all, or
    every consignment's parcel_count_expected is unset: there is no manifest baseline
    to compare against, and treating that as 0 would manufacture a mismatch on a trip
    that simply hasn't had its expected counts populated yet (same principle Stage 6's
    empty-leg fix applies to the confirmation-side origin_count lookup)."""
    result = await db.execute(
        select(func.sum(Consignment.parcel_count_expected)).where(Consignment.trip_id == trip_id)
    )
    return result.scalar_one_or_none()


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

    # D7/T5: loading no longer captures or anchors the seal — that moves whole
    # to departure. driver_visual_count is the only evidence this phase still
    # owns; it stays unanchored (server-side reconciliation is Stage 3.3).
    event.driver_visual_count = payload.driver_visual_count

    # Manifest-vs-counted check at ORIGIN, before the truck leaves — distinct from
    # advance_confirmation's WAYBILL_COUNT_MISMATCH, which reconciles what physically
    # moved (origin/destination/driver-visual). This compares what was declared to PP
    # against what the driver saw, so it gets its own type: PARCEL_COUNT_MISMATCH.
    expected_count = await _expected_parcel_count(db, trip_id=trip_id)
    event.parcel_count_origin = expected_count

    if expected_count is not None and expected_count != payload.driver_visual_count:
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.PARCEL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            description=(
                f"Manifest expects {expected_count} parcels; driver counted "
                f"{payload.driver_visual_count} at loading."
            ),
        ))
        # Recorded as evidence, but does NOT hold the trip — matches departure's and
        # unloading's own seal-mismatch precedent (T3/_is_resolved treats EXCEPTION as
        # resolved for gating). FreightProof records what happened; it doesn't dispatch
        # or reroute, so a count discrepancy is surfaced, never a departure blocker.
        event.status = PhaseStatus.EXCEPTION
    else:
        event.status = PhaseStatus.COMPLETED

    return await _finish_phase(db, trip=trip, event=event, idempotency_key=payload.idempotency_key)


def _normalized_seal(seal: str) -> str:
    return seal.strip().upper()


async def _auto_complete_in_transit(db: AsyncSession, *, trip_id: uuid.UUID, after_sequence: int) -> None:
    """Stopgap for Stage 2 (flagged in the Findings ledger — awaiting real
    checkpoint-Merkle-batch wiring, D2 in the parent plan): P4 (in_transit) is
    a real ledger row anchored to the stop it departs from, meant to be closed
    by checkpoint batches that don't exist yet in this codebase. Until that
    lands, departure and in-transit are treated as instantaneous: the row
    immediately following this leg's departure (build_phase_plan guarantees
    exactly one, always — DEPARTURE is only ever emitted when a stop isn't the
    trip's last, and always paired with an IN_TRANSIT emit in the same branch)
    is marked completed here. No idempotency_key is stamped — no driver action
    or offline-queue entry produced this completion, and the partial unique
    index (WHERE idempotency_key IS NOT NULL) only applies when one exists.

    Idempotent on its own: a replayed advance_departure call (same
    phase_event_id/idempotency_key resent after a lost ack) must not stamp a
    fresh completed_at over an already-closed evidence row a second time."""
    result = await db.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.IN_TRANSIT,
            PhaseEvent.sequence_number == after_sequence + 1,
        )
    )
    in_transit_event = result.scalar_one()
    if in_transit_event.status == PhaseStatus.COMPLETED:
        return
    in_transit_event.status = PhaseStatus.COMPLETED
    in_transit_event.completed_at = datetime.now(UTC)


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


async def _find_loading_for_leg(
    db: AsyncSession, *, trip_id: uuid.UUID, before_sequence: int,
) -> PhaseEvent:
    """The LOADING row that loaded the leg ending at `before_sequence` — decision S1.

    Same shape and same reason as _find_departure_for_leg: a cross-dock trip has
    several LOADING rows, so a trip-wide phase_type lookup raises
    MultipleResultsFound (NEW-9 in Stage 2's Findings ledger).

    Semantics, not just mechanics: confirmation reconciles what was loaded onto
    the FINAL leg against what arrived at the final stop. Cargo picked up earlier
    and dropped at an intermediate stop left the vehicle before this leg began —
    counting it would guarantee a false mismatch. Cargo dropped mid-route is not
    count-reconciled at all today; that is F1 / Stage 3.3, deliberately deferred.

    Caller contract: `before_sequence` must be the sequence_number of the
    confirmation's OWN row. Passing anything else silently resolves the wrong leg.
    """
    result = await db.execute(
        select(PhaseEvent)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == PhaseType.LOADING,
            PhaseEvent.sequence_number < before_sequence,
        )
        .order_by(PhaseEvent.sequence_number.desc())
        .limit(1)
    )
    loading = result.scalar_one_or_none()
    if loading is None:
        raise ResourceNotFoundError("PhaseEvent", "loading")
    return loading


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
    seal_mismatch_description: str | None = None
    if payload.seal_number_confirmed is not None:
        confirmed = _normalized_seal(payload.seal_number_confirmed)
        if confirmed != _normalized_seal(payload.seal_number):
            seal_mismatch_description = (
                f"Seal at origin gate-out ('{confirmed}') does not match "
                f"the seal applied at departure ('{payload.seal_number}')."
            )
    elif not payload.guard_verified_seal:
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
    await _anchor_or_fail_open(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.PICKUP,
    )

    trip.actual_departure_at = datetime.now(UTC)
    # Both branches: a recorded seal exception doesn't hold the trip (comment
    # above), so the leg is physically in transit either way.
    await _auto_complete_in_transit(db, trip_id=trip_id, after_sequence=event.sequence_number)

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

    # S1 / NEW-9: this leg's loading, not the trip's. A trip-wide phase_type
    # lookup raised MultipleResultsFound on every real cross-dock trip.
    loading_event = await _find_loading_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )
    origin_count = loading_event.driver_visual_count

    await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id,
        artifact_ids=(payload.pod_photo_artifact_id, payload.pod_signature_artifact_id),
    )

    event.pod_photo_artifact_id = payload.pod_photo_artifact_id
    event.pod_signature_artifact_id = payload.pod_signature_artifact_id
    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = payload.pp_scan_in_count

    canonical_payload = compute_confirmation_canonical_payload(
        phase_event_id=event.id, trip_id=trip_id,
        pp_scan_in_count=payload.pp_scan_in_count, driver_visual_count=payload.driver_visual_count,
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchors unconditionally, fail-open (D7, task 2.5) — a Hedera outage no
    # longer blocks delivery confirmation from completing; _anchor_or_fail_open
    # records the debt on event.anchor_status instead of raising.
    await _anchor_or_fail_open(
        db, event=event, canonical_payload=canonical_payload,
        receipt_type=BlockchainReceiptType.DELIVERY,
    )

    counts_match = (
        origin_count == payload.pp_scan_in_count == payload.driver_visual_count
    )
    if not counts_match:
        db.add(TripException(
            trip_id=trip_id, phase_event_id=event.id,
            exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            description=(
                f"Count mismatch at unload: origin={origin_count}, "
                f"PP scan-in={payload.pp_scan_in_count}, driver visual={payload.driver_visual_count}."
            ),
        ))
        event.status = PhaseStatus.EXCEPTION
    else:
        event.status = PhaseStatus.COMPLETED

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
