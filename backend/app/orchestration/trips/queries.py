"""Driver-scoped trip reads, behind GET /trips/me/active, GET /trips/me and
GET /trips/me/{trip_id}. Each query selects trips by the driver_id its endpoint passes in (the
verified driver's id), never by organisation, and every full trip detail it returns goes through
_driver_view, which clears the PP manifest key the driver app must not receive. Nothing here
writes.
"""

import uuid

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, TripStatus
from app.db.models.organisations import Precinct
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.resource_service import get_trip_detail
from app.schemas.trips import DriverTripListItemResponse, TripDetailResponse


async def get_active_trip_for_driver(db: AsyncSession, driver_id: uuid.UUID) -> TripDetailResponse | None:
    """Return the trip the driver is currently working, or None. Excludes closed/cancelled.

    Nothing at trip creation stops a dispatcher assigning a second trip while the
    driver's current one sits in exception_hold, so more than one non-terminal row
    can legitimately exist — scalar_one_or_none() would turn that into a 500 for
    the driver, so one row is picked instead.

    Which row matters. Ordering by created_at alone (the original behaviour) let a
    freshly-assigned CREATED trip outrank the trip the driver was physically in the
    middle of driving, because the dispatcher had assigned it more recently: Home
    would swap to tomorrow's un-activated assignment mid-journey. A trip the driver
    has actually activated therefore outranks a mere assignment.

    Within a rank the SOONEST departure wins, not the newest row. created_at is when
    the dispatcher happened to type the trip in, which has nothing to do with the
    order the driver runs them: two assignments captured back-to-back, one leaving on
    the 5th and one on the 6th, handed Home the 6th purely because it was saved last.
    Departure order is also the order the driver is permitted to work in —
    phases.scheduling's activation gates refuse a trip while an earlier one that day is
    still unstarted — so this makes Home agree with what the driver can actually do.

    A departure already in the past therefore still sorts first: an assignment that
    should have left this morning is overdue, not stale, and hiding it behind
    tomorrow's would leave the driver looking at the wrong job. Trips with no planned
    departure at all sort last — unscheduled cannot be "next".

    CREATED stays eligible as a fallback rather than being excluded outright: the
    Activation phase (which is what flips CREATED -> ACTIVE) is reached through
    this trip, so a driver whose only trip is an un-activated assignment must still
    be handed it or they could never start work.
    """
    inactive = {TripStatus.CLOSED, TripStatus.CANCELLED}
    # Rank, not sort key: every underway status shares rank 0 so departure order still
    # decides between two of them. ACTIVE and EXCEPTION_HOLD are peers — a held trip
    # is still the trip the driver is on, it is just blocked from advancing.
    underway_first = case(
        (Trip.status.in_((TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD)), 0),
        else_=1,
    )
    result = await db.execute(
        select(Trip)
        .where(Trip.driver_id == driver_id, Trip.status.notin_(inactive))
        .order_by(
            underway_first,
            Trip.planned_departure_at.asc().nulls_last(),
            # Last resort only, for two trips leaving at the same minute (or two
            # unscheduled ones): keeps the result deterministic instead of letting
            # Postgres return whichever row it reaches first.
            Trip.created_at.desc(),
        )
    )
    trip = result.scalars().first()
    if trip is None:
        return None
    # Deliberate asymmetry with GET /trips/{id} (which strips receipts for
    # non-admin dispatchers): the driver's own active trip keeps its
    # blockchain_receipts because the PWA anchor UI renders them. Receipts
    # carry hashes/tx ids only — no PII (POPIA-safe). Covered by
    # test_active_trip_includes_receipts_for_driver.
    return _driver_view(
        await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
    )


def _driver_view(detail: TripDetailResponse) -> TripDetailResponse:
    """The dispatcher's trip detail minus what the driver app must not receive. The PP
    manifest key names the client's manifest: dispatcher context, never shown to the
    driver, who identifies a trip by trip_reference (FP-281 §12)."""
    return detail.model_copy(update={"pp_manifest": None})


async def list_trips_for_driver(
    db: AsyncSession, driver_id: uuid.UUID
) -> list[DriverTripListItemResponse]:
    """Every trip assigned to this driver, newest first — backs GET /trips/me.

    Scoped by driver_id alone, never by organisation: a driver is assigned trips
    directly and has no dispatcher org context to filter on. This is the whole
    authorisation boundary for the endpoint, which is why the driver_id comes from
    the verified token (get_current_driver) and never from the request.

    Returns all statuses including CLOSED and CANCELLED. The PWA needs the terminal
    rows to populate its Past tab, and grouping is the client's job — filtering them
    out here would make a completed-trip history impossible to build.
    """
    trips = (
        (
            await db.execute(
                select(Trip)
                .where(Trip.driver_id == driver_id)
                .order_by(Trip.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    # Batched, not per-row: same N+1 guard as resource_service.list_trips().
    # Both FKs are nullable on Trip, so Nones are dropped before the IN clause.
    precinct_ids = {
        pid
        for t in trips
        for pid in (t.origin_precinct_id, t.destination_precinct_id)
        if pid is not None
    }
    precinct_names: dict[uuid.UUID, str] = {
        p.id: p.name
        for p in (
            await db.execute(select(Precinct).where(Precinct.id.in_(precinct_ids)))
        )
        .scalars()
        .all()
    }

    def precinct_name(precinct_id: uuid.UUID | None) -> str | None:
        return None if precinct_id is None else precinct_names.get(precinct_id)

    # Unreviewed CRITICAL rows only. Since FP-280 every exception starts needs_review,
    # but the driver has no review action at all (see FP-146 follow-on): a count of
    # routine warnings they can neither act on nor clear is noise on their trip card.
    # The dispatcher-facing counts deliberately include every severity.
    exc_counts: dict[uuid.UUID, int] = {
        row[0]: row[1]
        for row in (
            await db.execute(
                select(TripException.trip_id, func.count(TripException.id))
                .where(
                    TripException.trip_id.in_(trip_ids),
                    TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
                    TripException.severity == ExceptionSeverity.CRITICAL,
                )
                .group_by(TripException.trip_id)
            )
        ).all()
    }

    return [
        DriverTripListItemResponse(
            id=t.id,
            trip_reference=t.trip_reference,
            status=t.status,
            trip_type=t.trip_type,
            origin_precinct_id=t.origin_precinct_id,
            destination_precinct_id=t.destination_precinct_id,
            origin_precinct_name=precinct_name(t.origin_precinct_id),
            destination_precinct_name=precinct_name(t.destination_precinct_id),
            planned_departure_at=t.planned_departure_at,
            actual_departure_at=t.actual_departure_at,
            planned_arrival_at=t.planned_arrival_at,
            actual_arrival_at=t.actual_arrival_at,
            needs_review_count=exc_counts.get(t.id, 0),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in trips
    ]


async def get_own_trip_detail_for_driver(
    db: AsyncSession, *, driver_id: uuid.UUID, trip_id: uuid.UUID
) -> TripDetailResponse:
    """Full detail for one of THIS driver's trips — backs GET /trips/me/{trip_id}.

    Raises ResourceNotFoundError when the trip does not exist OR belongs to another
    driver. The two are deliberately indistinguishable: a driver enumerating trip
    UUIDs must not be able to tell a real trip from a stranger's one, so a
    404 covers both rather than a 403 confirming existence.

    Same receipt asymmetry as get_active_trip_for_driver — the driver keeps
    blockchain_receipts (hashes and tx ids only, no PII) because the PWA renders
    the anchor state.
    """
    trip = (
        await db.execute(
            select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id)
        )
    ).scalars().first()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return _driver_view(
        await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id)
    )
