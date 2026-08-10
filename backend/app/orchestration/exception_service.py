"""Driver-raised exceptions — panic button and ad-hoc 'report exception'."""

import logging
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.db.models.transit import TripException
from app.orchestration.phase_service import current_phase_event
from app.schemas.transit import TripExceptionRead

logger = logging.getLogger(__name__)

# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep these two in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


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


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
    phase_event_id: uuid.UUID | None = None,
    gps_lat: Decimal | None = None, gps_lng: Decimal | None = None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    driver_id isn't the trip's assigned driver (caller maps PermissionError to 403).

    phase_event_id is where the driver was when this happened, as the client observed
    it — see _resolve_phase_context for why the claim is trusted and what happens when
    it is absent or foreign.

    gps_lat/gps_lng are the driver-phone fix captured by the panic page (spec: "Your
    GPS location will be included") — both-or-neither is already enforced by
    DriverExceptionCreateBody's validator before this is called, so no re-check here."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    phase_event = await _resolve_phase_context(
        db, trip_id=trip_id, claimed_phase_event_id=phase_event_id,
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
        severity=ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES else ExceptionSeverity.WARNING,
        description=description,
        supporting_artifact_id=supporting_artifact_id,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
    )
    db.add(exc)
    await db.flush()
    await db.refresh(exc)

    # Notify dispatchers watching this trip so the exception surfaces live (published on
    # commit, D9). A thin ping — the exception's GPS/description never crosses the channel.
    enqueue_event(db, trip.operator_organization_id, TripEvent(id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED))

    return TripExceptionRead.model_validate(exc)
