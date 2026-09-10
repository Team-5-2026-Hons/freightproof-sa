"""Integration tests for the dispatcher's exception read endpoints (Task 6 of the
exception-review-and-pagination plan): GET .../review-queue, GET .../history and
GET .../{exception_id}, which together replace the old undifferentiated
GET /api/v1/exceptions.

Complements tests/integration/test_exceptions_dispatcher.py, which owns
PATCH .../review — that route and its tests are unchanged by this task.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import (
    ArtifactType,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    PhaseStatus,
    PhaseType,
    TripStatus,
    VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_REVIEW_QUEUE = "/api/v1/exceptions/review-queue"
_HISTORY = "/api/v1/exceptions/history"


def _detail_url(exception_id) -> str:
    return f"/api/v1/exceptions/{exception_id}"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def stub_signed_urls(monkeypatch):
    """Storage is out of scope here — the artifact service's own tests cover signing."""
    async def _fake(*, s3_bucket, s3_key, ttl_seconds):
        return f"https://storage.test/{s3_key}?ttl={ttl_seconds}"
    monkeypatch.setattr("app.orchestration.artifact_service.create_signed_url", _fake)


# ── seeding helpers ─────────────────────────────────────────────────────────────


async def _seed_org(db_session, *, tag: str) -> dict:
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

    return {
        "org": org, "client_org": client_org, "user": user, "driver": driver,
        "horse": horse, "origin": origin, "dest": dest,
    }


async def _make_trip(db_session, seed: dict, *, tag: str, **overrides) -> Trip:
    defaults = dict(
        id=uuid.uuid4(), trip_reference=f"FP-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=seed["org"].id, client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id, horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id, destination_precinct_id=seed["dest"].id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["user"].id,
    )
    defaults.update(overrides)
    trip = Trip(**defaults)
    db_session.add(trip)
    await db_session.flush()
    return trip


async def _make_exception(db_session, trip: Trip, *, tag: str, **overrides) -> TripException:
    defaults = dict(
        id=uuid.uuid4(), trip_id=trip.id,
        exception_type=ExceptionType.CARGO_DAMAGE, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.WARNING, review_status=ExceptionReviewStatus.RECORDED,
        description=f"Finding {tag}",
    )
    defaults.update(overrides)
    exc = TripException(**defaults)
    db_session.add(exc)
    await db_session.flush()
    return exc


def _headers(seed: dict) -> dict:
    return auth_header(make_token(
        sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id),
    ))


# ── review-queue ──────────────────────────────────────────────────────────────


async def test_review_queue_returns_only_needs_review(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="rq")
    trip = await _make_trip(db_session, seed, tag="rq")
    needs = await _make_exception(
        db_session, trip, tag="needs", review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    await _make_exception(db_session, trip, tag="recorded", review_status=ExceptionReviewStatus.RECORDED)
    await _make_exception(db_session, trip, tag="reviewed", review_status=ExceptionReviewStatus.REVIEWED)

    res = await client.get(_REVIEW_QUEUE, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()}
    assert ids == {str(needs.id)}


async def test_review_queue_requires_auth(client: AsyncClient):
    res = await client.get(_REVIEW_QUEUE)

    assert res.status_code == 403


async def test_review_queue_rows_carry_trip_status_and_reference(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="rqinfo")
    trip = await _make_trip(db_session, seed, tag="rqinfo", status=TripStatus.EXCEPTION_HOLD)
    exc = await _make_exception(
        db_session, trip, tag="rqinfo", review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )

    res = await client.get(_REVIEW_QUEUE, headers=_headers(seed))

    assert res.status_code == 200
    row = next(r for r in res.json() if r["id"] == str(exc.id))
    assert row["trip_status"] == TripStatus.EXCEPTION_HOLD.value
    assert row["trip_reference"] == trip.trip_reference


# ── history ───────────────────────────────────────────────────────────────────


async def test_history_returns_only_recorded_and_reviewed(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="hist")
    trip = await _make_trip(db_session, seed, tag="hist")
    await _make_exception(db_session, trip, tag="needs", review_status=ExceptionReviewStatus.NEEDS_REVIEW)
    recorded = await _make_exception(db_session, trip, tag="recorded", review_status=ExceptionReviewStatus.RECORDED)
    reviewed = await _make_exception(db_session, trip, tag="reviewed", review_status=ExceptionReviewStatus.REVIEWED)

    res = await client.get(_HISTORY, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(recorded.id), str(reviewed.id)}


async def test_history_requires_auth(client: AsyncClient):
    res = await client.get(_HISTORY)

    assert res.status_code == 403


async def test_history_pagination_has_no_duplicates_or_omissions_with_tied_timestamps(
    client: AsyncClient, db_session,
):
    """Rows sharing one created_at value (a realistic tie, not a contrived one — see
    exception_service._read_with_trip's own comment on why `id` breaks the tie) must
    still page cleanly: every seeded row appears exactly once across all pages."""
    seed = await _seed_org(db_session, tag="page")
    trip = await _make_trip(db_session, seed, tag="page")
    exceptions = [await _make_exception(db_session, trip, tag=f"page-{i}") for i in range(7)]
    base = datetime.now(UTC)
    for exc in exceptions:
        exc.created_at = base
    await db_session.flush()
    expected_ids = {str(e.id) for e in exceptions}

    seen_ids: list[str] = []
    cursor = None
    for _ in range(len(exceptions) + 1):
        params = {"limit": 3}
        if cursor is not None:
            params["cursor"] = cursor
        res = await client.get(_HISTORY, params=params, headers=_headers(seed))
        assert res.status_code == 200
        body = res.json()
        seen_ids.extend(row["id"] for row in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    assert len(seen_ids) == len(expected_ids)
    assert set(seen_ids) == expected_ids


async def test_history_q_matches_trip_reference(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="q-ref")
    trip = await _make_trip(db_session, seed, tag="qrefspecial")
    exc = await _make_exception(db_session, trip, tag="q-ref")
    other_trip = await _make_trip(db_session, seed, tag="other")
    await _make_exception(db_session, other_trip, tag="other")

    res = await client.get(_HISTORY, params={"q": "qrefspecial"}, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(exc.id)}


async def test_history_q_matches_description_case_insensitively(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="q-desc")
    trip = await _make_trip(db_session, seed, tag="q-desc")
    match = await _make_exception(db_session, trip, tag="match", description="Seal was TAMPERED with badly")
    await _make_exception(db_session, trip, tag="other", description="Nothing unusual")

    res = await client.get(_HISTORY, params={"q": "tampered"}, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(match.id)}


@pytest.mark.parametrize(
    ("query", "expected_description"),
    [("%", "Literal % marker"), ("_", "Literal _ marker")],
)
async def test_history_search_treats_sql_wildcards_as_literal_characters(
    client: AsyncClient,
    db_session,
    query: str,
    expected_description: str,
):
    seed = await _seed_org(db_session, tag=f"q-literal-{ord(query)}")
    trip = await _make_trip(db_session, seed, tag=f"q-literal-{ord(query)}")
    await _make_exception(db_session, trip, tag="percent", description="Literal % marker")
    await _make_exception(db_session, trip, tag="underscore", description="Literal _ marker")
    await _make_exception(db_session, trip, tag="ordinary", description="Literal X marker")

    res = await client.get(_HISTORY, params={"q": query}, headers=_headers(seed))

    assert res.status_code == 200
    assert [row["description"] for row in res.json()["items"]] == [expected_description]
    assert res.json()["total_items"] == 1


async def test_history_review_status_filter_narrows(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="rs")
    trip = await _make_trip(db_session, seed, tag="rs")
    await _make_exception(db_session, trip, tag="recorded", review_status=ExceptionReviewStatus.RECORDED)
    reviewed = await _make_exception(db_session, trip, tag="reviewed", review_status=ExceptionReviewStatus.REVIEWED)

    res = await client.get(_HISTORY, params={"review_status": "reviewed"}, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(reviewed.id)}


async def test_history_review_status_filter_needs_review_yields_no_rows_not_an_error(
    client: AsyncClient, db_session,
):
    """needs_review AND'ed with the recorded/reviewed base filter legitimately yields
    zero rows — this must not be special-cased or rejected."""
    seed = await _seed_org(db_session, tag="rs-nr")
    trip = await _make_trip(db_session, seed, tag="rs-nr")
    await _make_exception(db_session, trip, tag="needs", review_status=ExceptionReviewStatus.NEEDS_REVIEW)
    await _make_exception(db_session, trip, tag="recorded", review_status=ExceptionReviewStatus.RECORDED)

    res = await client.get(_HISTORY, params={"review_status": "needs_review"}, headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["items"] == []
    assert body["total_items"] == 0


async def test_history_severity_filter_narrows(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="sev")
    trip = await _make_trip(db_session, seed, tag="sev")
    await _make_exception(db_session, trip, tag="warn", severity=ExceptionSeverity.WARNING)
    info = await _make_exception(db_session, trip, tag="info", severity=ExceptionSeverity.INFO)

    res = await client.get(_HISTORY, params={"severity": "info"}, headers=_headers(seed))

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(info.id)}


async def test_history_date_bounds_are_inclusive_sa_calendar_dates(client: AsyncClient, db_session):
    """from_date/to_date are SA (UTC+2) calendar dates, inclusive on both ends. A moment
    stamped 23:30 UTC on one UTC calendar day is already the NEXT SA calendar day, so the
    boundary rows here are chosen to catch a naive (non-offset) implementation."""
    seed = await _seed_org(db_session, tag="date")
    trip = await _make_trip(db_session, seed, tag="date")
    boundary_date = date(2026, 3, 10)

    inside_start = datetime(2026, 3, 9, 22, 0, tzinfo=UTC)     # SA 2026-03-10 00:00 — inclusive lower bound
    outside_start = datetime(2026, 3, 9, 21, 59, tzinfo=UTC)   # SA 2026-03-09 23:59 — just before
    inside_end = datetime(2026, 3, 10, 21, 59, tzinfo=UTC)     # SA 2026-03-10 23:59 — inclusive upper bound
    outside_end = datetime(2026, 3, 10, 22, 0, tzinfo=UTC)     # SA 2026-03-11 00:00 — just after

    row_inside_start = await _make_exception(db_session, trip, tag="in-start")
    row_outside_start = await _make_exception(db_session, trip, tag="out-start")
    row_inside_end = await _make_exception(db_session, trip, tag="in-end")
    row_outside_end = await _make_exception(db_session, trip, tag="out-end")
    row_inside_start.created_at = inside_start
    row_outside_start.created_at = outside_start
    row_inside_end.created_at = inside_end
    row_outside_end.created_at = outside_end
    await db_session.flush()

    res = await client.get(
        _HISTORY,
        params={"from_date": boundary_date.isoformat(), "to_date": boundary_date.isoformat()},
        headers=_headers(seed),
    )

    assert res.status_code == 200
    ids = {row["id"] for row in res.json()["items"]}
    assert ids == {str(row_inside_start.id), str(row_inside_end.id)}


async def test_history_accepts_maximum_to_date_without_overflow(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="date-max")
    trip = await _make_trip(db_session, seed, tag="date-max")
    exception = await _make_exception(db_session, trip, tag="date-max")

    res = await client.get(
        _HISTORY,
        params={"to_date": date.max.isoformat()},
        headers=_headers(seed),
    )

    assert res.status_code == 200
    assert {row["id"] for row in res.json()["items"]} == {str(exception.id)}


async def test_history_total_items_is_exact_and_stable_across_pages(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="total")
    trip = await _make_trip(db_session, seed, tag="total")
    for i in range(5):
        await _make_exception(db_session, trip, tag=f"total-{i}")

    first_page = await client.get(_HISTORY, params={"limit": 2}, headers=_headers(seed))
    assert first_page.status_code == 200
    assert first_page.json()["total_items"] == 5

    cursor = first_page.json()["next_cursor"]
    second_page = await client.get(
        _HISTORY, params={"limit": 2, "cursor": cursor}, headers=_headers(seed),
    )
    assert second_page.status_code == 200
    assert second_page.json()["total_items"] == 5


@pytest.mark.parametrize("limit", [1, 100])
async def test_history_limit_within_bounds_succeeds(client: AsyncClient, db_session, limit: int):
    seed = await _seed_org(db_session, tag=f"lim{limit}")
    trip = await _make_trip(db_session, seed, tag=f"lim{limit}")
    await _make_exception(db_session, trip, tag="lim")

    res = await client.get(_HISTORY, params={"limit": limit}, headers=_headers(seed))

    assert res.status_code == 200


@pytest.mark.parametrize("limit", [0, 101])
async def test_history_limit_out_of_bounds_is_422(client: AsyncClient, db_session, limit: int):
    seed = await _seed_org(db_session, tag=f"limbad{limit}")

    res = await client.get(_HISTORY, params={"limit": limit}, headers=_headers(seed))

    assert res.status_code == 422


async def test_history_malformed_cursor_is_422(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="badcursor")

    res = await client.get(_HISTORY, params={"cursor": "not-a-real-cursor"}, headers=_headers(seed))

    assert res.status_code == 422


# ── detail ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("trip_status", [TripStatus.CLOSED, TripStatus.CANCELLED])
async def test_detail_retrievable_regardless_of_trip_lifecycle(
    client: AsyncClient, db_session, trip_status: TripStatus,
):
    seed = await _seed_org(db_session, tag=f"life{trip_status.value}")
    trip = await _make_trip(db_session, seed, tag=f"life{trip_status.value}", status=trip_status)
    exc = await _make_exception(
        db_session, trip, tag="life", review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    assert res.json()["id"] == str(exc.id)


async def test_detail_cross_organisation_is_404(client: AsyncClient, db_session):
    mine = await _seed_org(db_session, tag="xmine")
    theirs = await _seed_org(db_session, tag="xtheirs")
    trip = await _make_trip(db_session, theirs, tag="xtheirs")
    exc = await _make_exception(db_session, trip, tag="x")

    res = await client.get(_detail_url(exc.id), headers=_headers(mine))

    assert res.status_code == 404


async def test_detail_unknown_id_is_404(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="unknown")

    res = await client.get(_detail_url(uuid.uuid4()), headers=_headers(seed))

    assert res.status_code == 404


async def test_detail_includes_review_evidence_when_reviewed(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="revdetail")
    trip = await _make_trip(db_session, seed, tag="revdetail")
    exc = await _make_exception(
        db_session, trip, tag="reviewed",
        review_status=ExceptionReviewStatus.REVIEWED,
        review_outcome=ExceptionReviewOutcome.EVIDENCE_VERIFIED,
        reviewed_by_user_id=seed["user"].id,
        reviewed_at=datetime.now(UTC),
        review_note="Checked and verified.",
        contact_method=ExceptionContactMethod.PHONE,
    )

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["review_outcome"] == ExceptionReviewOutcome.EVIDENCE_VERIFIED.value
    assert body["reviewed_by_user_id"] == str(seed["user"].id)
    assert body["reviewed_at"] is not None
    assert body["review_note"] == "Checked and verified."
    assert body["contact_method"] == ExceptionContactMethod.PHONE.value


async def test_detail_review_fields_are_null_when_not_reviewed(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="unrevdetail")
    trip = await _make_trip(db_session, seed, tag="unrevdetail")
    exc = await _make_exception(db_session, trip, tag="unreviewed")

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["review_outcome"] is None
    assert body["reviewed_by_user_id"] is None
    assert body["reviewed_at"] is None
    assert body["review_note"] is None
    assert body["contact_method"] is None


async def test_detail_includes_signed_url_for_same_trip_artifact(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="art")
    trip = await _make_trip(db_session, seed, tag="art")
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip.id}/seal", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    exc = await _make_exception(db_session, trip, tag="art", supporting_artifact_id=artifact.id)

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["supporting_artifact_id"] == str(artifact.id)
    assert body["supporting_artifact"] is not None
    assert body["supporting_artifact"]["signed_url"] == f"https://storage.test/{trip.id}/seal?ttl=300"


async def test_detail_hides_supporting_artifact_owned_by_another_trip(client: AsyncClient, db_session):
    """A row somehow carrying a foreign artifact id (bypassing raise_exception's own
    ownership check) must not leak that artifact through the read path either — the
    invariant is enforced again here, not assumed from the write path. The id itself
    stays visible; only the resolved artifact is withheld."""
    seed = await _seed_org(db_session, tag="artforeign")
    trip = await _make_trip(db_session, seed, tag="artforeign")
    other_trip = await _make_trip(db_session, seed, tag="artforeignother")
    foreign_artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=other_trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{other_trip.id}/seal", s3_bucket="evidence-artifacts",
        file_hash="b" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(foreign_artifact)
    await db_session.flush()
    exc = await _make_exception(
        db_session, trip, tag="artforeign", supporting_artifact_id=foreign_artifact.id,
    )

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["supporting_artifact_id"] == str(foreign_artifact.id)
    assert body["supporting_artifact"] is None


async def test_detail_carries_trip_status_reference_closed_at_and_gps(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="tripinfo")
    closed_at = datetime.now(UTC)
    trip = await _make_trip(
        db_session, seed, tag="tripinfo", status=TripStatus.CLOSED, closed_at=closed_at,
    )
    exc = await _make_exception(
        db_session, trip, tag="tripinfo", gps_lat="-26.0942000", gps_lng="28.1342000",
    )

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["trip_status"] == TripStatus.CLOSED.value
    assert body["trip_reference"] == trip.trip_reference
    assert body["trip_closed_at"] is not None
    assert float(body["gps_lat"]) == -26.0942
    assert float(body["gps_lng"]) == 28.1342


async def test_detail_trip_closed_at_is_null_for_an_active_trip(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="notclosed")
    trip = await _make_trip(db_session, seed, tag="notclosed", status=TripStatus.ACTIVE)
    exc = await _make_exception(db_session, trip, tag="notclosed")

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    assert res.json()["trip_closed_at"] is None


async def test_detail_phase_and_stop_labels_populated_when_present(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="phase")
    trip = await _make_trip(db_session, seed, tag="phase")
    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=seed["dest"].id, sequence=2)
    db_session.add(stop)
    await db_session.flush()
    phase_event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.IN_TRANSIT, sequence_number=4, status=PhaseStatus.COMPLETED,
    )
    db_session.add(phase_event)
    await db_session.flush()
    exc = await _make_exception(
        db_session, trip, tag="phase", phase_event_id=phase_event.id, trip_stop_id=stop.id,
    )

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["phase_label"] == PhaseType.IN_TRANSIT.value
    assert body["stop_label"] == 2


async def test_detail_phase_and_stop_labels_are_none_when_absent(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="nophase")
    trip = await _make_trip(db_session, seed, tag="nophase")
    exc = await _make_exception(db_session, trip, tag="nophase")

    res = await client.get(_detail_url(exc.id), headers=_headers(seed))

    assert res.status_code == 200
    body = res.json()
    assert body["phase_label"] is None
    assert body["stop_label"] is None


# ── route ordering + old route removal ───────────────────────────────────────


async def test_static_routes_do_not_get_parsed_as_uuid(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="routing")

    review_queue_res = await client.get(_REVIEW_QUEUE, headers=_headers(seed))
    history_res = await client.get(_HISTORY, headers=_headers(seed))

    assert review_queue_res.status_code != 422
    assert history_res.status_code != 422


async def test_old_undifferentiated_list_route_is_gone(client: AsyncClient, db_session):
    seed = await _seed_org(db_session, tag="oldroute")

    res = await client.get("/api/v1/exceptions", headers=_headers(seed))

    assert res.status_code == 404
