"""Trip exceptions raised by the driver: the report itself, its phase and location context, and the
breakdown vehicle it names. Dispatcher review lives in `exceptions.review`."""

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
from app.core.exceptions import IdempotencyKeyReusedError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.errors import DatabaseUnavailableError
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType, VehicleType
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripTrailer
from app.db.models.transit import TripException
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration.evidence import location_assessment
from app.orchestration.evidence_anchors.artifacts import (
    resolve_photo_ids, validate_trip_artifacts,
)
from app.orchestration.evidence_anchors.reads import build_exception_read
from app.orchestration.evidence_anchors.recording import anchor_new_report
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.substitutions.access import WriteClaim, authorise_driver_write
from app.orchestration.phases.queries import current_phase_event
from app.orchestration.exceptions.review_policy import initial_review_status
from app.schemas.transit import TripExceptionRead

logger = logging.getLogger(__name__)


_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


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

    The report row is the evidence and is already in the session; this
    is enrichment, bounded to one tracker read of at most
    _DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS, and optional failures — Pulsit, the vehicle
    lookup, assessment validation — are logged and leave `action_location_assessment`
    NULL ("not assessed"). A panic report must never be rolled back because the
    comparison bolted onto it could not be built. DB outages still propagate because
    the transaction cannot persist the report either.
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

        assessment = location_assessment.build_capture_assessment(
            driver_lat=float(exc.gps_lat) if exc.gps_lat is not None else None,
            driver_lng=float(exc.gps_lng) if exc.gps_lng is not None else None,
            driver_captured_at=driver_captured_at,
            driver_accuracy_metres=driver_accuracy_metres,
            horse_fix=horse_fix,
            evaluated_at=datetime.now(UTC),
        )
        exc.action_location_assessment = assessment.model_dump(mode="json")
        await db.flush()
    except DatabaseUnavailableError:
        raise
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


async def _find_own_report(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, client_report_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """This driver's own accepted report for the queued entry's id, if any (key AND actor)."""
    if client_report_id is None:
        return None
    return (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id, TripException.client_report_id == client_report_id,
            TripException.performed_by_driver_id == driver_id,
        )
    )).scalar_one_or_none()


async def _insert_report_or_load_winner(
    db: AsyncSession, *, exc: TripException, trip_id: uuid.UUID,
    client_report_id: uuid.UUID | None,
) -> TripException | None:
    """A losing replay returns its existing row without repeating enrichment or anchors."""
    if client_report_id is None:
        db.add(exc)
        await db.flush()
    else:
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
                raise
            logger.info(
                "Exception replay lost the insert race, returning the winner: "
                "trip=%s client_report_id=%s", trip_id, client_report_id,
            )
            return winner

    return None


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
    supporting_artifact_ids: Sequence[uuid.UUID] | None = None,
    phase_event_id: uuid.UUID | None = None,
    gps_lat: Decimal | None = None, gps_lng: Decimal | None = None,
    driver_captured_at: datetime | None = None,
    driver_accuracy_metres: float | None = None,
    client_report_id: uuid.UUID | None = None,
    vehicle_type: VehicleType | None = None, trailer_id: uuid.UUID | None = None,
    custody_sequence: int | None = None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist or driver_id never held it, and a
    CustodyAccessError (mapped to 409 with the contract's code) if they held it earlier or the
    report belongs to another custody period.

    vehicle_type/trailer_id are the driver's "truck or trailer" answer on a
    breakdown; pick_breakdown_vehicle resolves the actual vehicle_id and never
    raises. phase_event_id is where the driver was, as the client observed it —
    see _resolve_phase_context. gps_lat/gps_lng are both-or-neither, already
    enforced by DriverExceptionCreateBody's validator.

    client_report_id is the driver app's offline-queue entry UUID. Replaying it
    on this trip returns the existing row untouched — no second insert, no
    second realtime event. A foreign or malformed value behaves as if none were sent.
    """
    trip, custody = await authorise_driver_write(
        db, trip_id=trip_id, driver_id=driver_id,
        claim=WriteClaim(custody_sequence, lambda: _find_own_report(
            db, trip_id=trip_id, driver_id=driver_id, client_report_id=client_report_id,
        )),
    )

    if client_report_id is not None:
        existing = await _find_by_client_report_id(
            db, trip_id=trip_id, client_report_id=client_report_id,
        )
        if existing is not None:
            if custody.sequence > 0 and existing.performed_by_driver_id != driver_id:
                raise IdempotencyKeyReusedError()
            return await build_exception_read(db, existing)

    photo_ids = resolve_photo_ids(supporting_artifact_id, supporting_artifact_ids)
    await validate_trip_artifacts(db, trip_id=trip_id, artifact_ids=photo_ids)

    phase_event = await _resolve_phase_context(
        db, trip_id=trip_id, claimed_phase_event_id=phase_event_id,
    )

    vehicle_id = await _resolve_breakdown_vehicle(
        db, trip=trip, exception_type=exception_type,
        vehicle_type=vehicle_type, trailer_id=trailer_id,
    )

    severity = (
        ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES
        else ExceptionSeverity.WARNING
    )

    exc = TripException(
        trip_id=trip_id,
        phase_event_id=phase_event.id if phase_event is not None else None,
        trip_stop_id=phase_event.trip_stop_id if phase_event is not None else None,
        exception_type=exception_type,
        source=ExceptionSource.DRIVER,
        severity=severity,
        review_status=initial_review_status(severity),
        description=description,
        supporting_artifact_id=photo_ids[0] if photo_ids else None,
        client_report_id=client_report_id,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        vehicle_id=vehicle_id,
        performed_by_driver_id=driver_id,
        custody_sequence=custody.sequence,
    )

    winner = await _insert_report_or_load_winner(
        db, exc=exc, trip_id=trip_id, client_report_id=client_report_id,
    )
    if winner is not None:
        return await build_exception_read(db, winner)

    await db.refresh(exc)

    await anchor_new_report(db, exc, photo_ids=photo_ids)

    await _driver_report_assessment(
        db,
        trip=trip,
        exc=exc,
        driver_captured_at=driver_captured_at,
        driver_accuracy_metres=driver_accuracy_metres,
    )
    await db.refresh(exc)

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(severity),
        ),
    )

    return await build_exception_read(db, exc)
