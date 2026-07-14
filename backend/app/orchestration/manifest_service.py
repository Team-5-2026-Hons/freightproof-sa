"""Manifest/Linehaul retrieval — role-aware: dispatchers see per-parcel detail,
drivers see only the consolidated Linehaul document (theft-risk rule, see the
2026-06-24 coordination note: drivers must never see per-parcel data or counts).
"""

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.people import Driver
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.models.vehicles import Vehicle
from app.schemas.trips import DeliveryStopManifest, LinehaulResponse, ManifestResponse
from app.schemas.trips import ParcelRead


async def _load_consignment_and_parcels(db: AsyncSession, trip_id: uuid.UUID):
    consignment_result = await db.execute(select(Consignment).where(Consignment.trip_id == trip_id))
    consignment = consignment_result.scalar_one_or_none()
    if consignment is None:
        raise ResourceNotFoundError("Manifest", str(trip_id))

    parcels_result = await db.execute(select(Parcel).where(Parcel.consignment_id == consignment.id))
    parcels = parcels_result.scalars().all()
    return consignment, parcels


async def get_manifest_for_dispatcher(
    db: AsyncSession, trip_id: uuid.UUID, *, operator_organization_id: uuid.UUID,
) -> ManifestResponse:
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )
    if trip_result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    consignment, parcels = await _load_consignment_and_parcels(db, trip_id)

    by_stop: dict[str, list[Parcel]] = defaultdict(list)
    for p in parcels:
        by_stop[p.delivery_stop or "Unassigned"].append(p)

    return ManifestResponse(
        trip_id=trip_id,
        consignment_id=consignment.id,
        parcel_perfect_reference=consignment.parcel_perfect_reference,
        total_parcel_count=len(parcels),
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in parcels) if parcels else False,
        stops=[
            DeliveryStopManifest(
                delivery_stop=stop, parcel_count=len(stop_parcels),
                parcels=[ParcelRead.model_validate(p) for p in stop_parcels],
            )
            for stop, stop_parcels in by_stop.items()
        ],
        pulled_at=consignment.updated_at,
    )


async def get_linehaul_for_driver(
    db: AsyncSession, trip_id: uuid.UUID, *, driver_id: uuid.UUID,
) -> LinehaulResponse:
    """Raises ResourceNotFoundError if the trip doesn't exist or isn't this driver's
    trip — 404 either way so the response never confirms another driver's trip exists."""
    trip_result = await db.execute(select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    trip = trip_result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    consignment, parcels = await _load_consignment_and_parcels(db, trip_id)

    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()
    driver_result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    driver = driver_result.scalar_one()

    return LinehaulResponse(
        trip_id=trip_id,
        vehicle_registration=horse.registration,
        vehicle_type=str(horse.vehicle_type),
        driver_full_name=driver.full_name,
        consolidated_unit_count=len(parcels),
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in parcels) if parcels else False,
        pulled_at=consignment.updated_at,
    )
