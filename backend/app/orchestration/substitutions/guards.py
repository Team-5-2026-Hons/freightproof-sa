"""Loading and checks every substitution action shares: lock the trip and the request in the
feature-wide order (see service), and refuse an action the request's state or the trip's status
does not allow.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundError, SubstitutionNotPendingError, SubstitutionsDisabledError, SubstitutionVersionChangedError,
    TripStateError,
)
from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.enums import DispatcherRole, TripStatus
from app.db.models.trips import Trip
from app.orchestration.substitutions.access import lock_trip_statement
from app.orchestration.substitutions.request_read import Viewer, trip_vehicle_ids
from app.orchestration.trips.availability import LIVE_STATUSES, lock_crew_set
from app.schemas.driver_substitutions import SubstitutionState
from app.schemas.people import UserRead


async def lock_org_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    """Lock the trip, provided it belongs to the dispatcher's organisation (404 otherwise, so a
    foreign trip's existence is not disclosed)."""
    trip = (await db.execute(
        lock_trip_statement(select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id))
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_request(db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID) -> DriverSubstitutionRequest:
    """The request row, locked, provided it belongs to this trip."""
    request = (await db.execute(
        select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip_id)
        .with_for_update(key_share=True)
    )).scalar_one_or_none()
    if request is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    return request


def require_pending_at(request: DriverSubstitutionRequest, expected_version: int) -> None:
    if request.state != SubstitutionState.PENDING.value:
        raise SubstitutionNotPendingError(request_id=request.id, current_version=request.version)
    if request.version != expected_version:
        raise SubstitutionVersionChangedError(request_id=request.id, current_version=request.version)


def require_new_arrangements_enabled() -> None:
    """The DRIVER_SUBSTITUTIONS_ENABLED gate. Only new arrangements and replacements: called after
    the exact-replay check, so an already accepted arrangement still returns its result, and never
    on confirm/complete/cancel/correct, which must keep working while the flag is off."""
    if not settings.DRIVER_SUBSTITUTIONS_ENABLED:
        raise SubstitutionsDisabledError()


def require_live(trip: Trip, *, action: str) -> None:
    if TripStatus(trip.status) not in LIVE_STATUSES:
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action=action)


def viewer_for(actor: UserRead) -> Viewer:
    return Viewer(is_dispatcher=True, is_admin=actor.role is DispatcherRole.ADMIN_DISPATCHER)


async def lock_crew_and_request(db: AsyncSession, *, trip: Trip, request_id: uuid.UUID) -> DriverSubstitutionRequest:
    """Take the crew locks then the request lock, after the caller's trip lock.

    The driver ids are read without a lock first (they never change on a request), because the
    feature-wide order puts the crew before the request.
    """
    peek = (await db.execute(
        select(DriverSubstitutionRequest.outgoing_driver_id, DriverSubstitutionRequest.incoming_driver_id)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip.id)
    )).one_or_none()
    if peek is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    await lock_crew_set(db, driver_ids=[peek.outgoing_driver_id, peek.incoming_driver_id], vehicle_ids=await trip_vehicle_ids(db, trip))
    return await _load_request(db, trip_id=trip.id, request_id=request_id)
