"""Trip exceptions — the driver raising one, and the dispatcher reviewing it."""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, VehicleType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripTrailer
from app.db.models.transit import TripException
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration.evidence import action_location
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.phases.queries import current_phase_event
from app.orchestration.review_policy import initial_review_status
from app.schemas.transit import TripExceptionRead

logger = logging.getLogger(__name__)


# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


# Name of the partial unique index on (trip_id, client_report_id), matched against
# violated_constraint() below so an unrelated unique-violation is never misread as a replay.
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
    """Attach one optional capture-time comparison to an already-flushed driver report.

    NEVER raises. The report row is the evidence and is already in the session; this
    is enrichment, bounded to one tracker read of at most
    _DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS, and ANY failure — Pulsit, the vehicle
    lookup, assessment validation — is logged and leaves `action_location_assessment`
    NULL ("not assessed"). A panic report must never be rolled back because the
    comparison bolted onto it could not be built.
    """
    try:
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

        # The report row IS the capture: its own gps_lat/gps_lng and the device
        # timestamp the client sent, compared once against the tracker. Never stored
        # as a checkpoint and never turned into a second, system-generated exception.
        assessment = action_location.build_capture_assessment(
            driver_lat=float(exc.gps_lat) if exc.gps_lat is not None else None,
            driver_lng=float(exc.gps_lng) if exc.gps_lng is not None else None,
            driver_captured_at=driver_captured_at,
            driver_accuracy_metres=driver_accuracy_metres,
            horse_fix=horse_fix,
            evaluated_at=datetime.now(UTC),
        )
        exc.action_location_assessment = assessment.model_dump(mode="json")
        await db.flush()
    except Exception:
        logger.exception(
            "Driver-report location assessment failed for trip=%s exception=%s — report "
            "persists without it", trip.id, exc.id,
        )


async def _resolve_phase_context(
    db: AsyncSession, *, trip_id: uuid.UUID, claimed_phase_event_id: uuid.UUID | None,
) -> PhaseEvent | None:
    """The phase this exception happened ON, decided once at creation and then frozen.

    A client-supplied id wins over server derivation: the driver app queues
    exceptions offline, so a panic raised mid-transit can arrive after the trip
    has already reached unloading — deriving at request time would tag it wrong.
    The client knows where the driver WAS; this process only knows where the
    trip IS now.

    A claimed id belonging to some other trip is dropped and logged, not
    rejected: the offline queue treats 4xx as terminal and discards the entry,
    so 422-ing a stale client would silently lose the alert.
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

    The driver only answers "Truck or Trailer?" (vehicle_type), plus a trailer's
    plate on a multi-trailer trip. Resolving on the server is safe for a report
    flushed hours later, since trip_trailers never changes after trip creation.

    Never raises: a claim that doesn't fit the trip is dropped with a warning and
    the result is None, for the same reason as _resolve_phase_context — the
    offline queue discards any 4xx, so rejecting would lose the whole breakdown
    over its least important field.
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
    # A report carrying neither field always resolves to None; skip the query.
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

    vehicle_type/trailer_id are the driver's "truck or trailer" answer on a
    breakdown; pick_breakdown_vehicle resolves the actual vehicle_id and never
    raises. phase_event_id is where the driver was, as the client observed it —
    see _resolve_phase_context. gps_lat/gps_lng are both-or-neither, already
    enforced by DriverExceptionCreateBody's validator.

    client_report_id is the driver app's offline-queue entry UUID. Replaying it
    on this trip returns the existing row untouched — no second insert, no
    second realtime event. A foreign or malformed value behaves as if none were sent.
    """
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    # Evidence ownership, checked before anything is written: the FK alone only
    # proves the artifact exists SOMEWHERE, not that it belongs to THIS trip.
    # Raises before any TripException row is built, so a rejected claim leaves no trace.
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
        # exceptions in orchestration/phases already do (parcel/waybill count mismatches).
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

    # Notify dispatchers watching this trip so the exception surfaces live (published
    # after commit). A thin ping — the exception's GPS/description never crosses the channel.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(severity),
        ),
    )

    return TripExceptionRead.model_validate(exc)
