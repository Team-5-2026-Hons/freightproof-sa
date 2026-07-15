"""Organisation-scoped visibility check for blockchain subjects.

Raises SubjectNotVisibleError — endpoint layer translates this to HTTP 404
so no information about other orgs is leaked.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import SubjectType
from app.db.models.events import DriverEvent, VehicleEvent
from app.db.models.handshakes import HandshakeEvent
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle


async def assert_subject_visible(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> None:
    """Raise SubjectNotVisibleError if subject is outside the caller's organisation."""
    if subject_type == SubjectType.TRIP:
        query = select(Trip.id).where(
            Trip.id == subject_id,
            Trip.operator_organization_id == organization_id,
        )
    elif subject_type == SubjectType.VEHICLE:
        query = select(Vehicle.id).where(
            Vehicle.id == subject_id,
            Vehicle.organization_id == organization_id,
        )
    elif subject_type == SubjectType.DRIVER:
        query = select(Driver.id).where(
            Driver.id == subject_id,
            Driver.organization_id == organization_id,
        )
    elif subject_type == SubjectType.VEHICLE_EVENT:
        query = (
            select(VehicleEvent.id)
            .join(Vehicle, Vehicle.id == VehicleEvent.vehicle_id)
            .where(
                VehicleEvent.id == subject_id,
                Vehicle.organization_id == organization_id,
            )
        )
    elif subject_type == SubjectType.DRIVER_EVENT:
        query = (
            select(DriverEvent.id)
            .join(Driver, Driver.id == DriverEvent.driver_id)
            .where(
                DriverEvent.id == subject_id,
                Driver.organization_id == organization_id,
            )
        )
    elif subject_type == SubjectType.HANDSHAKE_EVENT:
        # H2/H5 anchor receipts with the handshake event as subject — scoped to
        # the org operating the trip the handshake belongs to.
        query = (
            select(HandshakeEvent.id)
            .join(Trip, Trip.id == HandshakeEvent.trip_id)
            .where(
                HandshakeEvent.id == subject_id,
                Trip.operator_organization_id == organization_id,
            )
        )
    else:
        raise SubjectNotVisibleError(str(subject_type), str(subject_id))

    result = await db.execute(query.limit(1))
    if result.scalar_one_or_none() is None:
        raise SubjectNotVisibleError(str(subject_type), str(subject_id))
