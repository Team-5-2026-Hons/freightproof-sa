"""Report an incident: from a phone call, a client email, or an exception already in FreightProof.

One transaction writes the incident, its OPENED entry, its owner, the exceptions it groups, the
parcels it names and, when asked, the trip stop — so a report can never land half-written. A
report is recorded as what it is (who said what, when, how sure): a client's phone call stays
REPORTED and never becomes a system-confirmed theft by being written down.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import IncidentInvalidError, ResourceNotFoundError, TripStateError
from app.db.models.enums import IncidentStatus, IncidentUpdateKind, TripStatus
from app.db.models.incidents import Incident
from app.db.models.trips import Trip
from app.orchestration.incidents import guards
from app.orchestration.incidents.ledger import Entry, OpenLedger, append, lock_incident, notify, start
from app.orchestration.incidents.links import add_parcel, link_exception
from app.orchestration.incidents.state import ensure_open
from app.orchestration.trips.administration import terminate_trip
from app.schemas.incidents import IncidentCreate

# A dispatcher's clock and the server's disagree by seconds, not minutes: anything further in
# the future than this is a typing mistake, and a report "received" tomorrow is not evidence.
CLOCK_SKEW_ALLOWANCE = timedelta(minutes=5)

_TERMINAL_TRIP_STATUSES = (TripStatus.CLOSED, TripStatus.CANCELLED)

# What the trip's ledger says when an incident stops it: neutral on purpose (see _stop_trip).
TRIP_STOPPED_NOTE = "Trip stopped by dispatch."


def reference(incident: Incident) -> str:
    """INC1, INC2… per trip, read alongside the trip reference."""
    return f"INC{incident.incident_number}"


async def _lock_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    # Held for the whole report: it serialises incident numbering on this trip and makes the
    # stop's terminal-status check and write one atomic step, exactly as cancel_trip does.
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id).with_for_update(of=Trip)
        # The Trip may already be in the session (stop_trip_from_incident loads it through
        # lock_incident first). Without this the lock is taken but the stale status is kept,
        # and a colleague's cancel that landed meanwhile would be cancelled a second time.
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


def _check_times(request: IncidentCreate, now: datetime) -> datetime:
    received_at = request.received_at or now
    latest = now + CLOCK_SKEW_ALLOWANCE
    if received_at > latest or (request.reported_occurred_at is not None and request.reported_occurred_at > latest):
        raise IncidentInvalidError("An incident cannot be reported as happening or received in the future.")
    if request.reported_occurred_at is not None and request.reported_occurred_at > received_at:
        raise IncidentInvalidError("reported_occurred_at cannot be after received_at.")
    return received_at


async def _validate(
    db: AsyncSession, trip: Trip, request: IncidentCreate, *, organization_id: uuid.UUID, assignee: uuid.UUID,
) -> list[uuid.UUID]:
    """Every check before anything is written. Returns the parcels the incident names."""
    if request.stop_trip and trip.status in _TERMINAL_TRIP_STATUSES:
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action="stop")
    await guards.assert_exceptions_on_trip(db, trip_id=trip.id, exception_ids=request.exception_ids)
    await guards.assert_exceptions_unlinked(db, exception_ids=request.exception_ids)
    await guards.assert_colleague(db, user_id=assignee, organization_id=organization_id)
    if request.all_parcels:
        return await guards.trip_parcel_ids(db, trip_id=trip.id)
    await guards.assert_parcels_on_trip(db, trip_id=trip.id, parcel_ids=request.parcel_ids)
    return list(request.parcel_ids)


async def _next_number(db: AsyncSession, trip_id: uuid.UUID) -> int:
    current = (await db.execute(
        select(func.max(Incident.incident_number)).where(Incident.trip_id == trip_id)
    )).scalar_one_or_none()
    return (current or 0) + 1


async def _stop_trip(db: AsyncSession, ledger: OpenLedger, *, user_id: uuid.UUID, at: datetime) -> None:
    """Cancel the trip through the same path cancel_trip uses.

    The trip's own note says only that dispatch stopped it — no incident, no type. The
    driver's trip read carries every exception on the trip, dispatcher notes included, and
    after a hijacking the phone may be in someone else's hands. The link to the incident is
    kept on the incident side instead: its TRIP_STOPPED entry and trip_stopped_at.
    """
    await terminate_trip(db, trip=ledger.trip, user_id=user_id, note=TRIP_STOPPED_NOTE)
    ledger.incident.trip_stopped_at = at
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.TRIP_STOPPED, user_id=user_id, at=at,
        note=f"Trip stopped from {reference(ledger.incident)}.", to_value=TripStatus.CANCELLED.value,
    ))


async def report_incident(
    db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID, request: IncidentCreate,
) -> Incident:
    """Raises ResourceNotFoundError (404), TripStateError (409, stopping a finished trip),
    ExceptionAlreadyInIncidentError (409) and IncidentInvalidError (422)."""
    trip = await _lock_trip(db, trip_id=trip_id, organization_id=organization_id)
    now = datetime.now(UTC)
    received_at = _check_times(request, now)
    assignee = request.assigned_to_user_id or user_id
    parcel_ids = await _validate(db, trip, request, organization_id=organization_id, assignee=assignee)

    incident = Incident(
        id=uuid.uuid4(), trip_id=trip.id, incident_number=await _next_number(db, trip.id),
        incident_type=request.incident_type, summary=request.summary, reported_by_name=request.reported_by_name,
        reporter_role=request.reporter_role, report_channel=request.report_channel,
        reported_occurred_at=request.reported_occurred_at, received_at=received_at, recorded_by_user_id=user_id,
        status=IncidentStatus.OPEN, confidence=request.confidence, created_at=now, updated_at=now,
    )
    db.add(incident)
    ledger = start(db, incident=incident, trip=trip, opened=Entry(
        kind=IncidentUpdateKind.OPENED, user_id=user_id, at=now, note=request.summary, to_value=request.confidence.value,
    ))
    # The owner is on the ledger from the first moment, not only in the cache.
    append(db, ledger, Entry(kind=IncidentUpdateKind.ASSIGNED, user_id=user_id, at=now, to_value=str(assignee)))
    await db.flush()

    for exception_id in request.exception_ids:
        await link_exception(db, ledger, exception_id=exception_id, entry=Entry(
            kind=IncidentUpdateKind.EXCEPTION_LINKED, user_id=user_id, at=now, exception_id=exception_id,
        ))
    for parcel_id in parcel_ids:
        add_parcel(db, ledger, parcel_id=parcel_id, user_id=user_id, at=now)
    if request.stop_trip:
        await _stop_trip(db, ledger, user_id=user_id, at=now)

    await db.flush()
    notify(db, ledger)
    return incident


async def stop_trip_from_incident(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
) -> Incident:
    """Stop the trip of an incident recorded without stopping it — the dispatcher decided later.

    Locks the incident, then its trip (the order report_incident cannot contend with: it locks
    only the trip, and only before its incident exists). Raises ResourceNotFoundError (404),
    IncidentClosedError (409) and TripStateError (409, the trip already ended).
    """
    ledger = await lock_incident(db, incident_id=incident_id, organization_id=organization_id)
    ensure_open(ledger.state, incident_id=incident_id)
    trip = await _lock_trip(db, trip_id=ledger.trip.id, organization_id=organization_id)
    if trip.status in _TERMINAL_TRIP_STATUSES:
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action="stop")
    await _stop_trip(db, ledger, user_id=user_id, at=datetime.now(UTC))
    await db.flush()
    notify(db, ledger)
    return ledger.incident
