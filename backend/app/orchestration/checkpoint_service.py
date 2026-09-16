"""Driver-logged in-transit checkpoints."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Trip
from app.db.models.transit import Checkpoint
from app.orchestration.corroboration_service import record_checkpoint_corroboration
from app.schemas.transit import CheckpointRead, DriverCheckpointCreateBody


async def log_checkpoint(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: DriverCheckpointCreateBody,
) -> CheckpointRead:
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    # horse_gps_lat/lng are deliberately NOT read from the payload: the tracker
    # reading taken below supersedes anything the client sends, which is the only
    # thing that makes this an independent second source (FP-143). The payload
    # fields stay accepted-and-ignored so an offline-queued entry from an older
    # client build doesn't 422 forever.
    checkpoint = Checkpoint(
        trip_id=trip_id,
        checkpoint_type=payload.checkpoint_type,
        driver_phone_lat=payload.driver_phone_lat,
        driver_phone_lng=payload.driver_phone_lng,
        # Stored unconditionally, never gated by whether the horse position below
        # ends up timely enough to keep.
        driver_captured_at=payload.driver_captured_at,
        selfie_artifact_id=payload.selfie_artifact_id,
        cargo_photo_artifact_id=payload.cargo_photo_artifact_id,
        note=payload.note,
        is_deviation=payload.is_deviation,
    )
    db.add(checkpoint)
    # Flushed before corroboration so the row has an id for the corroboration log lines.
    await db.flush()

    # Never raises: a driver logging a roadside checkpoint must not be blocked by an
    # unreachable tracker API. A failure leaves horse_gps null ("could not check").
    await record_checkpoint_corroboration(
        db, trip=trip, checkpoint=checkpoint, driver_captured_at=payload.driver_captured_at,
    )

    await db.flush()
    await db.refresh(checkpoint)
    return CheckpointRead.model_validate(checkpoint)
