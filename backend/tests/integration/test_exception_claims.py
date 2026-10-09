"""FP-280 — soft claim, release, take-over and auto-claim on review.

Two organisations are seeded throughout, not one. Org scoping here is an authorisation
boundary rather than a convenience filter, and a single-org fixture cannot tell a query
that scopes correctly from one that scopes not at all — both return the same rows.
"""

import uuid

import pytest_asyncio

from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionContactMethod,
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



def _claim_url(exception_id: uuid.UUID) -> str:
    return f"/api/v1/exceptions/{exception_id}/claim"


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


async def test_claim_records_claimer_and_time(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert res.status_code == 200
    body = res.json()
    assert body["claimed_by_user_id"] == str(mine["user"].id)
    assert body["claimed_by_name"] == mine["user"].full_name
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id
    assert mine["exception"].claimed_at is not None
    assert mine["exception"].review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_reclaim_by_same_dispatcher_is_idempotent(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    first = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    second = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert second.status_code == 200
    assert second.json()["claimed_at"] == first.json()["claimed_at"]


async def test_claim_over_a_colleague_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_take_over_replaces_a_colleagues_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={"take_over": True}, headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_release_by_claimer_clears_the_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id is None
    assert mine["exception"].claimed_at is None


async def test_release_of_a_colleagues_claim_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_release_of_an_unclaimed_row_is_a_no_op(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 200
    assert res.json()["claimed_by_user_id"] is None


async def test_release_after_review_is_409_and_keeps_the_claim(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    res = await client.delete(_claim_url(mine["exception"].id), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_claim_of_a_reviewed_row_is_409(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers_for(ana, mine["org"]))

    res = await client.post(_claim_url(mine["exception"].id), json={"take_over": True}, headers=_headers(mine))

    assert res.status_code == 409


async def test_claim_across_organisations_is_404(client, two_orgs):
    res = await client.post(
        _claim_url(two_orgs["theirs"]["exception"].id), json={}, headers=_headers(two_orgs["mine"]),
    )

    assert res.status_code == 404


async def test_claim_without_credentials_is_403(client, two_orgs):
    res = await client.post(_claim_url(two_orgs["mine"]["exception"].id), json={})

    assert res.status_code == 403


async def test_claim_with_malformed_id_is_422(client, two_orgs):
    res = await client.post("/api/v1/exceptions/not-a-uuid/claim", json={}, headers=_headers(two_orgs["mine"]))

    assert res.status_code == 422


async def test_review_of_an_unclaimed_row_auto_claims_it(client, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.claimed_by_user_id == mine["user"].id
    assert exc.claimed_at == exc.reviewed_at
    assert res.json()["reviewed_by_name"] == mine["user"].full_name


async def test_review_over_a_colleagues_claim_is_409_and_changes_nothing(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.patch(_review_url(mine["exception"].id), json=_body(), headers=_headers(mine))

    assert res.status_code == 409
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_status == ExceptionReviewStatus.NEEDS_REVIEW
    assert mine["exception"].review_note is None
    assert mine["exception"].claimed_by_user_id == ana.id


async def test_take_over_and_review_in_one_step(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    ana = await _colleague(db_session, mine["org"])
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers_for(ana, mine["org"]))

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(take_over=True), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.review_status == ExceptionReviewStatus.REVIEWED
    assert exc.reviewed_by_user_id == mine["user"].id
    assert exc.claimed_by_user_id == mine["user"].id
    assert exc.claimed_at == exc.reviewed_at


async def test_review_with_take_over_on_an_unclaimed_row_just_reviews(client, db_session, two_orgs):
    """take_over on a row nobody holds is harmless — a stale 'Take over and review'
    button must not fail just because the colleague released in the meantime."""
    mine = two_orgs["mine"]

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(take_over=True), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].claimed_by_user_id == mine["user"].id


async def test_review_queue_is_ordered_by_severity_then_newest(client, db_session, two_orgs):
    mine = two_orgs["mine"]  # its seeded exception is CRITICAL
    for severity in (ExceptionSeverity.INFO, ExceptionSeverity.WARNING):
        db_session.add(TripException(
            id=uuid.uuid4(), trip_id=mine["trip"].id, exception_type=ExceptionType.CHECKPOINT_TIMEOUT,
            source=ExceptionSource.SYSTEM, severity=severity, description=f"{severity.value} row",
        ))
    await db_session.flush()

    res = await client.get("/api/v1/exceptions/review-queue", headers=_headers(mine))

    assert [row["severity"] for row in res.json()] == ["critical", "warning", "info"]


async def test_review_queue_rows_carry_the_claimers_name(client, db_session, two_orgs):
    mine = two_orgs["mine"]
    await client.post(_claim_url(mine["exception"].id), json={}, headers=_headers(mine))

    res = await client.get("/api/v1/exceptions/review-queue", headers=_headers(mine))

    assert res.json()[0]["claimed_by_name"] == mine["user"].full_name


async def test_trip_detail_omits_reviewer_names_unless_asked(db_session, two_orgs):
    from app.orchestration.resource_service import get_trip_detail
    mine = two_orgs["mine"]
    mine["exception"].claimed_by_user_id = mine["user"].id
    await db_session.flush()

    driver_view = await get_trip_detail(db_session, mine["trip"].id, mine["org"].id)
    dispatcher_view = await get_trip_detail(
        db_session, mine["trip"].id, mine["org"].id, include_reviewer_names=True,
    )

    assert driver_view.exceptions[0].claimed_by_name is None
    assert dispatcher_view.exceptions[0].claimed_by_name == mine["user"].full_name
