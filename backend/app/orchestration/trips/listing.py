"""Trip list and closed-trip history reads.

Sits above `detail` in trips/ and reuses its client-name and manifest-reference helpers.
Read-only; the endpoint owns the transaction.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, literal, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import PG_INTEGER_MAX
from app.core.pagination import CursorPosition, encode_cursor
from app.db.models.enums import ExceptionReviewStatus, PhaseStatus, TripStatus, TripType
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.trips.detail import _client_names, _pp_manifest
from app.schemas.people import DriverRead
from app.schemas.pagination import CursorPage
from app.schemas.trips import (
    TripHistoryDriverResponse,
    TripHistoryListItemResponse,
    TripHistoryVehicleResponse,
    TripListItemResponse,
)
from app.schemas.vehicles import VehicleRead


async def list_trips(
    db: AsyncSession,
    operator_organization_id: uuid.UUID,
    status_filter: list[TripStatus] | None = None,
    pp_manifest_number: int | None = None,
) -> list[TripListItemResponse]:
    q = select(Trip).where(Trip.operator_organization_id == operator_organization_id)
    if status_filter:
        q = q.where(Trip.status.in_(status_filter))
    if pp_manifest_number is not None:
        q = q.where(Trip.pp_manifest_number == pp_manifest_number)
    q = q.order_by(Trip.created_at.desc())

    trips_result = await db.execute(q)
    trips = trips_result.scalars().all()
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    # Batch-fetch to avoid N+1 queries on list views.
    driver_ids = list({t.driver_id for t in trips})
    drivers_result = await db.execute(select(Driver).where(Driver.id.in_(driver_ids)))
    drivers_by_id: dict[uuid.UUID, Driver] = {d.id: d for d in drivers_result.scalars().all()}

    horse_ids = list({t.horse_id for t in trips})
    horses_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(horse_ids)))
    horses_by_id: dict[uuid.UUID, Vehicle] = {v.id: v for v in horses_result.scalars().all()}

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids))
    )
    trip_trailers = tt_result.scalars().all()

    trailer_vehicle_ids = list({tt.trailer_id for tt in trip_trailers})
    trailers_result = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(trailer_vehicle_ids))
    )
    trailers_by_id: dict[uuid.UUID, Vehicle] = {
        v.id: v for v in trailers_result.scalars().all()
    }

    trailers_by_trip: dict[uuid.UUID, list[Vehicle]] = defaultdict(list)
    for tt in trip_trailers:
        if tt.trailer_id in trailers_by_id:
            trailers_by_trip[tt.trip_id].append(trailers_by_id[tt.trailer_id])

    # NEEDS_REVIEW only, not "!= REVIEWED": REVIEWED rows (including dispatcher-authored
    # notes, which are saved already reviewed) are excluded — only unreviewed rows are
    # awaiting a dispatcher decision, so only they count here (FP-146 follow-on).
    exc_result = await db.execute(
        select(TripException.trip_id, func.count(TripException.id))
        .where(
            TripException.trip_id.in_(trip_ids),
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
        .group_by(TripException.trip_id)
    )
    exc_counts: dict[uuid.UUID, int] = {row[0]: row[1] for row in exc_result.all()}

    # Same batching shape as exc_counts above: one grouped query for the page.
    # `completed` here means "resolved" in the ledger's sense — an overridden phase
    # will never be revisited either, so it counts as done for a progress bar.
    plan_result = await db.execute(
        select(
            PhaseEvent.trip_id,
            func.count(PhaseEvent.id),
            func.count(PhaseEvent.id).filter(
                PhaseEvent.status.in_([PhaseStatus.COMPLETED, PhaseStatus.OVERRIDDEN])
            ),
        )
        .where(PhaseEvent.trip_id.in_(trip_ids))
        .group_by(PhaseEvent.trip_id)
    )
    plan_counts: dict[uuid.UUID, tuple[int, int]] = {
        row[0]: (row[1], row[2]) for row in plan_result.all()
    }

    client_names = await _client_names(db, trips)

    return [
        TripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            pp_manifest=_pp_manifest(t, client_names),
            status=t.status,
            trip_type=TripType(t.trip_type),
            driver=DriverRead.model_validate(drivers_by_id[t.driver_id]),
            horse=VehicleRead.model_validate(horses_by_id[t.horse_id]),
            trailers=[VehicleRead.model_validate(v) for v in trailers_by_trip.get(t.id, [])],
            origin_precinct_id=t.origin_precinct_id,
            destination_precinct_id=t.destination_precinct_id,
            planned_departure_at=t.planned_departure_at,
            actual_departure_at=t.actual_departure_at,
            planned_arrival_at=t.planned_arrival_at,
            actual_arrival_at=t.actual_arrival_at,
            needs_review_count=exc_counts.get(t.id, 0),
            current_phase=t.current_phase,
            current_stop=t.current_stop,
            phase_total=plan_counts.get(t.id, (0, 0))[0],
            phase_completed=plan_counts.get(t.id, (0, 0))[1],
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in trips
    ]


async def list_trip_history(
    db: AsyncSession,
    *,
    operator_organization_id: uuid.UUID,
    limit: int = 25,
    cursor_position: CursorPosition | None = None,
    q: str | None = None,
    precinct_id: uuid.UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> CursorPage[TripHistoryListItemResponse]:
    """Closed/cancelled trips, newest close first, keyset-paginated.

    The opaque shared cursor's timestamp field is named ``created_at`` internally, but
    its value here is always Trip.closed_at. The API boundary decodes it before calling
    this query so malformed client input fails without doing database work.
    """
    filters = [
        Trip.operator_organization_id == operator_organization_id,
        Trip.status.in_([TripStatus.CLOSED, TripStatus.CANCELLED]),
        Trip.closed_at.is_not(None),
    ]
    if q is not None:
        matches = [
            Trip.trip_reference.icontains(q, autoescape=True),
            Driver.full_name.icontains(q, autoescape=True),
        ]
        # A manifest number is matched exactly (spec §12); "69" must not find 690. Bounded
        # because pp_manifest_number is a Postgres integer: a longer run of digits typed
        # into search would otherwise be a 500, not "no results".
        term = q.strip()
        if term.isdecimal() and int(term) <= PG_INTEGER_MAX:
            matches.append(Trip.pp_manifest_number == int(term))
        filters.append(or_(*matches))
    if precinct_id is not None:
        filters.append(or_(
            Trip.origin_precinct_id == precinct_id,
            Trip.destination_precinct_id == precinct_id,
        ))
    if from_date is not None or to_date is not None:
        operations_tz = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
        if from_date is not None:
            filters.append(
                Trip.closed_at >= datetime.combine(from_date, time.min, tzinfo=operations_tz)
            )
        # date.max has no representable day-after boundary. Omitting the upper
        # predicate in that one case preserves inclusive semantics because no
        # Python/driver timestamp can fall beyond the maximum calendar date.
        if to_date is not None and to_date < date.max:
            filters.append(
                Trip.closed_at
                < datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=operations_tz)
            )

    count_stmt = (
        select(func.count())
        .select_from(Trip)
        .join(Driver, Driver.id == Trip.driver_id)
        .where(*filters)
    )
    total_items = (await db.execute(count_stmt)).scalar_one()

    page_stmt = (
        select(Trip, Driver)
        .join(Driver, Driver.id == Trip.driver_id)
        .where(*filters)
        .order_by(Trip.closed_at.desc(), Trip.id.desc())
        .limit(limit + 1)
    )
    if cursor_position is not None:
        page_stmt = page_stmt.where(
            tuple_(Trip.closed_at, Trip.id)
            < tuple_(literal(cursor_position.created_at), literal(cursor_position.id))
        )

    rows = (await db.execute(page_stmt)).all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    trips = [trip for trip, _driver in page_rows]

    if not trips:
        return CursorPage[TripHistoryListItemResponse](
            items=[], next_cursor=None, total_items=total_items,
        )

    trip_ids = [trip.id for trip in trips]
    horse_ids = list({trip.horse_id for trip in trips})
    horses_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(horse_ids)))
    horses_by_id: dict[uuid.UUID, Vehicle] = {
        vehicle.id: vehicle for vehicle in horses_result.scalars().all()
    }

    exceptions_result = await db.execute(
        select(TripException.trip_id, func.count(TripException.id))
        .where(
            TripException.trip_id.in_(trip_ids),
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
        .group_by(TripException.trip_id)
    )
    exception_counts: dict[uuid.UUID, int] = {
        trip_id: count for trip_id, count in exceptions_result.all()
    }

    phases_result = await db.execute(
        select(
            PhaseEvent.trip_id,
            func.count(PhaseEvent.id),
            func.count(PhaseEvent.id).filter(
                PhaseEvent.status.in_([PhaseStatus.COMPLETED, PhaseStatus.OVERRIDDEN])
            ),
        )
        .where(PhaseEvent.trip_id.in_(trip_ids))
        .group_by(PhaseEvent.trip_id)
    )
    phase_counts: dict[uuid.UUID, tuple[int, int]] = {
        trip_id: (total, completed)
        for trip_id, total, completed in phases_result.all()
    }

    client_names = await _client_names(db, trips)

    items = [
        TripHistoryListItemResponse(
            id=trip.id,
            trip_reference=trip.trip_reference,
            pp_manifest=_pp_manifest(trip, client_names),
            status=trip.status,
            driver=TripHistoryDriverResponse.model_validate(driver),
            horse=TripHistoryVehicleResponse.model_validate(horses_by_id[trip.horse_id]),
            origin_precinct_id=trip.origin_precinct_id,
            destination_precinct_id=trip.destination_precinct_id,
            needs_review_count=exception_counts.get(trip.id, 0),
            current_phase=trip.current_phase,
            current_stop=trip.current_stop,
            phase_total=phase_counts.get(trip.id, (0, 0))[0],
            phase_completed=phase_counts.get(trip.id, (0, 0))[1],
            closed_at=trip.closed_at,
            created_at=trip.created_at,
        )
        for trip, driver in page_rows
    ]

    next_cursor: str | None = None
    if has_more:
        last_trip = page_rows[-1][0]
        next_cursor = encode_cursor(CursorPosition(
            created_at=last_trip.closed_at,
            id=last_trip.id,
        ))

    return CursorPage[TripHistoryListItemResponse](
        items=items, next_cursor=next_cursor, total_items=total_items,
    )

