"""Tenant-scoped, batched reads for parcel traceability; no external integration calls."""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import Select, case, column, func, literal, or_, select, true, tuple_, union
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.sql.selectable import Subquery

from app.core.pagination import CursorPosition
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.schemas.parcel_trace import LOOKUP_PAGE_SIZE, ParcelLookupQuery, ParcelMatch


def matching_associations(organization_id: UUID, barcode: str) -> Subquery:
    current = (
        select(Consignment.parcel_perfect_reference.label("waybill_reference"), Trip.id.label("trip_id"))
        .select_from(Parcel).join(Consignment, Parcel.consignment_id == Consignment.id)
        .join(Trip, Consignment.trip_id == Trip.id)
        .where(Parcel.barcode == barcode, Trip.operator_organization_id == organization_id)
    )
    # Old/cancelled trips can retain their cargo only in the committed H0 snapshot.
    # Guard legacy JSON shapes before expanding; never expose the raw PP/contact payload.
    waybills = case(
        (func.jsonb_typeof(PhaseEvent.parcel_manifest_snapshot["waybills"]) == "array",
         PhaseEvent.parcel_manifest_snapshot["waybills"]),
        else_=literal([], type_=JSONB),
    )
    entry = func.jsonb_array_elements(waybills).table_valued(column("value", JSONB)).lateral("waybill")
    reference = entry.c.value["details"]["waybill"].astext
    historical = (
        select(reference.label("waybill_reference"), Trip.id.label("trip_id"))
        .select_from(PhaseEvent).join(Trip, PhaseEvent.trip_id == Trip.id).join(entry, true())
        .where(
            Trip.operator_organization_id == organization_id,
            PhaseEvent.phase_type == PhaseType.TRIP_CREATION,
            PhaseEvent.parcel_manifest_snapshot.contains({"waybills": [{"tracks": [{"trackno": barcode}]}]}),
            entry.c.value.contains({"tracks": [{"trackno": barcode}]}),
            reference.is_not(None), reference != "",
        )
    )
    # A current row and its own creation snapshot represent the same association.
    return union(current, historical).subquery("parcel_associations")


async def lookup_matches(
    db: AsyncSession, organization_id: UUID, query: ParcelLookupQuery,
) -> list[ParcelMatch]:
    associations = matching_associations(organization_id, query.barcode)
    stmt = select(
        associations.c.waybill_reference, func.count().label("journey_count"),
    ).group_by(associations.c.waybill_reference).order_by(associations.c.waybill_reference)
    if query.after is not None:
        stmt = stmt.where(associations.c.waybill_reference > query.after)
    rows = (await db.execute(stmt.limit(LOOKUP_PAGE_SIZE + 1))).mappings()
    return [ParcelMatch.model_validate(row) for row in rows]


def journey_query(organization_id: UUID, barcode: str, reference: str) -> Select[tuple[Trip]]:
    associations = matching_associations(organization_id, barcode)
    return (
        select(Trip).join(associations, associations.c.trip_id == Trip.id)
        .where(Trip.operator_organization_id == organization_id, associations.c.waybill_reference == reference)
        .order_by(Trip.created_at.desc(), Trip.id.desc())
    )


async def load_journeys(
    db: AsyncSession, stmt: Select[tuple[Trip]], position: CursorPosition | None, limit: int,
) -> list[Trip]:
    if position is not None:
        stmt = stmt.where(tuple_(Trip.created_at, Trip.id) < (position.created_at, position.id))
    return list((await db.execute(stmt.limit(limit + 1))).scalars())


@dataclass
class JourneyRecords:
    trip: Trip
    phases: list[PhaseEvent] = field(default_factory=list)
    stops: list[TripStop] = field(default_factory=list)
    precinct_names: dict[UUID, str] = field(default_factory=dict)
    consignment: Consignment | None = None
    parcels: list[Parcel] = field(default_factory=list)
    exceptions: list[TripException] = field(default_factory=list)
    vehicle_registration: str | None = None


async def load_records(
    db: AsyncSession, trips: list[Trip], barcode: str, reference: str,
) -> list[JourneyRecords]:
    if not trips:
        return []
    records = {trip.id: JourneyRecords(trip=trip) for trip in trips}
    ids = list(records)
    phases = (await db.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id.in_(ids))
        .order_by(PhaseEvent.sequence_number, PhaseEvent.id)
    )).scalars()
    for phase in phases:
        records[phase.trip_id].phases.append(phase)
    stops = (await db.execute(
        select(TripStop, Precinct.name).join(Precinct, TripStop.precinct_id == Precinct.id)
        .where(TripStop.trip_id.in_(ids)).order_by(TripStop.sequence)
    )).all()
    for stop, name in stops:
        records[stop.trip_id].stops.append(stop)
        records[stop.trip_id].precinct_names[stop.precinct_id] = name
    cargo = (await db.execute(
        select(Consignment, Parcel).join(Parcel, Parcel.consignment_id == Consignment.id)
        .where(Consignment.trip_id.in_(ids), Consignment.parcel_perfect_reference == reference, Parcel.barcode == barcode)
        .order_by(Parcel.id)
    )).all()
    for consignment, parcel in cargo:
        if consignment.trip_id is not None:
            records[consignment.trip_id].consignment = consignment
            records[consignment.trip_id].parcels.append(parcel)
    await _load_context(db, records, reference)
    return list(records.values())


async def _load_context(db: AsyncSession, records: dict[UUID, JourneyRecords], reference: str) -> None:
    cargo = aliased(Consignment)
    exceptions = (await db.execute(
        select(TripException).outerjoin(cargo, TripException.consignment_id == cargo.id)
        .where(TripException.trip_id.in_(records), or_(
            TripException.consignment_id.is_(None), cargo.parcel_perfect_reference == reference,
        )).order_by(TripException.created_at, TripException.id)
    )).scalars()
    for exception in exceptions:
        records[exception.trip_id].exceptions.append(exception)
    vehicles = dict((await db.execute(
        select(Vehicle.id, Vehicle.registration).where(
            Vehicle.id.in_({r.trip.horse_id for r in records.values()}),
            Vehicle.organization_id.in_({r.trip.operator_organization_id for r in records.values()}),
        ),
    )).tuples().all())
    for record in records.values():
        record.vehicle_registration = vehicles.get(record.trip.horse_id)
