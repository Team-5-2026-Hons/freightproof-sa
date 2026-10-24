"""The dev panel's trip list: each trip with its stops, per-stop waybills (with real barcodes), the
warehouse-scan gate status at each stop, and its vehicles. Batched reads only: one query per
kind of row for the whole organisation, never one per trip.

Moved out of dev/endpoints/triggers.py so the route stays a thin HTTP shim.
"""

import uuid
from collections.abc import Callable
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.dev.schemas import DevConsignment, DevTripStop, DevTripSummary, DevVehicle
from app.orchestration.phases.blocking import GATED_PHASES
from app.orchestration.substitutions.access import current_driver_id_expression


def _dev_consignment(
    c: Consignment, barcodes_by_consignment: dict[uuid.UUID, list[str]],
) -> DevConsignment:
    return DevConsignment(
        consignment_id=c.id,
        parcel_perfect_reference=c.parcel_perfect_reference,
        barcodes=barcodes_by_consignment.get(c.id, []),
    )


async def _stop_phase_lookup(
    db: AsyncSession, trip_ids: list[uuid.UUID],
) -> tuple[dict[tuple[uuid.UUID, PhaseType], str], Callable[[uuid.UUID, uuid.UUID], Optional[str]]]:
    """Each stop's gate-relevant phase statuses, and a lookup for the status of the departure
    that precedes a stop, both from one batched query."""
    # Imported, not re-declared, so this can never drift from phases/blocking.py. Plus
    # DEPARTURE (not gated) to derive preceding_departure_status below, and ARRIVAL,
    # which gates scan IN on the panel; extending this one query rather than adding a
    # second keeps this endpoint's batched-query discipline.
    gated_phase_types = list(GATED_PHASES.keys())
    phase_event_types = [*gated_phase_types, PhaseType.UNLOADING, PhaseType.ARRIVAL, PhaseType.DEPARTURE]
    phase_events = list((await db.execute(
        select(
            PhaseEvent.trip_id, PhaseEvent.trip_stop_id,
            PhaseEvent.phase_type, PhaseEvent.status, PhaseEvent.sequence_number,
        )
        .where(
            PhaseEvent.trip_id.in_(trip_ids),
            PhaseEvent.phase_type.in_(phase_event_types),
        )
    )).all())
    # trip_stop_id alone is a safe key: only trip_creation is NULL, excluded by the filter above.
    phase_status_by_stop: dict[tuple[uuid.UUID, PhaseType], str] = {
        (trip_stop_id, phase_type): str(status)
        for _, trip_stop_id, phase_type, status, _ in phase_events
        if trip_stop_id is not None
    }

    # DEPARTURE events per trip, mirroring phases.seals._find_departure_for_leg's rule:
    # the highest-sequence_number DEPARTURE strictly before the stop's own closing event.
    departures_by_trip: dict[uuid.UUID, list[tuple[int, str]]] = {}
    for trip_id_col, _, phase_type, status, sequence_number in phase_events:
        # `==`, not `is`: phase_type is a plain string column, never the same object as the enum.
        if phase_type == PhaseType.DEPARTURE:
            departures_by_trip.setdefault(trip_id_col, []).append(
                (sequence_number, str(status))
            )

    # This stop's own closing event (UNLOADING, or CONFIRMATION on a final stop that
    # also drops off); the lower sequence number when both exist.
    closing_sequence_by_stop: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    for trip_id_col, trip_stop_id, phase_type, _, sequence_number in phase_events:
        if trip_stop_id is None or phase_type not in (PhaseType.UNLOADING, PhaseType.CONFIRMATION):
            continue
        key = (trip_id_col, trip_stop_id)
        if key not in closing_sequence_by_stop or sequence_number < closing_sequence_by_stop[key]:
            closing_sequence_by_stop[key] = sequence_number

    def _preceding_departure_status(trip_id_: uuid.UUID, trip_stop_id: uuid.UUID) -> Optional[str]:
        closing_sequence = closing_sequence_by_stop.get((trip_id_, trip_stop_id))
        if closing_sequence is None:
            return None  # no unloading/confirmation at this stop — it's the origin
        preceding = [
            (sequence, status) for sequence, status in departures_by_trip.get(trip_id_, [])
            if sequence < closing_sequence
        ]
        if not preceding:
            return None
        return max(preceding, key=lambda item: item[0])[1]

    return phase_status_by_stop, _preceding_departure_status


async def _vehicles_by_trip(
    db: AsyncSession, trips: list[Trip], trip_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[DevVehicle]]:
    """Each trip's horse then its trailers, for the panel's vehicle picker."""
    # One query for horses, one for trailers, same batched-query discipline as above.
    horses = {v.id: v for v in (await db.execute(
        select(Vehicle).where(Vehicle.id.in_([t.horse_id for t in trips]))
    )).scalars().all()}
    trailers_by_trip: dict[uuid.UUID, list[Vehicle]] = {}
    for trailer_trip_id, vehicle in (await db.execute(
        select(TripTrailer.trip_id, Vehicle)
        .join(Vehicle, Vehicle.id == TripTrailer.trailer_id)
        .where(TripTrailer.trip_id.in_(trip_ids))
        .order_by(Vehicle.registration)
    )).all():
        trailers_by_trip.setdefault(trailer_trip_id, []).append(vehicle)

    def _vehicles(trip: Trip) -> list[DevVehicle]:
        horse = horses.get(trip.horse_id)
        return [
            *([DevVehicle(vehicle_id=horse.id, registration=horse.registration, role="horse")] if horse else []),
            *(DevVehicle(vehicle_id=v.id, registration=v.registration, role="trailer")
              for v in trailers_by_trip.get(trip.id, [])),
        ]

    return {trip.id: _vehicles(trip) for trip in trips}


async def list_panel_trips(db: AsyncSession, *, organization_id: uuid.UUID) -> list[DevTripSummary]:
    """Trips with their stops, per-stop waybills (with real barcodes), and the
    warehouse-scan gate status at each stop, for the panel's own pickers."""
    trips_with_driver = list((await db.execute(
        select(Trip, Driver.full_name)
        # FP-83: label the driver who holds the trip now, not the journey lock's original.
        .outerjoin(Driver, Driver.id == current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id))
        .where(Trip.operator_organization_id == organization_id)
        .order_by(Trip.created_at.desc())
    )).all())
    if not trips_with_driver:
        return []

    trips = [row[0] for row in trips_with_driver]
    driver_name_by_trip: dict[uuid.UUID, Optional[str]] = {
        row[0].id: row[1] for row in trips_with_driver
    }

    trip_ids = [t.id for t in trips]
    stops = list((await db.execute(
        select(TripStop, Precinct.name)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id.in_(trip_ids))
        .order_by(TripStop.sequence)
    )).all())
    consignments = list((await db.execute(
        select(Consignment).where(Consignment.trip_id.in_(trip_ids))
    )).scalars().all())

    # Sorted the same way _resolve_barcodes orders them, so "first N" matches what
    # the panel would actually stage.
    consignment_ids = [c.id for c in consignments]
    parcels = list((await db.execute(
        select(Parcel.consignment_id, Parcel.barcode)
        .where(Parcel.consignment_id.in_(consignment_ids))
        .order_by(Parcel.consignment_id, Parcel.barcode)
    )).all()) if consignment_ids else []
    barcodes_by_consignment: dict[uuid.UUID, list[str]] = {}
    for consignment_id, barcode in parcels:
        barcodes_by_consignment.setdefault(consignment_id, []).append(barcode)

    phase_status_by_stop, _preceding_departure_status = await _stop_phase_lookup(db, trip_ids)
    vehicles_by_trip = await _vehicles_by_trip(db, trips, trip_ids)

    summaries: list[DevTripSummary] = []
    for trip in trips:
        trip_stops: list[DevTripStop] = []
        for stop, precinct_name in stops:
            if stop.trip_id != trip.id:
                continue
            trip_stops.append(DevTripStop(
                trip_stop_id=stop.id,
                sequence=stop.sequence,
                precinct_name=precinct_name,
                pickup_consignments=[
                    _dev_consignment(c, barcodes_by_consignment) for c in consignments if c.pickup_stop_id == stop.id
                ],
                delivery_consignments=[
                    _dev_consignment(c, barcodes_by_consignment) for c in consignments if c.delivery_stop_id == stop.id
                ],
                loading_phase_status=phase_status_by_stop.get((stop.id, PhaseType.LOADING)),
                confirmation_phase_status=phase_status_by_stop.get(
                    (stop.id, PhaseType.CONFIRMATION)
                ),
                preceding_departure_status=_preceding_departure_status(trip.id, stop.id),
                arrival_phase_status=phase_status_by_stop.get((stop.id, PhaseType.ARRIVAL)),
                unloading_phase_status=phase_status_by_stop.get((stop.id, PhaseType.UNLOADING)),
            ))
        summaries.append(DevTripSummary(
            trip_id=trip.id,
            trip_reference=trip.trip_reference,
            status=str(trip.status),
            current_phase=trip.current_phase,
            stops=trip_stops,
            driver_full_name=driver_name_by_trip.get(trip.id),
            created_at=trip.created_at,
            current_stop_sequence=trip.current_stop,
            vehicles=vehicles_by_trip[trip.id],
        ))
    return summaries
