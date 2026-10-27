"""Driver-scoped trip reads, behind GET /trips/me/active, GET /trips/me and
GET /trips/me/{trip_id}. Each query selects trips by the driver_id its endpoint passes in (the
verified driver's id), never by organisation, and every full trip detail it returns goes through
_driver_view, which clears the PP manifest key the driver app must not receive. Nothing here
writes.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, TripStatus
from app.db.models.organisations import Precinct
from app.db.models.transit import TripException
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions.access import (
    CompletedCustodyLink, completed_links_by_trip, current_driver_id_expression, custody_holders,
    custody_holders_from_links, require_current_driver_with_links,
)
from app.orchestration.trips.detail import TripReadFacts, get_trip_detail
from app.schemas.driver_substitutions import DriverAccess, DriverParticipation
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
    underway_first = case(
        (Trip.status.in_((TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD)), 0),
        else_=1,
    )
    result = await db.execute(
        select(Trip)
        .where(
            current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id) == driver_id,
            Trip.status.notin_(inactive),
        )
        .order_by(
            underway_first,
            Trip.planned_departure_at.asc().nulls_last(),
            Trip.created_at.desc(),
        )
    )
    trip = result.scalars().first()
    if trip is None:
        return None
    return await _driver_view(
        db, await get_trip_detail(db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id),
        trip=trip, driver_id=driver_id,
    )


async def _driver_view(
    db: AsyncSession, detail: TripDetailResponse, *, trip: Trip, driver_id: uuid.UUID,
    links: Sequence[CompletedCustodyLink] | None = None,
) -> TripDetailResponse:
    """The dispatcher's trip detail minus what the driver app must not receive. The PP
    manifest key names the client's manifest: dispatcher context, never shown to the
    driver, who identifies a trip by trip_reference (FP-281 §12).

    FP-83: the caller here is always the CURRENT driver (both callers resolve that first). They
    get driver_access, whose custody_sequence their live writes must carry, and none of the
    dispatcher's substitution context: no original-driver record (another person's details),
    no request list, integrity result or flag.
    """
    holders = (
        custody_holders_from_links(trip.driver_id, links) if links is not None
        else await custody_holders(db, trip=trip)
    )
    earlier = any(holder == driver_id and seq != detail.custody_sequence for seq, holder in holders.items())
    return detail.model_copy(update={
        "pp_manifest": None, "original_driver": None, "driver_substitutions": [],
        "pending_driver_substitution": None, "custody_integrity": None, "driver_substitutions_enabled": None,
        "driver_access": DriverAccess(
            participation=DriverParticipation.CURRENT, custody_sequence=detail.custody_sequence,
            can_advance=TripStatus(detail.status) not in (TripStatus.CLOSED, TripStatus.CANCELLED),
            can_submit_late_evidence=earlier,
        ),
    })


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
    held_later = select(DriverSubstitution.trip_id).where(or_(
        DriverSubstitution.original_driver_id == driver_id, DriverSubstitution.substituting_driver_id == driver_id,
    ))
    trips = (
        (
            await db.execute(
                select(Trip)
                .where(or_(Trip.driver_id == driver_id, Trip.id.in_(held_later)))
                .order_by(Trip.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not trips:
        return []

    trip_ids = [t.id for t in trips]

    links_by_trip = await completed_links_by_trip(db, trip_ids=trip_ids)
    participation = {t.id: _participation(t, links_by_trip[t.id], driver_id) for t in trips}

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

    exc_counts = await _critical_exception_counts(db, trip_ids)

    return [
        _driver_list_item(
            t, precinct_names=precinct_names, needs_review_count=exc_counts.get(t.id, 0),
            participation=participation[t.id],
        )
        for t in trips
    ]


async def _critical_exception_counts(db: AsyncSession, trip_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Unreviewed critical exceptions per trip, for the driver's trip cards."""
    return {
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


def _driver_list_item(
    trip: Trip, *, precinct_names: dict[uuid.UUID, str], needs_review_count: int,
    participation: tuple[DriverParticipation, datetime | None, int],
) -> DriverTripListItemResponse:
    """Build a card from the batched reads; rendering a row must never issue another query."""
    def precinct_name(precinct_id: uuid.UUID | None) -> str | None:
        return None if precinct_id is None else precinct_names.get(precinct_id)

    return DriverTripListItemResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        status=trip.status,
        trip_type=trip.trip_type,
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        origin_precinct_name=precinct_name(trip.origin_precinct_id),
        destination_precinct_name=precinct_name(trip.destination_precinct_id),
        planned_departure_at=trip.planned_departure_at,
        actual_departure_at=trip.actual_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        actual_arrival_at=trip.actual_arrival_at,
        needs_review_count=needs_review_count,
        participation=participation[0],
        last_participation_ended_at=participation[1],
        custody_sequence=participation[2],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


def _participation(
    trip: Trip, links: list[CompletedCustodyLink], driver_id: uuid.UUID,
) -> tuple[DriverParticipation, datetime | None, int]:
    """(current or former, when the caller's last period ended, the sequence to show). A current
    holder sees the live sequence; a former one sees their own last period, never a later one's."""
    holders = custody_holders_from_links(trip.driver_id, links)
    current_sequence = max(holders)
    if holders[current_sequence] == driver_id:
        return DriverParticipation.CURRENT, None, current_sequence
    last_own = max(seq for seq, holder in holders.items() if holder == driver_id)
    ended = next(link.effective_at for link in links if link.sequence_number == last_own + 1)
    return DriverParticipation.FORMER, ended, last_own


async def get_own_trip_detail_for_driver(
    db: AsyncSession, *, driver_id: uuid.UUID, trip_id: uuid.UUID
) -> TripDetailResponse:
    """Full detail for one of THIS driver's trips — backs GET /trips/me/{trip_id}.

    Raises ResourceNotFoundError when the trip does not exist OR this driver never held it.
    The two are deliberately indistinguishable: a driver enumerating trip
    UUIDs must not be able to tell a real trip from a stranger's one, so a
    404 covers both rather than a 403 confirming existence.

    Same receipt asymmetry as get_active_trip_for_driver — the driver keeps
    blockchain_receipts (hashes and tx ids only, no PII) because the PWA renders
    the anchor state.
    """
    held = await require_current_driver_with_links(db, trip_id=trip_id, driver_id=driver_id)
    trip = held.trip
    detail = await get_trip_detail(
        db, trip_id=trip.id, operator_organization_id=trip.operator_organization_id,
        facts=TripReadFacts(trip=trip, custody_links=held.links),
    )
    return await _driver_view(db, detail, trip=trip, driver_id=driver_id, links=held.links)
