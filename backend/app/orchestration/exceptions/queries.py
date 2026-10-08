"""Dispatcher reads of exceptions: the review queue, the history list and one exception's detail.

Every query is scoped to the caller's organisation through the Trip join. Nothing here writes.
"""

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import case, func, literal, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.core.pagination import CursorPosition, decode_cursor, encode_cursor
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, VehicleType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.transit import TripException
from app.db.models.vehicles import Vehicle
from app.orchestration.artifact_service import get_trip_scoped_artifact
from app.orchestration.review_identity import name_of, user_names
from app.schemas.pagination import CursorPage
from app.schemas.transit import TripExceptionDetail, TripExceptionListItem


# Recorded/reviewed only — never needs_review. Named once rather than inlined into
# list_exception_history so get_exception_detail's own note about the queue/history
# split can point at one place, and so the two review states forming "history" cannot
# quietly drift apart from the review-queue's own filter below.
_HISTORY_REVIEW_STATUSES = (ExceptionReviewStatus.RECORDED, ExceptionReviewStatus.REVIEWED)


@dataclass(frozen=True)
class _TripContext:
    """Route and crew labels for one trip, shown on exception rows."""

    origin_name: str | None = None
    destination_name: str | None = None
    driver_name: str | None = None
    horse_registration: str | None = None
    trailer_registrations: list[str] = field(default_factory=list)


async def _load_trip_contexts(
    db: AsyncSession, trips: Iterable[Trip],
) -> dict[uuid.UUID, _TripContext]:
    """Route/driver/truck/trailer labels for a set of trips, in three queries total:
    precincts, driver and horse together, then trailers.

    Batched per page rather than joined into _exception_read_query: a trip can have many
    trailers, which would multiply exception rows, and the 4-tuple that query returns is
    unpacked by every reader in this module. The trips are already organisation-scoped
    by the caller's join, and driver/vehicle/precinct are reached only through that
    trip's own foreign keys, so nothing here widens what a dispatcher can see.
    """
    unique = {trip.id: trip for trip in trips}
    if not unique:
        return {}

    precinct_ids = {
        pid for trip in unique.values()
        for pid in (trip.origin_precinct_id, trip.destination_precinct_id) if pid is not None
    }
    precinct_names: dict[uuid.UUID, str] = {}
    if precinct_ids:
        precinct_names = dict((await db.execute(
            select(Precinct.id, Precinct.name).where(Precinct.id.in_(precinct_ids))
        )).tuples().all())

    # Outer joins: a driver or horse that cannot be resolved leaves its label None rather than
    # dropping the trip's row, as the separate lookups this replaced did.
    crew_rows = (await db.execute(
        select(Trip.id, Driver.full_name, Vehicle.registration)
        .select_from(Trip)
        .outerjoin(Driver, Driver.id == Trip.driver_id)
        .outerjoin(Vehicle, Vehicle.id == Trip.horse_id)
        .where(Trip.id.in_(unique))
    )).all()
    crew = {trip_id: (driver_name, horse_registration) for trip_id, driver_name, horse_registration in crew_rows}

    trailer_rows = (await db.execute(
        select(TripTrailer.trip_id, Vehicle.registration)
        .join(Vehicle, Vehicle.id == TripTrailer.trailer_id)
        .where(TripTrailer.trip_id.in_(unique))
        .order_by(Vehicle.registration)
    )).all()
    trailers: dict[uuid.UUID, list[str]] = {}
    for trip_id, registration in trailer_rows:
        trailers.setdefault(trip_id, []).append(registration)

    contexts: dict[uuid.UUID, _TripContext] = {}
    for trip in unique.values():
        driver_name, horse_registration = crew.get(trip.id, (None, None))
        contexts[trip.id] = _TripContext(
            origin_name=precinct_names.get(trip.origin_precinct_id) if trip.origin_precinct_id else None,
            destination_name=precinct_names.get(trip.destination_precinct_id) if trip.destination_precinct_id else None,
            driver_name=driver_name,
            horse_registration=horse_registration,
            trailer_registrations=trailers.get(trip.id, []),
        )
    return contexts


def _to_list_item(
    exc: TripException, trip: Trip, phase_type: str | None, stop_sequence: int | None,
    names: Mapping[uuid.UUID, str], context: _TripContext | None = None,
) -> TripExceptionListItem:
    """Build the compact list row from one (exception, trip, phase_type, stop_sequence)
    tuple — the shape every 4-column join in this module selects.

    Not `TripExceptionListItem.model_validate(exc)`: the trip reference/status and the
    phase/stop labels live on the joined Trip/PhaseEvent/TripStop rows, not on
    TripException itself. Raw values are passed straight through rather than
    `.value`'d — `exc.exception_type`, `trip.status`, `phase_type` all come back from
    the database as plain `str` (see this module's DB-backed enum columns), and Pydantic
    coerces them into their declared enum types on construction; `.value`'ing an
    already-plain string raises AttributeError.
    """
    context = context or _TripContext()
    return TripExceptionListItem(
        id=exc.id,
        exception_type=exc.exception_type,
        source=exc.source,
        severity=exc.severity,
        review_status=exc.review_status,
        description=exc.description,
        created_at=exc.created_at,
        trip_id=exc.trip_id,
        trip_reference=trip.trip_reference,
        trip_status=trip.status,
        origin_name=context.origin_name,
        destination_name=context.destination_name,
        driver_name=context.driver_name,
        horse_registration=context.horse_registration,
        trailer_registrations=context.trailer_registrations,
        phase_label=phase_type,
        stop_label=stop_sequence,
        # This is the capture-time verdict stored with the driver report, not a
        # present-day recomputation. Dispatcher list and detail responses share this
        # projection so either surface can explain what evidence was available then.
        action_location_assessment=exc.action_location_assessment,
        claimed_by_user_id=exc.claimed_by_user_id,
        claimed_at=exc.claimed_at,
        claimed_by_name=name_of(names, exc.claimed_by_user_id),
        reviewed_by_name=name_of(names, exc.reviewed_by_user_id),
    )


def _exception_read_query():
    """The 4-column join every read function in this module selects from: the exception
    and its trip (for org scoping and the trip reference/status), plus the phase type
    and stop sequence the exception is scoped to, if any.

    Only the two scalar columns are pulled off PhaseEvent/TripStop, not the full
    entities — nothing here needs more of either row, and selecting whole entities
    would make the outer joins load columns no caller reads.
    """
    return (
        select(TripException, Trip, PhaseEvent.phase_type, TripStop.sequence)
        .join(Trip, Trip.id == TripException.trip_id)
        .outerjoin(PhaseEvent, PhaseEvent.id == TripException.phase_event_id)
        .outerjoin(TripStop, TripStop.id == TripException.trip_stop_id)
    )


# The inbox is worked top to bottom, so the most urgent row must be on top. Ordered in
# SQL, not by the client, so every dispatcher sees the same order.
_SEVERITY_RANK = case(
    (TripException.severity == ExceptionSeverity.CRITICAL, 0),
    (TripException.severity == ExceptionSeverity.WARNING, 1),
    else_=2,
)


async def list_review_queue(
    db: AsyncSession, *, organization_id: uuid.UUID,
) -> list[TripExceptionListItem]:
    """Every needs_review exception in the organisation: critical first, then warning, then
    info; newest first within a severity.

    Deliberately unpaginated — see the endpoint's own docstring (api/v1/endpoints/
    exceptions.py) for why: this is a bounded human-work queue, not a full history, and
    hiding a large critical backlog behind pages would be unsafe.
    """
    stmt = (
        _exception_read_query()
        .where(
            Trip.operator_organization_id == organization_id,
            TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
        )
        .order_by(_SEVERITY_RANK, TripException.created_at.desc(), TripException.id.desc())
    )
    rows = (await db.execute(stmt)).all()
    names = await user_names(
        db, organization_id=organization_id,
        user_ids=[uid for exc, *_ in rows for uid in (exc.claimed_by_user_id, exc.reviewed_by_user_id)],
    )
    contexts = await _load_trip_contexts(db, (row[1] for row in rows))
    return [
        _to_list_item(exc, trip, phase_type, stop_sequence, names, contexts.get(trip.id))
        for exc, trip, phase_type, stop_sequence in rows
    ]


async def list_exception_history(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    limit: int = 25,
    cursor: str | None = None,
    q: str | None = None,
    review_status: ExceptionReviewStatus | None = None,
    severity: ExceptionSeverity | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> CursorPage[TripExceptionListItem]:
    """Recorded/reviewed exceptions (never needs_review — that's the review queue's own
    job), newest first, cursor-paginated on (created_at, id).

    Raises ValueError (propagated from decode_cursor, uncaught here) for a malformed
    cursor — the caller maps that to a 422. Decoded before either query below runs, so
    a bad cursor fails before any work is done on its behalf.

    from_date/to_date are SA (UTC+settings.OPERATIONS_UTC_OFFSET_HOURS) calendar dates,
    both inclusive — see phases.scheduling.operating_day for the inverse conversion this
    mirrors. The exclusive upper bound (start of the day AFTER to_date, in SA time) is
    what makes to_date read as inclusive rather than as a UTC midnight cutoff that would
    silently exclude the tail of that SA day.
    """
    cursor_position = decode_cursor(cursor) if cursor is not None else None

    filters = [
        Trip.operator_organization_id == organization_id,
        TripException.review_status.in_(_HISTORY_REVIEW_STATUSES),
    ]
    if q is not None:
        filters.append(or_(
            Trip.trip_reference.icontains(q, autoescape=True),
            TripException.description.icontains(q, autoescape=True),
        ))
    if review_status is not None:
        # ANDed with the base recorded/reviewed filter above rather than replacing it —
        # a caller passing needs_review legitimately gets zero rows, which is correct
        # and must not be special-cased or rejected.
        filters.append(TripException.review_status == review_status)
    if severity is not None:
        filters.append(TripException.severity == severity)
    if from_date is not None or to_date is not None:
        sa_tz = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))
        if from_date is not None:
            filters.append(TripException.created_at >= datetime.combine(from_date, time.min, tzinfo=sa_tz))
        # date.max has no representable day-after boundary. Omitting the upper
        # predicate in that one case preserves inclusive semantics because no
        # Python/driver timestamp can fall beyond the maximum calendar date.
        if to_date is not None and to_date < date.max:
            filters.append(
                TripException.created_at < datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=sa_tz)
            )

    # Same filter set as the page query below, applied independently rather than
    # derived from it — total_items must reflect every matching row regardless of
    # limit/cursor, which a query already sliced by LIMIT/keyset cannot answer.
    count_stmt = (
        select(func.count())
        .select_from(TripException)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(*filters)
    )
    total_items = (await db.execute(count_stmt)).scalar_one()

    page_stmt = (
        _exception_read_query()
        .where(*filters)
        .order_by(TripException.created_at.desc(), TripException.id.desc())
        .limit(limit + 1)
    )
    if cursor_position is not None:
        # A tuple comparison, not two ANDed column comparisons: the latter cannot
        # correctly express "strictly below this point in a (created_at, id) ordering"
        # and would duplicate or skip rows across a page boundary whenever two rows
        # share a created_at value (see _HISTORY_REVIEW_STATUSES's neighbour
        # test_history_pagination_has_no_duplicates_or_omissions_with_tied_timestamps).
        page_stmt = page_stmt.where(
            tuple_(TripException.created_at, TripException.id)
            < tuple_(literal(cursor_position.created_at), literal(cursor_position.id))
        )

    rows = (await db.execute(page_stmt)).all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]

    names = await user_names(
        db, organization_id=organization_id,
        user_ids=[uid for exc, *_ in page_rows for uid in (exc.claimed_by_user_id, exc.reviewed_by_user_id)],
    )
    contexts = await _load_trip_contexts(db, (row[1] for row in page_rows))
    items = [
        _to_list_item(exc, trip, phase_type, stop_sequence, names, contexts.get(trip.id))
        for exc, trip, phase_type, stop_sequence in page_rows
    ]

    next_cursor: str | None = None
    if has_more:
        last_exc = page_rows[-1][0]
        next_cursor = encode_cursor(CursorPosition(created_at=last_exc.created_at, id=last_exc.id))

    return CursorPage[TripExceptionListItem](items=items, next_cursor=next_cursor, total_items=total_items)


async def get_exception_detail(
    db: AsyncSession, *, exception_id: uuid.UUID, organization_id: uuid.UUID,
) -> TripExceptionDetail:
    """One exception, any review state, any trip lifecycle — a permalink target.

    Org-scoped by the same Trip join review_exception uses. Raises
    ResourceNotFoundError (-> 404, not 403) for a missing or cross-organisation id — a
    403 would confirm the row exists to a dispatcher with no right to know that.
    """
    row = (await db.execute(
        _exception_read_query().where(
            TripException.id == exception_id,
            Trip.operator_organization_id == organization_id,
        )
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripException", str(exception_id))
    exc, trip, phase_type, stop_sequence = row

    # Never trust supporting_artifact_id on its own — get_trip_scoped_artifact
    # re-checks ownership at read time exactly as raise_exception's own comment on
    # this same invariant explains: the FK alone only proves the artifact exists
    # SOMEWHERE, not that it belongs to THIS trip.
    supporting_artifact = None
    if exc.supporting_artifact_id is not None:
        supporting_artifact = await get_trip_scoped_artifact(
            db, artifact_id=exc.supporting_artifact_id, trip_id=exc.trip_id,
        )

    # Looked up only for a breakdown that recorded its vehicle. Scoped to the
    # organisation, the same as the analytics vehicle names. The id always comes from
    # this trip's own horse or trailers, so a miss means the vehicle row is gone. The
    # id is still returned, with no registration, rather than hidden.
    vehicle_registration: str | None = None
    vehicle_type: VehicleType | None = None
    if exc.vehicle_id is not None:
        vehicle_row = (await db.execute(
            select(Vehicle.registration, Vehicle.vehicle_type).where(
                Vehicle.id == exc.vehicle_id,
                Vehicle.organization_id == organization_id,
            )
        )).one_or_none()
        if vehicle_row is not None:
            vehicle_registration, vehicle_type = vehicle_row

    names = await user_names(
        db, organization_id=organization_id,
        user_ids=[exc.claimed_by_user_id, exc.reviewed_by_user_id],
    )
    context = (await _load_trip_contexts(db, [trip])).get(trip.id)
    list_item = _to_list_item(exc, trip, phase_type, stop_sequence, names, context)
    return TripExceptionDetail(
        **list_item.model_dump(),
        gps_lat=exc.gps_lat,
        gps_lng=exc.gps_lng,
        review_outcome=exc.review_outcome,
        reviewed_by_user_id=exc.reviewed_by_user_id,
        reviewed_at=exc.reviewed_at,
        review_note=exc.review_note,
        contact_method=exc.contact_method,
        trip_closed_at=trip.closed_at,
        vehicle_id=exc.vehicle_id,
        vehicle_registration=vehicle_registration,
        vehicle_type=vehicle_type,
        supporting_artifact_id=exc.supporting_artifact_id,
        supporting_artifact=supporting_artifact,
    )
