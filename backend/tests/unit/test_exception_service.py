"""FP-146 — resolve_exception and list_exceptions at the service level.

Complements tests/integration/test_exceptions_dispatcher.py rather than repeating it.
The integration tests own the HTTP contract (status codes, request shape); these own the
things HTTP cannot see — that the resolver comes from the caller's identity rather than
anything in the payload, and that a resolution reaches the realtime outbox before the
transaction commits.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.exceptions import ExceptionAlreadyResolvedError, ResourceNotFoundError
from app.core.realtime import EventSeverity, RealtimeKind
from app.db.models.enums import (
    ExceptionResolutionMethod,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.exception_service import list_exceptions, resolve_exception

_OUTBOX_KEY = "realtime_outbox"

_NOTE = "Phoned the depot; the seal was cut during a lawful SARS inspection."


async def _seed(db_session, *, tag: str) -> dict:
    """One operator org with a trip and one unresolved exception on it."""
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"disp-{tag}@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RG{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="O", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="D", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    exc = TripException(
        id=uuid.uuid4(), trip_id=trip.id,
        exception_type=ExceptionType.SEAL_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.CRITICAL,
        description="Seal at destination does not match departure.",
    )
    db_session.add(exc)
    await db_session.flush()

    return {"org": org, "user": user, "trip": trip, "exception": exc}


def _outbox(db_session) -> list:
    return db_session.info.get(_OUTBOX_KEY, [])


async def _resolve(db_session, seed, **overrides):
    kwargs = {
        "exception_id": seed["exception"].id,
        "user_id": seed["user"].id,
        "organization_id": seed["org"].id,
        "resolver_note": _NOTE,
        "resolution_method": ExceptionResolutionMethod.PHONED,
    }
    kwargs.update(overrides)
    return await resolve_exception(db_session, **kwargs)


# ── resolve ──────────────────────────────────────────────────────────────────


async def test_resolve_sets_the_resolver_from_the_caller(db_session):
    """The identity is an argument, never a field on the request body. This is the whole
    reason resolve_exception takes a narrow note+method instead of TripExceptionUpdate,
    which would have let a caller name someone else as the resolver."""
    seed = await _seed(db_session, tag="resolver")

    before = datetime.now(UTC)
    await _resolve(db_session, seed)

    exc = seed["exception"]
    assert exc.resolved is True
    assert exc.resolved_by_user_id == seed["user"].id
    # == not is: resolution_method is a String(20) column (matching severity/source on
    # this table), so it round-trips as a plain str. ExceptionResolutionMethod subclasses
    # str, which makes equality work and identity fail.
    assert exc.resolution_method == ExceptionResolutionMethod.PHONED
    assert exc.resolver_note == _NOTE
    # Set by this process, not by the database — deliberately asserted against the Python
    # clock. The test database's own clock cannot be trusted for this (known-issues §6).
    assert before - timedelta(seconds=5) <= exc.resolved_at <= datetime.now(UTC)


async def test_resolve_refuses_another_organisations_exception(db_session):
    """Org scoping is authorisation. A dispatcher holding a valid token for their own
    org must not reach another operator's row by guessing its id."""
    mine = await _seed(db_session, tag="mine")
    theirs = await _seed(db_session, tag="theirs")

    with pytest.raises(ResourceNotFoundError):
        await _resolve(
            db_session, mine,
            exception_id=theirs["exception"].id,  # their row, my credentials
        )

    assert theirs["exception"].resolved is False


async def test_resolve_of_an_unknown_id_raises(db_session):
    seed = await _seed(db_session, tag="unknown")

    with pytest.raises(ResourceNotFoundError):
        await _resolve(db_session, seed, exception_id=uuid.uuid4())


async def test_the_same_dispatcher_resolving_twice_is_idempotent(db_session):
    """A double-tap or a retried request from the SAME dispatcher carries the same
    account, so nothing is lost by returning the stored row unchanged. This is the case
    the offline/replay path depends on and it must not raise."""
    seed = await _seed(db_session, tag="twice")

    first = await _resolve(db_session, seed)
    second = await _resolve(
        db_session, seed,
        resolver_note="A different account of the same incident.",
        resolution_method=ExceptionResolutionMethod.IN_PERSON,
    )

    assert second.resolved_at == first.resolved_at
    assert second.resolver_note == _NOTE
    assert second.resolution_method is ExceptionResolutionMethod.PHONED


async def test_a_second_dispatcher_resolving_is_told_they_lost(db_session):
    """The first account stays the record — but the second dispatcher must not be told
    their note was recorded when it was discarded. They may have established something
    the first resolver did not, and on an evidence platform a silent drop is the failure.
    """
    seed = await _seed(db_session, tag="race")
    await _resolve(db_session, seed)
    other_dispatcher = User(
        id=uuid.uuid4(), organization_id=seed["org"].id,
        email="second-race@test.co.za", full_name="Second Dispatcher",
    )
    db_session.add(other_dispatcher)
    await db_session.flush()

    with pytest.raises(ExceptionAlreadyResolvedError):
        await _resolve(
            db_session, seed,
            user_id=other_dispatcher.id,
            resolver_note="Phoned the driver; he says the inspection was at Beitbridge.",
            resolution_method=ExceptionResolutionMethod.IN_PERSON,
        )

    # The first account survives untouched — the raise is about telling the loser, not
    # about protecting the row, which was never at risk.
    exc = seed["exception"]
    assert exc.resolver_note == _NOTE
    assert exc.resolved_by_user_id == seed["user"].id


async def test_a_resolve_with_no_recorded_resolver_counts_as_a_conflict(db_session):
    """A row resolved before resolved_by_user_id was captured cannot be proved to belong
    to this caller, so it is treated as someone else's. Guessing 'probably them' would
    let the NULL case silently discard a note."""
    seed = await _seed(db_session, tag="legacy")
    exc = seed["exception"]
    exc.resolved = True
    exc.resolved_by_user_id = None
    await db_session.flush()

    with pytest.raises(ExceptionAlreadyResolvedError):
        await _resolve(db_session, seed)


async def test_resolve_enqueues_an_info_event(db_session):
    """Other dispatchers are looking at the same queue, so the list must refresh — but a
    resolution is progress, not an alarm, and must not interrupt anyone mid-shift.

    Only visible here: the integration client commits, which drains the outbox.
    """
    seed = await _seed(db_session, tag="emit")

    await _resolve(db_session, seed)

    assert len(_outbox(db_session)) == 1
    org_id, event = _outbox(db_session)[0]
    assert org_id == seed["org"].id
    assert event.id == seed["trip"].id
    assert event.kind is RealtimeKind.EXCEPTION_RAISED
    assert event.severity is EventSeverity.INFO


async def test_a_suppressed_repeat_resolve_enqueues_nothing(db_session):
    """No new record, no new event — the same rule the scan-discrepancy emit follows."""
    seed = await _seed(db_session, tag="emit-twice")
    await _resolve(db_session, seed)
    db_session.info.pop(_OUTBOX_KEY, None)

    await _resolve(db_session, seed)

    assert _outbox(db_session) == []


# ── list ─────────────────────────────────────────────────────────────────────


async def test_list_is_scoped_to_the_organisation(db_session):
    mine = await _seed(db_session, tag="l-mine")
    theirs = await _seed(db_session, tag="l-theirs")

    rows = await list_exceptions(db_session, organization_id=mine["org"].id)

    assert [r.id for r in rows] == [mine["exception"].id]
    assert theirs["exception"].id not in {r.id for r in rows}


async def test_list_returns_newest_first(db_session):
    """This backs a queue a dispatcher works down; the thing that just happened is the
    thing they need to see."""
    seed = await _seed(db_session, tag="order")
    older = TripException(
        id=uuid.uuid4(), trip_id=seed["trip"].id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        description="Earlier finding.",
    )
    db_session.add(older)
    await db_session.flush()

    # BOTH timestamps stamped from one Python base, rather than letting either take the
    # created_at server default. The default is func.now(), and the test database's clock
    # runs days behind the host (known-issues §6) — so a row the database stamps is not
    # reliably "later" than one this process stamps, and an ordering test built on that
    # mixture asserts the container's clock rather than the ORDER BY.
    base = datetime.now(UTC)
    seed["exception"].created_at = base
    older.created_at = base - timedelta(hours=3)
    await db_session.flush()

    rows = await list_exceptions(db_session, organization_id=seed["org"].id)

    assert [r.id for r in rows] == [seed["exception"].id, older.id]


async def test_list_without_a_filter_includes_resolved_rows(db_session):
    """`resolved=None` is not `resolved=False`. The detail page opens an exception by id
    without knowing its state, so an unresolved-only default would make a resolved
    exception unreachable from its own permalink."""
    seed = await _seed(db_session, tag="l-all")
    await _resolve(db_session, seed)

    all_rows = await list_exceptions(db_session, organization_id=seed["org"].id)
    open_rows = await list_exceptions(
        db_session, organization_id=seed["org"].id, resolved=False,
    )

    assert [r.id for r in all_rows] == [seed["exception"].id]
    assert open_rows == []
