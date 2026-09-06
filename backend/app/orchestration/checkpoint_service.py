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

    # horse_gps_lat/lng are deliberately NOT read from the payload any more.
    #
    # They used to be, and that made the column worthless as evidence: the driver's
    # phone reported its own position AND asserted where the truck was, so a single
    # source wore two hats and the "cross-reference" compared a claim against itself.
    # The tracker reading taken below supersedes anything the client sends, which is
    # the only thing that makes this an independent second source (FP-143).
    #
    # The fields stay on DriverCheckpointCreateBody rather than being deleted, for
    # the same reason LoadingCompleteRequest.driver_visual_count does: an entry
    # queued offline under the old schema replays from the driver app's localStorage
    # with them populated, and a removed field would 422 that entry forever — the
    # queue would never drain. They are accepted and ignored. Delete only once no
    # client can still be holding one.
    checkpoint = Checkpoint(
        trip_id=trip_id,
        checkpoint_type=payload.checkpoint_type,
        driver_phone_lat=payload.driver_phone_lat,
        driver_phone_lng=payload.driver_phone_lng,
        selfie_artifact_id=payload.selfie_artifact_id,
        cargo_photo_artifact_id=payload.cargo_photo_artifact_id,
        note=payload.note,
        is_deviation=payload.is_deviation,
    )
    db.add(checkpoint)
    # Flushed before corroboration so the row has its id — the corroboration log
    # lines identify the checkpoint they belong to, and a null id there would make
    # a Pulsit outage untraceable to the checkpoint it affected.
    await db.flush()

    # Never raises: a driver logging a roadside checkpoint must not be blocked by an
    # unreachable tracker API. A failure leaves horse_gps null, which means "we could
    # not check" — see corroboration_service's null-semantics contract.
    await record_checkpoint_corroboration(db, trip=trip, checkpoint=checkpoint)

    await db.flush()
    await db.refresh(checkpoint)
    return CheckpointRead.model_validate(checkpoint)
