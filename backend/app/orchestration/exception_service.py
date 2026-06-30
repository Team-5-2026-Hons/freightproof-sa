"""Driver-raised exceptions — panic button and ad-hoc 'report exception'."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.trips import Trip
from app.db.models.transit import TripException
from app.schemas.transit import TripExceptionRead

# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep these two in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    driver_id isn't the trip's assigned driver (caller maps PermissionError to 403)."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    exc = TripException(
        trip_id=trip_id,
        exception_type=exception_type,
        source=ExceptionSource.DRIVER,
        severity=ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES else ExceptionSeverity.WARNING,
        description=description,
        supporting_artifact_id=supporting_artifact_id,
    )
    db.add(exc)
    await db.flush()
    await db.refresh(exc)
    return TripExceptionRead.model_validate(exc)
