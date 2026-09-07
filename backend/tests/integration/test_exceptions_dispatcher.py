"""FP-146 — the dispatcher's org-scoped exception list and immutable review action.

Two organisations are seeded throughout, not one. Org scoping here is an authorisation
boundary rather than a convenience filter, and a single-org fixture cannot tell a query
that scopes correctly from one that scopes not at all — both return the same rows.
"""

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient

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


# ── review ───────────────────────────────────────────────────────────────────
#
# The old undifferentiated GET /api/v1/exceptions list (and its `resolved` filter) was
# retired by the exception-review-and-pagination plan's Task 6 in favour of three
# purpose-built reads — GET .../review-queue, GET .../history and GET .../{id} — whose
# coverage lives in tests/integration/test_exception_reads.py. The tests that exercised
# the old route lived here; removed rather than ported, since the new routes have a
# materially different contract (a compact list item shape, no `resolved` bool) and
# porting them would just re-describe test_exception_reads.py under a different name.


async def test_review_records_complete_evidence(client: AsyncClient, db_session, two_orgs):
    """A missing state assignment would leave an apparently successful review incomplete."""
    mine = two_orgs["mine"]

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    exc = mine["exception"]
    assert exc.review_status == ExceptionReviewStatus.REVIEWED
    assert exc.review_outcome == ExceptionReviewOutcome.EVIDENCE_VERIFIED
    assert exc.reviewed_by_user_id == mine["user"].id
    assert exc.reviewed_at is not None
    assert exc.review_note.startswith("Phoned the driver")
    assert exc.contact_method == ExceptionContactMethod.PHONE


async def test_needs_review_exception_can_be_reviewed(client: AsyncClient, db_session, two_orgs):
    mine = two_orgs["mine"]
    mine["exception"].review_status = ExceptionReviewStatus.NEEDS_REVIEW
    await db_session.flush()

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_status == ExceptionReviewStatus.REVIEWED


@pytest.mark.parametrize("trip_status", [TripStatus.ACTIVE, TripStatus.CLOSED, TripStatus.CANCELLED])
async def test_dispatcher_can_review_without_changing_trip_status(
    client: AsyncClient, db_session, two_orgs, trip_status: TripStatus,
):
    """Review records an assessment; it never reopens, closes, or cancels a trip."""
    mine = two_orgs["mine"]
    mine["trip"].status = trip_status
    await db_session.flush()

    res = await client.patch(
        _review_url(mine["exception"].id),
        json=_body(contact_method=None),
        headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["trip"])
    assert mine["trip"].status == trip_status


async def test_review_takes_reviewer_and_time_from_server_context(
    client: AsyncClient, db_session, two_orgs,
):
    """Client-supplied authorship or timestamps must never enter the evidence record."""
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]
    before = datetime.now(UTC)

    res = await client.patch(
        _review_url(mine["exception"].id),
        json=_body(
            reviewed_by_user_id=str(theirs["user"].id),
            reviewed_at="2020-01-01T00:00:00Z",
        ),
        headers=_headers(mine),
    )
    after = datetime.now(UTC)

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].reviewed_by_user_id == mine["user"].id
    assert before <= mine["exception"].reviewed_at <= after


async def test_review_without_credentials_is_403(client: AsyncClient, db_session, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(_review_url(mine["exception"].id), json=_body())

    assert res.status_code == 403
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_status == ExceptionReviewStatus.RECORDED


async def test_review_with_a_token_for_an_unknown_user_is_401(
    client: AsyncClient, db_session, two_orgs,
):
    mine = two_orgs["mine"]
    ghost = auth_header(make_token(
        sub=str(uuid.uuid4()), role="dispatcher", org_id=str(mine["org"].id),
    ))

    res = await client.patch(_review_url(mine["exception"].id), json=_body(), headers=ghost)

    assert res.status_code == 401
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_status == ExceptionReviewStatus.RECORDED


async def test_review_across_organisations_is_404_not_403(
    client: AsyncClient, db_session, two_orgs,
):
    """A 404 does not disclose another operator's exception to the caller."""
    mine, theirs = two_orgs["mine"], two_orgs["theirs"]

    res = await client.patch(
        _review_url(theirs["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.status_code == 404
    await db_session.refresh(theirs["exception"])
    assert theirs["exception"].review_status == ExceptionReviewStatus.RECORDED


async def test_review_unknown_id_is_404(client: AsyncClient, two_orgs):
    res = await client.patch(
        _review_url(uuid.uuid4()), json=_body(), headers=_headers(two_orgs["mine"]),
    )

    assert res.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {
            "review_outcome": DispatcherReviewOutcome.EVIDENCE_VERIFIED.value,
            "contact_method": None,
        },
        {
            "review_note": "   ",
            "review_outcome": DispatcherReviewOutcome.EVIDENCE_VERIFIED.value,
            "contact_method": None,
        },
        {"review_note": "Evidence checked.", "contact_method": None},
        {
            "review_note": "Evidence checked.",
            "review_outcome": DispatcherReviewOutcome.EVIDENCE_VERIFIED.value,
        },
        {
            "review_note": "Evidence checked.",
            "review_outcome": ExceptionReviewOutcome.LEGACY_REVIEW.value,
            "contact_method": None,
        },
    ],
    ids=["missing-note", "blank-note", "missing-outcome", "missing-contact", "legacy-outcome"],
)
async def test_review_rejects_incomplete_or_legacy_evidence(
    client: AsyncClient, two_orgs, body: dict,
):
    res = await client.patch(
        _review_url(two_orgs["mine"]["exception"].id),
        json=body,
        headers=_headers(two_orgs["mine"]),
    )

    assert res.status_code == 422


async def test_review_accepts_explicit_null_contact_method(
    client: AsyncClient, db_session, two_orgs,
):
    mine = two_orgs["mine"]

    res = await client.patch(
        _review_url(mine["exception"].id),
        json=_body(contact_method=None),
        headers=_headers(mine),
    )

    assert res.status_code == 200
    await db_session.refresh(mine["exception"])
    assert mine["exception"].contact_method is None


async def test_legacy_resolve_route_is_no_longer_available(client: AsyncClient, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        f"/api/v1/exceptions/{mine['exception'].id}/resolve",
        json={"resolver_note": "Legacy request.", "resolution_method": "phoned"},
        headers=_headers(mine),
    )

    assert res.status_code == 404


async def test_same_dispatcher_review_replay_is_unchanged(
    client: AsyncClient, db_session, two_orgs,
):
    """A same-user retry returns the first immutable review without overwriting it."""
    mine = two_orgs["mine"]

    first = await client.patch(
        _review_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )
    second = await client.patch(
        _review_url(mine["exception"].id),
        json=_body(
            review_note="Different account of the same incident.",
            review_outcome=DispatcherReviewOutcome.REFERRED_FOR_FOLLOW_UP.value,
            contact_method=ExceptionContactMethod.IN_PERSON.value,
        ),
        headers=_headers(mine),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    await db_session.refresh(mine["exception"])
    assert mine["exception"].review_note.startswith("Phoned the driver")
    assert mine["exception"].review_outcome == ExceptionReviewOutcome.EVIDENCE_VERIFIED
    assert mine["exception"].contact_method == ExceptionContactMethod.PHONE


async def test_a_second_dispatcher_review_is_409(
    client: AsyncClient, db_session, two_orgs,
):
    """A colleague must be told their discarded review was not recorded."""
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
        _review_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )
    second = await client.patch(
        _review_url(mine["exception"].id),
        json=_body(
            review_note="The inspection was at Beitbridge.",
            review_outcome=DispatcherReviewOutcome.REFERRED_FOR_FOLLOW_UP.value,
            contact_method=ExceptionContactMethod.IN_PERSON.value,
        ),
        headers=colleague_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert "already reviewed by a colleague" in second.json()["detail"]
    await db_session.refresh(mine["exception"])
    assert mine["exception"].reviewed_by_user_id == mine["user"].id
    assert mine["exception"].review_outcome == ExceptionReviewOutcome.EVIDENCE_VERIFIED
    assert str(colleague.id) not in second.json()["detail"]


async def test_review_response_carries_the_trip_reference(client: AsyncClient, two_orgs):
    mine = two_orgs["mine"]

    res = await client.patch(
        _review_url(mine["exception"].id), json=_body(), headers=_headers(mine),
    )

    assert res.json()["trip_reference"] == mine["trip"].trip_reference


# Review evidence remaining visible after it is written is covered on the GET .../{id}
# read path instead — see test_exception_reads.py::test_detail_includes_review_evidence_
# when_reviewed — since the list route this test used to hit no longer exists.
