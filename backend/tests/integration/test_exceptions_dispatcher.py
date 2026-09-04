"""FP-146 — the dispatcher's org-scoped exception list and the resolve action.

Two organisations are seeded throughout, not one. Org scoping here is an authorisation
boundary rather than a convenience filter, and a single-org fixture cannot tell a query
that scopes correctly from one that scopes not at all — both return the same rows.
"""

import uuid

import pytest_asyncio
from httpx import AsyncClient

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
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_LIST = "/api/v1/exceptions"


def _resolve_url(exception_id: uuid.UUID) -> str:
    return f"/api/v1/exceptions/{exception_id}/resolve"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _seed_org_with_exception(db_session, *, tag: str) -> dict:
    """One operator org, one trip, one unresolved exception on it."""
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Client-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"dispatcher-{tag}@test.co.za", full_name=f"Dispatcher {tag}",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name=f"Driver {tag}",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"REG{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
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
        description=f"Seal mismatch on {tag}",
    )
    db_session.add(exc)
    await db_session.flush()

    return {"org": org, "user": user, "trip": trip, "exception": exc}


@pytest_asyncio.fixture
async def two_orgs(db_session) -> dict:
    return {
        "mine": await _seed_org_with_exception(db_session, tag="mine"),
        "theirs": await _seed_org_with_exception(db_session, tag="theirs"),
    }


def _headers(seed: dict) -> dict:
    return auth_header(make_token(
        sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id),
    ))


def _body(**overrides) -> dict:
    body = {
        "resolver_note": "Phoned the driver; seal was replaced by the depot after a lawful inspection.",
        "resolution_method": ExceptionResolutionMethod.PHONED.value,
    }
    body.update(overrides)
    return body


# ── list ─────────────────────────────────────────────────────────────────────


async def test_list_returns_only_the_callers_organisation(client: AsyncClient, two_orgs):
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]

    res = await client.get(_LIST, headers=_headers(mine))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()}
    assert str(mine["exception"].id) in ids
    assert str(theirs["exception"].id) not in ids


async def test_list_without_credentials_is_403(client: AsyncClient, two_orgs):
    """403, not 401 — the codebase-wide convention in get_current_dispatcher
    (auth/dependencies.py:207): absent credentials are 403, a token that cannot be used
    is 401. Asserted as the existing contract rather than changed, because that
    dependency guards every dispatcher endpoint on the API."""
    res = await client.get(_LIST)

    assert res.status_code == 403


async def test_list_with_a_token_for_an_unknown_user_is_401(client: AsyncClient, two_orgs):
    """The other half: credentials were presented and could not be honoured."""
    ghost = auth_header(make_token(
        sub=str(uuid.uuid4()), role="dispatcher",
        org_id=str(two_orgs["mine"]["org"].id),
    ))

    res = await client.get(_LIST, headers=ghost)

    assert res.status_code == 401


async def test_list_filters_on_resolved(client: AsyncClient, db_session, two_orgs):
    mine = two_orgs["mine"]
    mine["exception"].resolved = True
    await db_session.flush()

    open_only = await client.get(_LIST, params={"resolved": False}, headers=_headers(mine))
    closed_only = await client.get(_LIST, params={"resolved": True}, headers=_headers(mine))

    assert [r["id"] for r in open_only.json()] == []
    assert [r["id"] for r in closed_only.json()] == [str(mine["exception"].id)]


async def test_list_without_the_filter_returns_both_states(
    client: AsyncClient, db_session, two_orgs,
):
    """`resolved` omitted means all. The detail page looks one exception up by id
    without knowing its state, so an unresolved-only default would make a resolved
    exception unopenable from its own permalink."""
    mine = two_orgs["mine"]
    mine["exception"].resolved = True
    await db_session.flush()

    res = await client.get(_LIST, headers=_headers(mine))

    assert [r["id"] for r in res.json()] == [str(mine["exception"].id)]


# ── resolve ──────────────────────────────────────────────────────────────────


async def test_resolve_records_all_five_columns(client: AsyncClient, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        _resolve_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.resolved is True
    assert exc.resolved_by_user_id == mine["user"].id
    assert exc.resolved_at is not None
    assert exc.resolver_note.startswith("Phoned the driver")
    assert exc.resolution_method == ExceptionResolutionMethod.PHONED


async def test_resolve_takes_the_resolver_from_the_token_not_the_body(
    client: AsyncClient, db_session, two_orgs,
):
    """The point of the narrow request body. A caller naming someone else as the
    resolver, at a time of their choosing, would make the one record whose purpose is to
    show who established what into the one record that cannot be trusted."""
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]
    impersonated = theirs["user"].id

    res = await client.patch(
        _resolve_url(mine["exception"].id),
        json=_body(resolved_by_user_id=str(impersonated), resolved_at="2020-01-01T00:00:00Z"),
        headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    # The extra fields were ignored, not honoured — the authenticated dispatcher owns
    # the resolution and the server owns the clock.
    assert mine["exception"].resolved_by_user_id == mine["user"].id
    assert mine["exception"].resolved_at.year != 2020


async def test_resolve_without_credentials_is_403(client: AsyncClient, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(_resolve_url(mine["exception"].id), json=_body())

    assert res.status_code == 403
    await db_session.refresh(mine["exception"])
    assert mine["exception"].resolved is False


async def test_resolve_with_a_token_for_an_unknown_user_is_401(
    client: AsyncClient, db_session, two_orgs,
):
    mine = two_orgs["mine"]
    ghost = auth_header(make_token(
        sub=str(uuid.uuid4()), role="dispatcher", org_id=str(mine["org"].id),
    ))

    res = await client.patch(_resolve_url(mine["exception"].id), json=_body(), headers=ghost)

    assert res.status_code == 401
    await db_session.refresh(mine["exception"])
    assert mine["exception"].resolved is False


async def test_resolve_across_organisations_is_404_not_403(
    client: AsyncClient, db_session, two_orgs,
):
    """404, deliberately. A 403 would confirm the exception exists to a dispatcher with
    no right to know that — the id is guessable in a way the contents are not."""
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]

    res = await client.patch(
        _resolve_url(theirs["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.status_code == 404
    await db_session.refresh(theirs["exception"])
    assert theirs["exception"].resolved is False


async def test_resolve_unknown_id_is_404(client: AsyncClient, two_orgs):
    res = await client.patch(
        _resolve_url(uuid.uuid4()), json=_body(), headers=_headers(two_orgs["mine"]),
    )

    assert res.status_code == 404


async def test_resolve_without_a_note_is_422(client: AsyncClient, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        _resolve_url(mine["exception"].id),
        json={"resolution_method": ExceptionResolutionMethod.PHONED.value},
        headers=_headers(mine),
    )

    assert res.status_code == 422


async def test_resolve_with_a_blank_note_is_422(client: AsyncClient, two_orgs):
    """A note of spaces is the informal handling this ticket exists to capture, dressed
    up as a record. RequiredFreeText strips before it validates."""
    mine = two_orgs["mine"]

    res = await client.patch(
        _resolve_url(mine["exception"].id),
        json=_body(resolver_note="   "),
        headers=_headers(mine),
    )

    assert res.status_code == 422


async def test_resolve_without_a_method_is_422(client: AsyncClient, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        _resolve_url(mine["exception"].id),
        json={"resolver_note": "Spoke to the depot manager."},
        headers=_headers(mine),
    )

    assert res.status_code == 422


async def test_the_same_dispatcher_resolving_twice_is_200(
    client: AsyncClient, db_session, two_orgs,
):
    """Idempotent for the SAME dispatcher, and the FIRST resolution is the evidence. A
    double-tap or a replayed request carries the same account, so it must not rewrite who
    established what — and must not error either, or a retry would surface as a failure."""
    mine = two_orgs["mine"]

    first = await client.patch(
        _resolve_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )
    second = await client.patch(
        _resolve_url(mine["exception"].id),
        json=_body(
            resolver_note="Different account of the same incident.",
            resolution_method=ExceptionResolutionMethod.IN_PERSON.value,
        ),
        headers=_headers(mine),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].resolver_note.startswith("Phoned the driver")
    assert mine["exception"].resolution_method == ExceptionResolutionMethod.PHONED
    assert second.json()["resolved_at"] == first.json()["resolved_at"]


async def test_a_second_dispatcher_resolving_is_409(
    client: AsyncClient, db_session, two_orgs,
):
    """A colleague who lost the race is told so, rather than handed a 200 carrying
    someone else's note. Their account was discarded; reporting success would record a
    resolution that never happened on the one screen built to prove otherwise.

    409, matching every other already-exists conflict on this API (drivers, vehicles,
    precincts, phases) — not 404, which would claim the row is gone, and not 403, which
    would claim they may not touch it. They may; someone else simply got there first.
    """
    mine = two_orgs["mine"]
    colleague = User(
        id=uuid.uuid4(), organization_id=mine["org"].id,
        email="colleague-race@test.co.za", full_name="Colleague",
    )
    db_session.add(colleague)
    await db_session.flush()
    colleague_headers = auth_header(make_token(
        sub=str(colleague.id), role="dispatcher", org_id=str(mine["org"].id),
    ))

    first = await client.patch(
        _resolve_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )
    second = await client.patch(
        _resolve_url(mine["exception"].id),
        json=_body(
            resolver_note="Phoned the driver; the inspection was at Beitbridge.",
            resolution_method=ExceptionResolutionMethod.IN_PERSON.value,
        ),
        headers=colleague_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 409
    # The winner's account is untouched, and the 409 body names no person — it says a
    # colleague resolved it, never who, so the queue leaks no identity to a wrong guess.
    await db_session.refresh(mine["exception"])
    assert mine["exception"].resolver_note.startswith("Phoned the driver; seal was replaced")
    assert mine["exception"].resolved_by_user_id == mine["user"].id
    assert str(colleague.id) not in second.json()["detail"]


async def test_list_carries_the_trip_reference(client: AsyncClient, two_orgs):
    """Each row has to say which trip it belongs to. Carried on the response off the
    org-scoping join, so neither exception screen needs the trip list to render a
    reference a human can act on."""
    mine = two_orgs["mine"]

    res = await client.get(_LIST, headers=_headers(mine))

    row = next(r for r in res.json() if r["id"] == str(mine["exception"].id))
    assert row["trip_reference"] == mine["trip"].trip_reference
    assert row["trip_id"] == str(mine["trip"].id)


async def test_resolve_response_carries_the_trip_reference(client: AsyncClient, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        _resolve_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.json()["trip_reference"] == mine["trip"].trip_reference


async def test_resolution_method_is_on_the_read_schema(client: AsyncClient, two_orgs):
    """The dispatcher UI renders the method back; if it never reaches the wire the
    resolve form records into a field nobody can see."""
    mine = two_orgs["mine"]
    await client.patch(_resolve_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    res = await client.get(_LIST, headers=_headers(mine))

    row = next(r for r in res.json() if r["id"] == str(mine["exception"].id))
    assert row["resolution_method"] == ExceptionResolutionMethod.PHONED.value
