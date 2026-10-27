"""Query budgets for the dispatcher and driver read endpoints (UI review fix plan, Batch E).

The database is ~185 ms per round trip from the people using it, so a request costs roughly
(sequential statements x 185 ms). Statement COUNT is the metric: it does not depend on where the
test database lives. Each test seeds one realistic trip, issues one GET, and asserts the number of
statements it ran is within a ceiling. The ceilings are today's measured counts: a stage that
removes round trips lowers its endpoint's ceiling here first, and nothing may raise one without a
reason that is written next to the number.

What is counted: every statement SQLAlchemy sends through a cursor during the request, including
SAVEPOINT / RELEASE (those are round trips too). Not counted: BEGIN / COMMIT, which the driver
sends outside the cursor, and the warm-up request below.

Authentication is inside the count. A request is measured after one warm-up request on the same
token, because the first request of a session also writes the session row; every later request
within the stamping window runs the cheaper path, and that is the steady state worth budgeting.
"""

import os
import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.core import realtime
from app.db.models.enums import (
    AnchorStatus,
    BlockchainReceiptType,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    TripType,
)
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.orchestration.evidence_anchors.artifacts import attach_exception_artifacts
from app.schemas.driver_substitutions import SubstitutionCompletionMode

from tests.conftest import FakeMockStateStore, auth_header, make_token
from tests.integration._driver_substitution_world import (
    SubWorld,
    add_pending,
    build_world,
    complete_handover,
    driver_headers,
)
from tests.integration._evidence_anchor_world import make_artifact

_DISPATCHER_WARM_UP = "/api/v1/auth/me"
_DRIVER_WARM_UP = "/api/v1/drivers/me"

_EXCEPTION_COUNT = 6
_PHOTOS_PER_PHOTOGRAPHED_EXCEPTION = 2
_PARCELS_PER_CONSIGNMENT = 4

BUDGET_TRIP_DETAIL = 27
BUDGET_TRIP_LIST = 10
BUDGET_REVIEW_QUEUE = 7
BUDGET_INCIDENT_LIST = 5
BUDGET_INCIDENT_DETAIL = 7
BUDGET_INCIDENT_EVIDENCE = 33
BUDGET_DRIVER_TRIP_DETAIL = 20
BUDGET_DASHBOARD_PRECINCTS = 3
BUDGET_DASHBOARD_AUTH_ME = 3


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def fake_mock_state_store(monkeypatch):
    """Scan, Pulsit and Parcel Perfect mocks keep state in Redis; the budget must not need one running."""
    fake = FakeMockStateStore()
    for module in (
        "app.integrations.scan_feed", "app.integrations.pulsit",
        "app.integrations.parcel_perfect.mock", "app.integrations.idvs",
    ):
        monkeypatch.setattr(f"{module}.get_mock_state_store", lambda: fake)


@pytest.fixture(autouse=True)
def silence_realtime_publish(monkeypatch):
    """Seeding the incident publishes a realtime event; none of that is under test, and it needs Redis."""
    monkeypatch.setattr(realtime, "_schedule_publish", lambda org_id, event: None)


@pytest.fixture(autouse=True)
def stub_signed_urls(monkeypatch):
    """Storage signing is a network call in production, not a database one; out of scope here."""
    async def _fake(*, s3_bucket, s3_key, ttl_seconds):
        return f"https://storage.test/{s3_key}?ttl={ttl_seconds}"
    monkeypatch.setattr("app.orchestration.evidence.artifacts.create_signed_url", _fake)



@dataclass
class BudgetWorld:
    sub: SubWorld
    incident_id: str
    dispatcher: dict[str, str]
    driver: dict[str, str]


async def _add_phases(db, world: SubWorld) -> list[TripStop]:
    """A three-stop route (origin, cross-dock, destination) with the trip part-way along it."""
    stops = list((await db.execute(
        select(TripStop).where(TripStop.trip_id == world.trip_id).order_by(TripStop.sequence)
    )).scalars())
    origin, destination = stops
    dock_precinct = Precinct(
        id=uuid.uuid4(), name="Dock", principal_organization_id=world.client_org_id,
        latitude="0.5", longitude="0.5",
    )
    db.add(dock_precinct)
    await db.flush()
    destination.sequence = 2
    await db.flush()
    dock = TripStop(id=uuid.uuid4(), trip_id=world.trip_id, precinct_id=dock_precinct.id, sequence=1)
    db.add(dock)
    await db.flush()

    now = datetime.now(UTC)
    activation = await db.get(PhaseEvent, world.activation_id)
    activation.status = PhaseStatus.COMPLETED
    activation.completed_at = now - timedelta(hours=4)
    plan = [
        (PhaseType.LOADING, origin.id, 2, PhaseStatus.COMPLETED, 3),
        (PhaseType.DEPARTURE, origin.id, 3, PhaseStatus.COMPLETED, 2),
        (PhaseType.IN_TRANSIT, origin.id, 4, PhaseStatus.COMPLETED, 1),
        (PhaseType.UNLOADING, dock.id, 5, PhaseStatus.COMPLETED, 0),
        (PhaseType.UNLOADING, destination.id, 6, PhaseStatus.PENDING, None),
    ]
    for phase_type, stop_id, sequence, status, hours_ago in plan:
        db.add(PhaseEvent(
            id=uuid.uuid4(), trip_id=world.trip_id, phase_type=phase_type, trip_stop_id=stop_id,
            sequence_number=sequence, status=status,
            completed_at=None if hours_ago is None else now - timedelta(hours=hours_ago),
        ))
    await db.flush()
    return [origin, dock, destination]


async def _add_cargo(db, world: SubWorld, stops: list[TripStop]) -> None:
    origin, dock, destination = stops
    for index, delivery in enumerate((dock, destination)):
        suffix = uuid.uuid4().hex[:8]
        consignment = Consignment(
            id=uuid.uuid4(), trip_id=world.trip_id, parcel_perfect_reference=f"WB-{suffix}",
            parcel_count_expected=_PARCELS_PER_CONSIGNMENT, pickup_stop_id=origin.id,
            delivery_stop_id=delivery.id,
        )
        db.add(consignment)
        await db.flush()
        out_at = datetime.now(UTC) - timedelta(hours=5)
        db.add_all(
            Parcel(
                id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"B{index}{i}-{suffix}",
                pp_scan_out_at=out_at,
            )
            for i in range(_PARCELS_PER_CONSIGNMENT)
        )
    await db.flush()


async def _add_exceptions(db, world: SubWorld) -> list[TripException]:
    """Six findings in every review state, two with photos and two with anchor events."""
    phases = list((await db.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id == world.trip_id).order_by(PhaseEvent.sequence_number)
    )).scalars())
    states = [
        ExceptionReviewStatus.NEEDS_REVIEW, ExceptionReviewStatus.NEEDS_REVIEW,
        ExceptionReviewStatus.NEEDS_REVIEW, ExceptionReviewStatus.RECORDED,
        ExceptionReviewStatus.RECORDED, ExceptionReviewStatus.REVIEWED,
    ]
    types = [
        ExceptionType.CARGO_DAMAGE, ExceptionType.PARCEL_COUNT_MISMATCH, ExceptionType.SEAL_MISMATCH,
        ExceptionType.CARGO_DAMAGE, ExceptionType.PARCEL_COUNT_MISMATCH, ExceptionType.CARGO_DAMAGE,
    ]
    created: list[TripException] = []
    for index in range(_EXCEPTION_COUNT):
        exc = TripException(
            id=uuid.uuid4(), trip_id=world.trip_id, phase_event_id=phases[index % len(phases)].id,
            exception_type=types[index], source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL if index < 2 else ExceptionSeverity.WARNING,
            review_status=states[index], description=f"Seeded finding {index}",
        )
        db.add(exc)
        created.append(exc)
    await db.flush()

    for exc in created[:2]:
        photos = [
            await make_artifact(db, world.trip_id, label=f"{exc.id}-{i}")
            for i in range(_PHOTOS_PER_PHOTOGRAPHED_EXCEPTION)
        ]
        await attach_exception_artifacts(db, exception_id=exc.id, artifact_ids=[p.id for p in photos])
        db.add(EvidenceAnchorEvent(
            trip_id=world.trip_id, exception_id=exc.id,
            receipt_type=BlockchainReceiptType.EXCEPTION_RAISED, occurred_at=datetime.now(UTC),
            payload_version=1, payload_json={}, event_hash="0" * 64, anchor_status=AnchorStatus.PENDING,
        ))
    await db.flush()
    return created


async def _seed(db, client: AsyncClient) -> BudgetWorld:
    """Multi-stop loaded trip, one completed driver handover plus a pending one, findings with
    photos and anchors, trip-level evidence, and an incident with updates."""
    world = await build_world(db)
    trip = await db.get(Trip, world.trip_id)
    trip.trip_type = TripType.LOADED.value
    stops = await _add_phases(db, world)
    await _add_cargo(db, world, stops)
    handover = await complete_handover(db, world, outgoing=world.a, incoming=world.b)
    handover.incoming_identity_status = IdvsStatus.VERIFIED.value
    handover.incoming_identity_last_verified_at = datetime.now(UTC)
    handover.incoming_identity_observed_at = datetime.now(UTC)
    handover.completion_mode = SubstitutionCompletionMode.NORMAL.value
    for role, driver_id in (("outgoing", world.a), ("incoming", world.b)):
        db.add(DriverSubstitutionConfirmation(
            id=uuid.uuid4(), request_id=handover.request_id, role=role, driver_id=driver_id,
            captured_at=datetime.now(UTC), received_at=datetime.now(UTC),
            confirmed_vehicle_ids=[str(world.horse_id)], seal_checks=[],
        ))
    await db.flush()
    await add_pending(
        db, world, outgoing=world.b, incoming=world.c,
        expected_at=datetime.now(UTC) + timedelta(hours=2),
    )
    exceptions = await _add_exceptions(db, world)
    for i in range(3):
        await make_artifact(db, world.trip_id, label=f"trip-evidence-{i}")

    dispatcher = auth_header(make_token(sub=str(world.user_id), role="dispatcher", org_id=str(world.org_id)))
    reported = await client.post(
        f"/api/v1/trips/{world.trip_id}/incidents",
        json={
            "incident_type": "parcel_shortage", "summary": "Parcels short at the cross-dock",
            "reporter_role": "receiver", "report_channel": "phone", "confidence": "reported",
            "exception_ids": [str(exceptions[1].id)],
        },
        headers=dispatcher,
    )
    assert reported.status_code == 201, reported.text
    incident_id = reported.json()["incident_id"]
    for note in ("Receiver counted twice", "Driver contacted"):
        update = await client.post(
            f"/api/v1/incidents/{incident_id}/updates", json={"kind": "note", "note": note},
            headers=dispatcher,
        )
        assert update.status_code in (200, 201), update.text

    return BudgetWorld(sub=world, incident_id=incident_id, dispatcher=dispatcher, driver=driver_headers(world.b))


@pytest_asyncio.fixture
async def budget_world(client: AsyncClient, db_session) -> BudgetWorld:
    return await _seed(db_session, client)


_FIRST_FROM = re.compile(r'\bFROM\s+("?[\w.]+"?)', re.IGNORECASE)
_WRITE_TARGET = re.compile(r'^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+("?[\w.]+"?)', re.IGNORECASE)


def _group_key(statement: str) -> str:
    """The table a statement is mostly about: its first FROM, else its write target."""
    match = _FIRST_FROM.search(statement)
    if match:
        return match.group(1).strip('"')
    write = _WRITE_TARGET.match(statement)
    if write:
        return f"{write.group(1).upper()} {write.group(2).strip(chr(34))}"
    return statement.strip().split(None, 1)[0].upper()


def describe_statements(statements: list[str]) -> str:
    """Statements grouped by first FROM table, with exact repeats called out."""
    groups: dict[str, list[str]] = defaultdict(list)
    for statement in statements:
        groups[_group_key(statement)].append(statement)
    repeats = Counter(statements)
    lines = [f"{len(statements)} statements"]
    for key, members in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        duplicated = sum(count - 1 for s, count in repeats.items() if _group_key(s) == key and count > 1)
        lines.append(f"  {len(members):3d}  {key}" + (f"   ({duplicated} exact repeat(s))" if duplicated else ""))
    return "\n".join(lines)


async def _count(
    client: AsyncClient, db_session, url: str, headers: dict[str, str], warm_up: str,
) -> list[str]:
    """The statements one GET to `url` runs, after one warm-up on the same token."""
    warmed = await client.get(warm_up, headers=headers)
    assert warmed.status_code == 200, f"warm-up {warm_up}: {warmed.status_code} {warmed.text}"

    statements: list[str] = []

    def _capture(conn, cursor, statement, *args):
        statements.append(statement)

    engine = db_session.bind.sync_engine
    sa_event.listen(engine, "before_cursor_execute", _capture)
    try:
        response = await client.get(url, headers=headers)
    finally:
        sa_event.remove(engine, "before_cursor_execute", _capture)
    assert response.status_code == 200, f"{url}: {response.status_code} {response.text}"
    return statements


def _assert_within(statements: list[str], ceiling: int, endpoint: str) -> None:
    if os.environ.get("QUERY_BUDGET_REPORT"):
        print(f"\nQUERY_COUNT {endpoint}: {len(statements)} (ceiling {ceiling})")
    assert len(statements) <= ceiling, (
        f"{endpoint} ran {len(statements)} statements, ceiling is {ceiling}.\n"
        f"{describe_statements(statements)}"
    )



async def test_dispatcher_trip_detail_stays_within_budget(client, db_session, budget_world):
    url = f"/api/v1/trips/{budget_world.sub.trip_id}"

    statements = await _count(client, db_session, url, budget_world.dispatcher, _DISPATCHER_WARM_UP)

    _assert_within(statements, BUDGET_TRIP_DETAIL, "GET /trips/{id}")


async def test_dispatcher_trip_list_stays_within_budget(client, db_session, budget_world):
    statements = await _count(client, db_session, "/api/v1/trips", budget_world.dispatcher, _DISPATCHER_WARM_UP)

    _assert_within(statements, BUDGET_TRIP_LIST, "GET /trips")


async def test_exceptions_review_queue_stays_within_budget(client, db_session, budget_world):
    statements = await _count(
        client, db_session, "/api/v1/exceptions/review-queue", budget_world.dispatcher, _DISPATCHER_WARM_UP,
    )

    _assert_within(statements, BUDGET_REVIEW_QUEUE, "GET /exceptions/review-queue")


async def test_incident_list_stays_within_budget(client, db_session, budget_world):
    statements = await _count(client, db_session, "/api/v1/incidents", budget_world.dispatcher, _DISPATCHER_WARM_UP)

    _assert_within(statements, BUDGET_INCIDENT_LIST, "GET /incidents")


async def test_incident_detail_stays_within_budget(client, db_session, budget_world):
    url = f"/api/v1/incidents/{budget_world.incident_id}"

    statements = await _count(client, db_session, url, budget_world.dispatcher, _DISPATCHER_WARM_UP)

    _assert_within(statements, BUDGET_INCIDENT_DETAIL, "GET /incidents/{id}")


async def test_incident_evidence_stays_within_budget(client, db_session, budget_world):
    """The incident page's second call, made alongside the detail."""
    url = f"/api/v1/incidents/{budget_world.incident_id}/evidence"

    statements = await _count(client, db_session, url, budget_world.dispatcher, _DISPATCHER_WARM_UP)

    _assert_within(statements, BUDGET_INCIDENT_EVIDENCE, "GET /incidents/{id}/evidence")


async def test_driver_trip_detail_stays_within_budget(client, db_session, budget_world):
    url = f"/api/v1/trips/me/{budget_world.sub.trip_id}"

    statements = await _count(client, db_session, url, budget_world.driver, _DRIVER_WARM_UP)

    _assert_within(statements, BUDGET_DRIVER_TRIP_DETAIL, "GET /trips/me/{id}")



async def test_dashboard_precincts_stays_within_budget(client, db_session, budget_world):
    statements = await _count(
        client, db_session, "/api/v1/precincts", budget_world.dispatcher, _DISPATCHER_WARM_UP,
    )

    _assert_within(statements, BUDGET_DASHBOARD_PRECINCTS, "GET /precincts")


async def test_dashboard_auth_me_stays_within_budget(client, db_session, budget_world):
    statements = await _count(
        client, db_session, "/api/v1/auth/me", budget_world.dispatcher, _DISPATCHER_WARM_UP,
    )

    _assert_within(statements, BUDGET_DASHBOARD_AUTH_ME, "GET /auth/me")
