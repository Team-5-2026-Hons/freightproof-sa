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
from app.schemas.trips import ConsignmentManifest, DeliveryStopManifest, LinehaulResponse, ManifestResponse
from app.schemas.trips import ParcelRead


async def _load_consignments_and_parcels(
    db: AsyncSession, trip_id: uuid.UUID,
) -> list[tuple[Consignment, list[Parcel]]]:
    """All consignments on the trip, each with its parcels. Multi-client trips have
    several consignments (FP-112) — a single-row assumption here is a 500 waiting to happen."""
    consignments_result = await db.execute(
        select(Consignment).where(Consignment.trip_id == trip_id).order_by(Consignment.created_at)
    )
    consignments = list(consignments_result.scalars().all())
    if not consignments:
        raise ResourceNotFoundError("Manifest", str(trip_id))

    parcels_result = await db.execute(
        select(Parcel).where(Parcel.consignment_id.in_([c.id for c in consignments]))
    )
    parcels_by_consignment: dict[uuid.UUID, list[Parcel]] = defaultdict(list)
    for p in parcels_result.scalars().all():
        parcels_by_consignment[p.consignment_id].append(p)

    return [(c, parcels_by_consignment[c.id]) for c in consignments]


async def get_manifest_for_dispatcher(
    db: AsyncSession, trip_id: uuid.UUID, *, operator_organization_id: uuid.UUID,
) -> ManifestResponse:
    trip_result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )
    if trip_result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    loaded = await _load_consignments_and_parcels(db, trip_id)

    consignment_manifests: list[ConsignmentManifest] = []
    for consignment, parcels in loaded:
        by_stop: dict[str, list[Parcel]] = defaultdict(list)
        for p in parcels:
            by_stop[p.delivery_stop or "Unassigned"].append(p)
        consignment_manifests.append(
            ConsignmentManifest(
                consignment_id=consignment.id,
                parcel_perfect_reference=consignment.parcel_perfect_reference,
                client_organization_id=consignment.client_organization_id,
                unit_count_expected=consignment.unit_count_expected,
                total_parcel_count=len(parcels),
                origin_scan_complete=all(p.pp_scan_out_at is not None for p in parcels) if parcels else False,
                stops=[
                    DeliveryStopManifest(
                        delivery_stop=stop, parcel_count=len(stop_parcels),
                        parcels=[ParcelRead.model_validate(p) for p in stop_parcels],
                    )
                    for stop, stop_parcels in by_stop.items()
                ],
            )
        )

    all_parcels = [p for _, parcels in loaded for p in parcels]
    return ManifestResponse(
        trip_id=trip_id,
        total_parcel_count=len(all_parcels),
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in all_parcels) if all_parcels else False,
        consignments=consignment_manifests,
        pulled_at=max(c.updated_at for c, _ in loaded),
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

    loaded = await _load_consignments_and_parcels(db, trip_id)

    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()
    driver_result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    driver = driver_result.scalar_one()

    # Consolidated-unit grain (pallets), summed across all consignments — the driver counts
    # pallets, never parcels (Bruce, 24 Jun). Legacy fallback applies per-consignment: each
    # consignment created before FP-112 has no unit_count_expected, so that consignment's
    # parcel count is used instead — a whole-trip fallback would silently drop the legacy
    # consignment's units whenever another consignment on the same trip already has a unit
    # count set. Remove the fallback once FP-114 populates unit counts everywhere.
    all_parcels = [p for _, parcels in loaded for p in parcels]
    consolidated_unit_count = sum(
        c.unit_count_expected if c.unit_count_expected is not None else len(parcels)
        for c, parcels in loaded
    )

    return LinehaulResponse(
        trip_id=trip_id,
        vehicle_registration=horse.registration,
        vehicle_type=str(horse.vehicle_type),
        driver_full_name=driver.full_name,
        consolidated_unit_count=consolidated_unit_count,
        origin_scan_complete=all(p.pp_scan_out_at is not None for p in all_parcels) if all_parcels else False,
        pulled_at=max(c.updated_at for c, _ in loaded),
    )
