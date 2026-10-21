"""Checks every incident write makes before touching the ledger: that cited evidence belongs to
the incident's own trip, that an owner is a colleague, and that an exception is not already
under another investigation. Each raises a domain error the endpoint maps to an HTTP status.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExceptionAlreadyInIncidentError, IncidentInvalidError
from app.db.models.incidents import IncidentException
from app.db.models.people import User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel


async def assert_exceptions_on_trip(db: AsyncSession, *, trip_id: uuid.UUID, exception_ids: Sequence[uuid.UUID]) -> None:
    """Citing another trip's exception would put it in the wrong trip's evidence pack."""
    if not exception_ids:
        return
    found = set((await db.execute(
        select(TripException.id).where(TripException.id.in_(exception_ids), TripException.trip_id == trip_id)
    )).scalars().all())
    missing = [str(i) for i in exception_ids if i not in found]
    if missing:
        raise IncidentInvalidError(f"Exceptions not on this trip: {', '.join(missing)}.")


async def assert_exceptions_unlinked(db: AsyncSession, *, exception_ids: Sequence[uuid.UUID]) -> None:
    """One observation belongs to one investigation. The unique constraint enforces it too;
    checking first names the incident that already has it, so the dispatcher can go there."""
    if not exception_ids:
        return
    taken = (await db.execute(
        select(IncidentException.exception_id, IncidentException.incident_id)
        .where(IncidentException.exception_id.in_(exception_ids))
    )).tuples().first()
    if taken is not None:
        raise ExceptionAlreadyInIncidentError(exception_id=taken[0], incident_id=taken[1])


def _trip_parcels(trip_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    return select(Parcel.id).join(Consignment, Consignment.id == Parcel.consignment_id).where(Consignment.trip_id == trip_id)


async def trip_parcel_ids(db: AsyncSession, *, trip_id: uuid.UUID) -> list[uuid.UUID]:
    """Every parcel on the trip's consignments — a hijacking takes the whole load."""
    return list((await db.execute(_trip_parcels(trip_id).order_by(Parcel.barcode))).scalars().all())


async def assert_parcels_on_trip(db: AsyncSession, *, trip_id: uuid.UUID, parcel_ids: Sequence[uuid.UUID]) -> None:
    if not parcel_ids:
        return
    found = set((await db.execute(_trip_parcels(trip_id).where(Parcel.id.in_(parcel_ids)))).scalars().all())
    missing = [str(i) for i in parcel_ids if i not in found]
    if missing:
        raise IncidentInvalidError(f"Parcels not on this trip: {', '.join(missing)}.")


async def assert_phase_on_trip(db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID | None) -> None:
    if phase_event_id is None:
        return
    found = (await db.execute(
        select(PhaseEvent.id).where(PhaseEvent.id == phase_event_id, PhaseEvent.trip_id == trip_id)
    )).scalar_one_or_none()
    if found is None:
        raise IncidentInvalidError(f"Phase event '{phase_event_id}' is not on this trip.")


async def assert_colleague(db: AsyncSession, *, user_id: uuid.UUID, organization_id: uuid.UUID) -> None:
    """An incident's owner must be an active dispatcher of the same operator."""
    found = (await db.execute(
        select(User.id).where(User.id == user_id, User.organization_id == organization_id, User.is_active.is_(True))
    )).scalar_one_or_none()
    if found is None:
        raise IncidentInvalidError(f"User '{user_id}' is not an active dispatcher in this organisation.")
