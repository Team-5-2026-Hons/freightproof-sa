"""FP-280 — per-trip batch review of non-critical exceptions.

Two organisations are seeded throughout, not one. Org scoping here is an authorisation
boundary rather than a convenience filter, and a single-org fixture cannot tell a query
that scopes correctly from one that scopes not at all — both return the same rows.
"""

import uuid

import pytest
import pytest_asyncio

from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
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


def _review_url(exception_id: uuid.UUID) -> str:
    return f"/api/v1/exceptions/{exception_id}/review"


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
        "review_note": "Phoned the driver; seal was replaced by the depot after a lawful inspection.",
        "review_outcome": DispatcherReviewOutcome.EVIDENCE_VERIFIED.value,
        "contact_method": ExceptionContactMethod.PHONE.value,
    }
    body.update(overrides)
    return body


async def _colleague(db_session, org) -> User:
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"colleague-{uuid.uuid4().hex[:6]}@test.co.za", full_name="Colleague Ana",
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _headers_for(user: User, org) -> dict:
    return auth_header(make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id)))


_URL = "/api/v1/exceptions/review-batch"


async def _warnings(db_session, trip, n: int) -> list[TripException]:
    rows = [
        TripException(
            id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.CHECKPOINT_TIMEOUT,
            source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING, description=f"warn {i}",
        )
        for i in range(n)
    ]
    db_session.add_all(rows)
    await db_session.flush()
    return rows


def _batch(trip_id, ids, **overrides) -> dict:
    body = {
        "trip_id": str(trip_id),
        "exception_ids": [str(i) for i in ids],
        "review_note": "Demo trip — checkpoint timeouts expected on this route.",
        "review_outcome": DispatcherReviewOutcome.NO_ACTION_REQUIRED.value,
        "contact_method": None,
    }
    body.update(overrides)
    return body


async def test_batch_review_writes_one_review_per_row(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 3)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 200
    assert len(res.json()) == 3
    for row in rows:
        await db_session.refresh(row)
        assert row.review_status == ExceptionReviewStatus.REVIEWED
        assert row.review_outcome == ExceptionReviewOutcome.NO_ACTION_REQUIRED
        assert row.reviewed_by_user_id == mine["user"].id
        assert row.claimed_by_user_id == mine["user"].id
    assert len({r.reviewed_at for r in rows}) == 1


async def test_batch_review_leaves_unlisted_rows_unreviewed(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    listed, unlisted = await _warnings(db_session, mine["trip"], 2)

    await client.post(_URL, json=_batch(mine["trip"].id, [listed.id]), headers=_headers(mine))

    await db_session.refresh(unlisted)
    assert unlisted.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_with_a_critical_row_is_422_and_changes_nothing(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    [warning] = await _warnings(db_session, mine["trip"], 1)
    ids = [warning.id, mine["exception"].id]  # the seeded row is CRITICAL

    res = await client.post(_URL, json=_batch(mine["trip"].id, ids), headers=_headers(mine))

    assert res.status_code == 422
    await db_session.refresh(warning)
    assert warning.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_spanning_two_trips_is_422(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    first = mine["trip"]
    [here] = await _warnings(db_session, first, 1)
    second = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-2-{uuid.uuid4().hex[:6]}", order_number=f"ORD-2-{uuid.uuid4().hex[:6]}",
        operator_organization_id=first.operator_organization_id,
        client_organization_id=first.client_organization_id,
        driver_id=first.driver_id, horse_id=first.horse_id,
        origin_precinct_id=first.origin_precinct_id, destination_precinct_id=first.destination_precinct_id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=first.created_by_user_id,
    )
    db_session.add(second)
    await db_session.flush()
    [there] = await _warnings(db_session, second, 1)

    res = await client.post(_URL, json=_batch(first.id, [here.id, there.id]), headers=_headers(mine))

    assert res.status_code == 422
    await db_session.refresh(here)
    assert here.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_with_a_cross_org_id_is_404(client, db_session, two_orgs):
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]
    [mine_row] = await _warnings(db_session, mine["trip"], 1)
    [their_row] = await _warnings(db_session, theirs["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [mine_row.id, their_row.id]), headers=_headers(mine))

    assert res.status_code == 404
    await db_session.refresh(mine_row)
    assert mine_row.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_over_a_colleagues_claim_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    ana = await _colleague(db_session, mine["org"])
    rows[1].claimed_by_user_id = ana.id
    await db_session.flush()

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(rows[0])
    assert rows[0].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_including_a_colleagues_review_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    ana = await _colleague(db_session, mine["org"])
    await client.patch(_review_url(rows[1].id), json=_body(), headers=_headers_for(ana, mine["org"]))

    res = await client.post(_URL, json=_batch(mine["trip"].id, [r.id for r in rows]), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(rows[0])
    assert rows[0].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_replay_by_same_dispatcher_is_idempotent(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 2)
    body = _batch(mine["trip"].id, [r.id for r in rows])
    first = await client.post(_URL, json=body, headers=_headers(mine))

    second = await client.post(_URL, json=body, headers=_headers(mine))

    assert second.status_code == 200
    assert [r["reviewed_at"] for r in second.json()] == [r["reviewed_at"] for r in first.json()]


@pytest.mark.parametrize("ids_factory", [
    lambda rows: [],
    lambda rows: [rows[0].id, rows[0].id],
    lambda rows: [uuid.uuid4() for _ in range(101)],
])
async def test_batch_with_invalid_id_list_is_422(client, db_session, two_orgs, ids_factory):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, ids_factory(rows)), headers=_headers(mine))

    assert res.status_code == 422


async def test_batch_without_credentials_is_403(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    rows = await _warnings(db_session, mine["trip"], 1)

    res = await client.post(_URL, json=_batch(mine["trip"].id, [rows[0].id]))

    assert res.status_code == 403
