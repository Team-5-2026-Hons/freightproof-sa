"""Trip exceptions — the driver raising one, and the dispatcher reviewing it."""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, literal, or_, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ExceptionAlreadyReviewedError, ResourceNotFoundError
from app.core.pagination import CursorPosition, decode_cursor, encode_cursor
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.transit import TripException
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration import action_location_service
from app.orchestration.artifact_service import get_trip_scoped_artifact
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.phase_service import current_phase_event
from app.schemas.pagination import CursorPage
from app.schemas.transit import TripExceptionDetail, TripExceptionListItem, TripExceptionRead

logger = logging.getLogger(__name__)

# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep these two in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}

# Name of the partial unique index on (trip_id, client_report_id) — migration
# ciaran_exc_idempotency. Matched against violated_constraint() below so that some
# unrelated unique-violation on this table is never misread as a replay.
_CLIENT_REPORT_ID_INDEX = "uq_exceptions_trip_client_report_id"
_DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS = 2.0


async def _driver_report_assessment(
    db: AsyncSession,
    *,
    trip: Trip,
    exc: TripException,
    driver_captured_at: datetime | None,
    driver_accuracy_metres: float | None,
) -> None:
    """Attach one optional comparison after the primary report row is flushed."""
    device_result = await db.execute(
        select(Vehicle.pulsit_device_id).where(Vehicle.id == trip.horse_id)
    )
    device_id = device_result.scalar_one_or_none()
    source = PulsitFixSource.MOCK if settings.PULSE_USE_MOCK else PulsitFixSource.LIVE
    horse_fix = PulsitFix(
        device_id=device_id or "unavailable", status=PulsitFixStatus.UNAVAILABLE,
        source=source, lat=None, lng=None, fixed_at=None,
    )
    if device_id is not None:
        try:
            horse_fix = await asyncio.wait_for(
                get_pulsit_client(organization_id=trip.operator_organization_id).get_position(device_id),
                timeout=_DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS,
            )
        except Exception as telemetry_error:
            logger.warning(
                "Driver-report tracker comparison unavailable for trip=%s exception=%s: %s",
                trip.id, exc.id, telemetry_error,
            )

    # This is deliberately transient. It reuses the road-event assessment builder but
    # is never stored as a checkpoint or turned into a separation exception.
    from app.db.models.transit import Checkpoint

    capture = Checkpoint(
        trip_id=trip.id, checkpoint_type="driver_exception_capture",
        driver_phone_lat=exc.gps_lat, driver_phone_lng=exc.gps_lng,
        driver_captured_at=driver_captured_at,
    )
    assessment = action_location_service.build_checkpoint_assessment(
        checkpoint=capture, horse_fix=horse_fix,
        driver_accuracy_metres=driver_accuracy_metres, evaluated_at=datetime.now(UTC),
    )
    exc.action_location_assessment = assessment.model_dump(mode="json")
    await db.flush()

def initial_review_status(severity: ExceptionSeverity) -> ExceptionReviewStatus:
    """Where a freshly-created exception starts in the dispatcher review workflow
    (Task 2, FP-146 follow-on).

    CRITICAL findings — a panic button, a seal broken in transit, a destination seal
    mismatch — need a dispatcher's decision now, so they start NEEDS_REVIEW. Everything
    else (WARNING, INFO) starts RECORDED: visible on the trip's exception list, but not
    queued for action until a dispatcher chooses to look.

    Every TripException row constructed anywhere in this codebase must route its
    review_status through this one function rather than hand-coding a value or relying
    on the column's server_default (which happens to also be RECORDED today) — a site
    that only works by matching the default is a site the next severity change breaks
    silently, with no import error or test failure to catch it.
    """
    return (
        ExceptionReviewStatus.NEEDS_REVIEW if severity == ExceptionSeverity.CRITICAL
        else ExceptionReviewStatus.RECORDED
    )


async def _resolve_phase_context(
    db: AsyncSession, *, trip_id: uuid.UUID, claimed_phase_event_id: uuid.UUID | None,
) -> PhaseEvent | None:
    """The phase this exception happened ON, decided once at creation and then frozen.

    A client-supplied id wins over server derivation deliberately. The driver app queues
    exceptions offline and flushes them when signal returns (driver-pwa
    lib/hooks/useOfflineQueue.ts), so a panic raised mid-transit can arrive here after
    the trip has already reached unloading — deriving at request time would tag it with
    the wrong phase, which is the exact drift this tagging exists to remove. The client
    knows where the driver WAS; this process only knows where the trip IS now.

    A claimed id belonging to some other trip is dropped and logged rather than
    rejected: the offline queue treats 4xx as terminal and discards the entry, so
    422-ing a stale client would silently lose the alert. Recording a panic with
    server-derived placement beats not recording it at all.
    """
    if claimed_phase_event_id is not None:
        result = await db.execute(
            select(PhaseEvent).where(
                PhaseEvent.id == claimed_phase_event_id,
                PhaseEvent.trip_id == trip_id,
            )
        )
        claimed = result.scalar_one_or_none()
        if claimed is not None:
            return claimed
        logger.warning(
            "Exception claimed phase_event_id=%s, which is not on trip=%s — ignoring the "
            "claim and falling back to server-derived phase context.",
            claimed_phase_event_id, trip_id,
        )

    return await current_phase_event(db, trip_id)


def pick_breakdown_vehicle(
    *, exception_type: ExceptionType, vehicle_type: VehicleType | None,
    trailer_id: uuid.UUID | None, horse_id: uuid.UUID,
    trip_trailer_ids: Sequence[uuid.UUID], trip_id: uuid.UUID,
) -> uuid.UUID | None:
    """The vehicle a driver-raised exception is recorded against, or None.

    The driver only answers "Truck or Trailer?" (vehicle_type), plus a trailer's plate
    (trailer_id) on a trip with two or more trailers. This works out the exact vehicle
    from the trip itself: its horse, or the trailers in trip_trailers. Doing it on the
    server is safe for a report flushed from the offline queue hours later, because
    trip_trailers is written only at trip creation and never changes afterwards.

    Never raises. A claim that doesn't fit the trip is dropped with a warning and the
    result is None. The driver app's offline queue treats any 4xx as final and discards
    the report, so rejecting it would lose a breakdown over its least important field
    (the same reasoning as _resolve_phase_context above). None counts for the horse in
    the analytics, so a warning here is the only trace of a trailer answer that couldn't
    be resolved.

    trip_id is used only to say which trip a warning is about.
    """
    if exception_type != ExceptionType.MECHANICAL:
        if vehicle_type is not None or trailer_id is not None:
            logger.warning(
                "Exception on trip=%s is %s, not mechanical, but carried vehicle_type=%s "
                "trailer_id=%s. Ignoring them: only a breakdown records a vehicle.",
                trip_id, exception_type.value, vehicle_type, trailer_id,
            )
        return None

    if vehicle_type is None:
        # An older app that doesn't ask the question.
        if trailer_id is not None:
            logger.warning(
                "Breakdown on trip=%s carried trailer_id=%s with no vehicle_type. "
                "Ignoring it and recording no vehicle.",
                trip_id, trailer_id,
            )
        return None

    if vehicle_type == VehicleType.HORSE:
        if trailer_id is not None:
            logger.warning(
                "Breakdown on trip=%s was reported against the truck but also carried "
                "trailer_id=%s. Ignoring the trailer_id.",
                trip_id, trailer_id,
            )
        return horse_id

    if not trip_trailer_ids:
        logger.warning(
            "Breakdown on trip=%s was reported against a trailer, but the trip has no "
            "trailers. Recording no vehicle.",
            trip_id,
        )
        return None

    if len(trip_trailer_ids) == 1:
        # "Trailer" alone already names it, so the app sends no plate here.
        only_trailer_id = trip_trailer_ids[0]
        if trailer_id is not None and trailer_id != only_trailer_id:
            logger.warning(
                "Breakdown on trip=%s named trailer_id=%s, but the trip's only trailer is "
                "%s. Recording the trip's trailer.",
                trip_id, trailer_id, only_trailer_id,
            )
        return only_trailer_id

    if trailer_id in trip_trailer_ids:
        return trailer_id
    logger.warning(
        "Breakdown on trip=%s was reported against a trailer, but trailer_id=%s is not one "
        "of the trip's %d trailers. Recording no vehicle.",
        trip_id, trailer_id, len(trip_trailer_ids),
    )
    return None


async def _resolve_breakdown_vehicle(
    db: AsyncSession, *, trip: Trip, exception_type: ExceptionType,
    vehicle_type: VehicleType | None, trailer_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """Load the trip's trailers and hand the decision to pick_breakdown_vehicle."""
    # A report carrying neither field always resolves to None. Skipping the query is
    # purely a saving, since that is every report from an older app and every
    # non-breakdown report from a new one.
    if vehicle_type is None and trailer_id is None:
        return None
    result = await db.execute(
        select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip.id)
    )
    return pick_breakdown_vehicle(
        exception_type=exception_type, vehicle_type=vehicle_type, trailer_id=trailer_id,
        horse_id=trip.horse_id, trip_trailer_ids=list(result.scalars().all()),
        trip_id=trip.id,
    )


async def _find_by_client_report_id(
    db: AsyncSession, *, trip_id: uuid.UUID, client_report_id: uuid.UUID,
) -> TripException | None:
    result = await db.execute(
        select(TripException).where(
            TripException.trip_id == trip_id,
            TripException.client_report_id == client_report_id,
        )
    )
    return result.scalar_one_or_none()


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
    phase_event_id: uuid.UUID | None = None,
    gps_lat: Decimal | None = None, gps_lng: Decimal | None = None,
    driver_captured_at: datetime | None = None,
    driver_accuracy_metres: float | None = None,
    client_report_id: uuid.UUID | None = None,
    vehicle_type: VehicleType | None = None, trailer_id: uuid.UUID | None = None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    driver_id isn't the trip's assigned driver (caller maps PermissionError to 403).

    vehicle_type/trailer_id are the driver's "truck or trailer" answer on a breakdown.
    The stored vehicle_id is worked out from the trip by pick_breakdown_vehicle, which
    never raises: an answer that doesn't fit the trip is stored as no vehicle.

    phase_event_id is where the driver was when this happened, as the client observed
    it — see _resolve_phase_context for why the claim is trusted and what happens when
    it is absent or foreign.

    gps_lat/gps_lng are the driver-phone fix captured by the panic page (spec: "Your
    GPS location will be included") — both-or-neither is already enforced by
    DriverExceptionCreateBody's validator before this is called, so no re-check here.

    client_report_id is the driver app's own stable id for this exact report (its
    offline queue's entry UUID) — see TripException.client_report_id. Replaying it on
    this trip returns the existing row untouched: no second insert, no second realtime
    event. Raises no error of its own; a foreign or malformed value simply behaves as
    if none were sent."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    # Evidence ownership, checked before anything is written: the FK alone only proves
    # the artifact exists SOMEWHERE, not that it belongs to THIS trip. Without this, a
    # driver (or a replayed/forged request) could cite another trip's photo — a seal
    # shot from a different delivery — as if it were this trip's own evidence, and it
    # would hash into this trip's record as though genuine. Raises before any
    # TripException row is built or any realtime event is queued, so a rejected claim
    # leaves no trace at all rather than a half-written exception.
    if supporting_artifact_id is not None:
        artifact_result = await db.execute(
            select(EvidenceArtifact.id).where(
                EvidenceArtifact.id == supporting_artifact_id,
                EvidenceArtifact.trip_id == trip_id,
            )
        )
        if artifact_result.scalar_one_or_none() is None:
            raise ResourceNotFoundError("EvidenceArtifact", str(supporting_artifact_id))

    # Idempotent replay, checked before the row is even built: a lost response, or a
    # retry the offline queue reuses the same client_report_id for, must return the
    # ORIGINAL exception rather than raise a second one for the same real-world report.
    # This pre-check is the common case (the earlier attempt already committed and this
    # process can see it); the race where two attempts land in the same instant is
    # handled below, after the insert, by the partial unique index.
    if client_report_id is not None:
        existing = await _find_by_client_report_id(
            db, trip_id=trip_id, client_report_id=client_report_id,
        )
        if existing is not None:
            return TripExceptionRead.model_validate(existing)

    phase_event = await _resolve_phase_context(
        db, trip_id=trip_id, claimed_phase_event_id=phase_event_id,
    )

    # After the replay return above, so a resent report keeps the vehicle it was first
    # stored with, even if the resend answers differently.
    vehicle_id = await _resolve_breakdown_vehicle(
        db, trip=trip, exception_type=exception_type,
        vehicle_type=vehicle_type, trailer_id=trailer_id,
    )

    # Bound before the row rather than inlined into it: the realtime event below must
    # carry the same severity the row is written with. While these were two separate
    # expressions the event did not carry one at all — every driver-raised exception
    # published as ordinary, so a PANIC_BUTTON (CRITICAL, _CRITICAL_TYPES above) reached
    # the dispatcher quieter than a system-detected parcel-count mismatch. Reading both
    # from one binding is what makes that unable to recur.
    severity = (
        ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES
        else ExceptionSeverity.WARNING
    )

    exc = TripException(
        trip_id=trip_id,
        phase_event_id=phase_event.id if phase_event is not None else None,
        # Scope to the stop that phase is anchored to, exactly as the system-detected
        # exceptions in phase_service already do (parcel/waybill count mismatches).
        # Nullable throughout: trip_creation carries no stop, and neither does an
        # exception on a trip with no plan.
        trip_stop_id=phase_event.trip_stop_id if phase_event is not None else None,
        exception_type=exception_type,
        source=ExceptionSource.DRIVER,
        severity=severity,
        review_status=initial_review_status(severity),
        description=description,
        supporting_artifact_id=supporting_artifact_id,
        client_report_id=client_report_id,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        vehicle_id=vehicle_id,
    )

    if client_report_id is None:
        db.add(exc)
        await db.flush()
    else:
        # The pre-check above closes the common case, but two replays of the same
        # queued entry (a driver's app retrying while an earlier attempt's response is
        # still in flight) can both pass it before either has inserted. The partial
        # unique index on (trip_id, client_report_id) lets exactly one of those two
        # inserts through; this savepoint is what lets the LOSING request recover
        # instead of dying with it.
        #
        # A bare `except IntegrityError` here would be wrong: Postgres aborts the
        # whole transaction the moment the flush fails, so the SELECT this branch
        # needs to run next (to find and return the winner) would itself fail with
        # "current transaction is aborted" — turning a race this code means to
        # tolerate into a 500. `db.begin_nested()` opens a SAVEPOINT around just the
        # insert, so only that savepoint rolls back on conflict and the outer
        # transaction — and this request's earlier reads, and its caller's eventual
        # commit — remain perfectly usable.
        try:
            async with db.begin_nested():
                db.add(exc)
                await db.flush()
        except IntegrityError as integrity_exc:
            if (
                not is_unique_violation(integrity_exc)
                or violated_constraint(integrity_exc) != _CLIENT_REPORT_ID_INDEX
            ):
                raise
            winner = await _find_by_client_report_id(
                db, trip_id=trip_id, client_report_id=client_report_id,
            )
            if winner is None:
                # The index fired on this exact (trip_id, client_report_id) pair, so a
                # row satisfying it must exist — unless the winning transaction rolled
                # back after committing the index entry but before this SELECT ran,
                # which the index's own guarantees make impossible. Re-raise rather
                # than silently return nothing to a caller expecting a created row.
                raise
            logger.info(
                "Exception replay lost the insert race, returning the winner: "
                "trip=%s client_report_id=%s", trip_id, client_report_id,
            )
            return TripExceptionRead.model_validate(winner)

    await db.refresh(exc)

    # Telemetry is enrichment, never a gate. The driver report has already been
    # inserted, and an unavailable/slow tracker produces an unverified snapshot on
    # this same row rather than a recursively-generated system exception.
    await _driver_report_assessment(
        db,
        trip=trip,
        exc=exc,
        driver_captured_at=driver_captured_at,
        driver_accuracy_metres=driver_accuracy_metres,
    )
    await db.refresh(exc)

    # Notify dispatchers watching this trip so the exception surfaces live (published on
    # commit, D9). A thin ping — the exception's GPS/description never crosses the channel.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(severity),
        ),
    )

    return TripExceptionRead.model_validate(exc)


def _read_with_trip(exc: TripException, trip: Trip) -> TripExceptionRead:
    """Serialise an exception with the reference of the trip it belongs to.

    The trip comes from the org-scoping join both callers already perform, so this adds
    no query. Without it every exception row on the dispatcher's queue would say only
    which UUID it belonged to, and both screens would fetch the whole trip list to turn
    that into something a human can act on.
    """
    return TripExceptionRead.model_validate(exc).model_copy(
        update={"trip_reference": trip.trip_reference},
    )


async def review_exception(
    db: AsyncSession,
    *,
    exception_id: uuid.UUID,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    review_note: str,
    review_outcome: DispatcherReviewOutcome,
    contact_method: ExceptionContactMethod | None,
) -> TripExceptionRead:
    """Record a dispatcher's immutable assessment of an exception.

    Reviewing is evidence handling, not trip lifecycle control. Active, closed and
    cancelled trips are all reviewable, and this function never changes Trip.status or
    any PhaseEvent.status. The outcome records what the dispatcher concluded; a nullable
    contact method records that evidence alone settled the assessment.

    **The server owns the reviewer and the clock.** `reviewed_by_user_id` comes from the
    token and `reviewed_at` from this process, never from the request body.

    Org scoping is authorisation, not a filter: the join to Trip means a dispatcher
    cannot review another operator's exception by guessing a UUID. A miss raises
    ResourceNotFoundError (→ 404) rather than a 403, because a 403 confirms the row
    exists to someone with no right to know it.

    The FIRST review is the evidence, always — overwriting it with a second assessment
    would rewrite the record of who established what, and when. What happens to the
    second call depends on WHO makes it:

    * **Same dispatcher** — idempotent. A double-tap and a replayed request both carry
      the same account, so the stored row comes back unchanged and nothing is lost.
    * **A different dispatcher** — ``ExceptionAlreadyReviewedError`` (→ 409). Their note,
      outcome and contact method are being discarded, and they may have established
      something the first reviewer did not. Returning 200 with a colleague's note would
      tell them their account was recorded when it was not.

    A row whose ``reviewed_by_user_id`` is NULL (reviewed before that column was
    captured) counts as a different dispatcher: we cannot prove otherwise.

    Raises:
        ResourceNotFoundError: no such exception in this organisation.
        ExceptionAlreadyReviewedError: another dispatcher reviewed it first.
    """
    # Joined rather than fetched separately: the org check and the load are one question
    # ("is there such an exception that this dispatcher may act on"), and splitting them
    # invites a later edit that answers only half of it.
    row = (await db.execute(
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            TripException.id == exception_id,
            Trip.operator_organization_id == organization_id,
        )
        # The lock, not the read, is what makes the conflict branch below true. Without it
        # two dispatchers pressing Review in the same instant both read an open status,
        # both take the unreviewed path, and both are told their account is the record —
        # while the second UPDATE quietly waits for the first to commit and then overwrites
        # its reviewer, note, outcome, contact method and timestamp. The first review would
        # be gone and neither dispatcher would ever know, which is the one outcome this
        # function exists to prevent. Scoped with `of=` so the joined trip row stays free:
        # locking it would block every unrelated write on that trip for the length of
        # this transaction.
        .with_for_update(of=TripException)
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripException", str(exception_id))
    exc, trip = row

    if exc.review_status == ExceptionReviewStatus.REVIEWED:
        # Same dispatcher: a double-tap, or a request the client retried. Their account
        # is already the record, so there is nothing to lose and nothing to report —
        # return the stored row exactly as before.
        if exc.reviewed_by_user_id == user_id:
            logger.info(
                "Review replayed by the same user: exception=%s org=%s",
                exception_id, organization_id,
            )
            return _read_with_trip(exc, trip)
        # A different dispatcher got there first — or the row predates reviewer capture
        # (NULL), where we cannot prove it was this caller and must not assume it. Either
        # way this call's assessment is about to be dropped, and the caller has to be
        # told: they may have established something the first reviewer did not.
        logger.info(
            "Review conflicted, already reviewed by another user: exception=%s org=%s "
            "first_reviewer=%s caller=%s",
            exception_id, organization_id, exc.reviewed_by_user_id, user_id,
        )
        raise ExceptionAlreadyReviewedError(str(exception_id))

    exc.review_status = ExceptionReviewStatus.REVIEWED
    # Explicit conversion keeps the request-only enum (which intentionally excludes
    # LEGACY_REVIEW) out of the persisted model while preserving the shared value.
    exc.review_outcome = ExceptionReviewOutcome(review_outcome.value)
    exc.reviewed_by_user_id = user_id
    exc.reviewed_at = datetime.now(UTC)
    exc.review_note = review_note
    exc.contact_method = contact_method
    await db.flush()
    await db.refresh(exc)

    # Metadata only. review_note is free text a dispatcher typed about a person and
    # about a live incident; it belongs in the record, never in the log.
    logger.info(
        "Exception reviewed: exception=%s trip=%s by=%s outcome=%s contact=%s",
        exception_id, exc.trip_id, user_id, review_outcome.value,
        contact_method.value if contact_method is not None else None,
    )

    # Other dispatchers in the org are looking at the same list. INFO severity: a
    # review is progress, not an alarm — it must refresh a screen without
    # interrupting whoever is working through the queue.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=exc.trip_id, kind=RealtimeKind.EXCEPTION_REVIEWED,
            severity=event_severity(ExceptionSeverity.INFO),
        ),
    )

    return _read_with_trip(exc, trip)


# Recorded/reviewed only — never needs_review. Named once rather than inlined into
# list_exception_history so get_exception_detail's own note about the queue/history
# split can point at one place, and so the two review states forming "history" cannot
# quietly drift apart from the review-queue's own filter below.
_HISTORY_REVIEW_STATUSES = (ExceptionReviewStatus.RECORDED, ExceptionReviewStatus.REVIEWED)


def _to_list_item(
    exc: TripException, trip: Trip, phase_type: str | None, stop_sequence: int | None,
) -> TripExceptionListItem:
    """Build the compact list row from one (exception, trip, phase_type, stop_sequence)
    tuple — the shape every 4-column join in this module selects.

    Not `TripExceptionListItem.model_validate(exc)`: the trip reference/status and the
    phase/stop labels live on the joined Trip/PhaseEvent/TripStop rows, not on
    TripException itself. Raw values are passed straight through rather than
    `.value`'d — `exc.exception_type`, `trip.status`, `phase_type` all come back from
    the database as plain `str` (see this module's DB-backed enum columns), and Pydantic
    coerces them into their declared enum types on construction; `.value`'ing an
    already-plain string raises AttributeError.
    """
    return TripExceptionListItem(
        id=exc.id,
        exception_type=exc.exception_type,
        source=exc.source,
        severity=exc.severity,
        review_status=exc.review_status,
        description=exc.description,
        created_at=exc.created_at,
        trip_id=exc.trip_id,
        trip_reference=trip.trip_reference,
        trip_status=trip.status,
        phase_label=phase_type,
        stop_label=stop_sequence,
    )


def _exception_read_query():
    """The 4-column join every read function in this module selects from: the exception
    and its trip (for org scoping and the trip reference/status), plus the phase type
    and stop sequence the exception is scoped to, if any.

    Only the two scalar columns are pulled off PhaseEvent/TripStop, not the full
    entities — nothing here needs more of either row, and selecting whole entities
    would make the outer joins load columns no caller reads.
    """
    return (
        select(TripException, Trip, PhaseEvent.phase_type, TripStop.sequence)
        .join(Trip, Trip.id == TripException.trip_id)
        .outerjoin(PhaseEvent, PhaseEvent.id == TripException.phase_event_id)
        .outerjoin(TripStop, TripStop.id == TripException.trip_stop_id)
    )


async def list_review_queue(
    db: AsyncSession, *, organization_id: uuid.UUID,
) -> list[TripExceptionListItem]:
    """Every needs_review exception in the organisation, newest first.

    Deliberately unpaginated — see the endpoint's own docstring (api/v1/endpoints/
    exceptions.py) for why: this is a bounded human-work queue, not a full history, and
    hiding a large critical backlog behind pages would be unsafe.
    """
    stmt = (
        _exception_read_query()
        .where(
            Trip.operator_organization_id == organization_id,
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
        .order_by(TripException.created_at.desc(), TripException.id.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [_to_list_item(exc, trip, phase_type, stop_sequence) for exc, trip, phase_type, stop_sequence in rows]


async def list_exception_history(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    limit: int = 25,
    cursor: str | None = None,
    q: str | None = None,
    review_status: ExceptionReviewStatus | None = None,
    severity: ExceptionSeverity | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> CursorPage[TripExceptionListItem]:
    """Recorded/reviewed exceptions (never needs_review — that's the review queue's own
    job), newest first, cursor-paginated on (created_at, id).

    Raises ValueError (propagated from decode_cursor, uncaught here) for a malformed
    cursor — the caller maps that to a 422. Decoded before either query below runs, so
    a bad cursor fails before any work is done on its behalf.

    from_date/to_date are SA (UTC+settings.OPERATIONS_UTC_OFFSET_HOURS) calendar dates,
    both inclusive — see phase_service.operating_day for the inverse conversion this
    mirrors. The exclusive upper bound (start of the day AFTER to_date, in SA time) is
    what makes to_date read as inclusive rather than as a UTC midnight cutoff that would
    silently exclude the tail of that SA day.
    """
    cursor_position = decode_cursor(cursor) if cursor is not None else None

    filters = [
        Trip.operator_organization_id == organization_id,
        TripException.review_status.in_(_HISTORY_REVIEW_STATUSES),
    ]
    if q is not None:
        filters.append(or_(
            Trip.trip_reference.icontains(q, autoescape=True),
            TripException.description.icontains(q, autoescape=True),
        ))
    if review_status is not None:
        # ANDed with the base recorded/reviewed filter above rather than replacing it —
        # a caller passing needs_review legitimately gets zero rows, which is correct
        # and must not be special-cased or rejected.
        filters.append(TripException.review_status == review_status)
    if severity is not None:
        filters.append(TripException.severity == severity)
    if from_date is not None or to_date is not None:
        sa_tz = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
        if from_date is not None:
            filters.append(TripException.created_at >= datetime.combine(from_date, time.min, tzinfo=sa_tz))
        # date.max has no representable day-after boundary. Omitting the upper
        # predicate in that one case preserves inclusive semantics because no
        # Python/driver timestamp can fall beyond the maximum calendar date.
        if to_date is not None and to_date < date.max:
            filters.append(
                TripException.created_at < datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=sa_tz)
            )

    # Same filter set as the page query below, applied independently rather than
    # derived from it — total_items must reflect every matching row regardless of
    # limit/cursor, which a query already sliced by LIMIT/keyset cannot answer.
    count_stmt = (
        select(func.count())
        .select_from(TripException)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(*filters)
    )
    total_items = (await db.execute(count_stmt)).scalar_one()

    page_stmt = (
        _exception_read_query()
        .where(*filters)
        .order_by(TripException.created_at.desc(), TripException.id.desc())
        .limit(limit + 1)
    )
    if cursor_position is not None:
        # A tuple comparison, not two ANDed column comparisons: the latter cannot
        # correctly express "strictly below this point in a (created_at, id) ordering"
        # and would duplicate or skip rows across a page boundary whenever two rows
        # share a created_at value (see _HISTORY_REVIEW_STATUSES's neighbour
        # test_history_pagination_has_no_duplicates_or_omissions_with_tied_timestamps).
        page_stmt = page_stmt.where(
            tuple_(TripException.created_at, TripException.id)
            < tuple_(literal(cursor_position.created_at), literal(cursor_position.id))
        )

    rows = (await db.execute(page_stmt)).all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]

    items = [_to_list_item(exc, trip, phase_type, stop_sequence) for exc, trip, phase_type, stop_sequence in page_rows]

    next_cursor: str | None = None
    if has_more:
        last_exc = page_rows[-1][0]
        next_cursor = encode_cursor(CursorPosition(created_at=last_exc.created_at, id=last_exc.id))

    return CursorPage[TripExceptionListItem](items=items, next_cursor=next_cursor, total_items=total_items)


async def get_exception_detail(
    db: AsyncSession, *, exception_id: uuid.UUID, organization_id: uuid.UUID,
) -> TripExceptionDetail:
    """One exception, any review state, any trip lifecycle — a permalink target.

    Org-scoped by the same Trip join review_exception uses. Raises
    ResourceNotFoundError (-> 404, not 403) for a missing or cross-organisation id — a
    403 would confirm the row exists to a dispatcher with no right to know that.
    """
    row = (await db.execute(
        _exception_read_query().where(
            TripException.id == exception_id,
            Trip.operator_organization_id == organization_id,
        )
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripException", str(exception_id))
    exc, trip, phase_type, stop_sequence = row

    # Never trust supporting_artifact_id on its own — get_trip_scoped_artifact
    # re-checks ownership at read time exactly as raise_exception's own comment on
    # this same invariant explains: the FK alone only proves the artifact exists
    # SOMEWHERE, not that it belongs to THIS trip.
    supporting_artifact = None
    if exc.supporting_artifact_id is not None:
        supporting_artifact = await get_trip_scoped_artifact(
            db, artifact_id=exc.supporting_artifact_id, trip_id=exc.trip_id,
        )

    # Looked up only for a breakdown that recorded its vehicle. Scoped to the
    # organisation, the same as the analytics vehicle names. The id always comes from
    # this trip's own horse or trailers, so a miss means the vehicle row is gone. The
    # id is still returned, with no registration, rather than hidden.
    vehicle_registration: str | None = None
    vehicle_type: VehicleType | None = None
    if exc.vehicle_id is not None:
        vehicle_row = (await db.execute(
            select(Vehicle.registration, Vehicle.vehicle_type).where(
                Vehicle.id == exc.vehicle_id,
                Vehicle.organization_id == organization_id,
            )
        )).one_or_none()
        if vehicle_row is not None:
            vehicle_registration, vehicle_type = vehicle_row

    list_item = _to_list_item(exc, trip, phase_type, stop_sequence)
    return TripExceptionDetail(
        **list_item.model_dump(),
        gps_lat=exc.gps_lat,
        gps_lng=exc.gps_lng,
        review_outcome=exc.review_outcome,
        reviewed_by_user_id=exc.reviewed_by_user_id,
        reviewed_at=exc.reviewed_at,
        review_note=exc.review_note,
        contact_method=exc.contact_method,
        trip_closed_at=trip.closed_at,
        vehicle_id=exc.vehicle_id,
        vehicle_registration=vehicle_registration,
        vehicle_type=vehicle_type,
        supporting_artifact_id=exc.supporting_artifact_id,
        supporting_artifact=supporting_artifact,
    )
