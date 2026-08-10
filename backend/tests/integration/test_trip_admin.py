"""Integration tests for the dispatcher-only trip lifecycle exits (task 6.1):

  POST /trips/{trip_id}/cancel
  POST /trips/{trip_id}/phases/{phase_event_id}/override

New router: app/api/v1/endpoints/trip_admin.py — dispatcher-scoped (S3 kept
phases.py driver-scoped, so these two write actions live on their own router
rather than mixing auth audiences into an existing file). Reuses the
seed/auth patterns from tests/integration/test_phases.py.
"""

import uuid
from datetime import UTC, datetime

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import (
    AnchorStatus, ExceptionSeverity, ExceptionSource, ExceptionType,
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus,
)
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _make_trip(
    db_session, seed, *, order_number: str, status: TripStatus = TripStatus.CREATED,
    include_full_plan: bool = True,
) -> Trip:
    """One trip + its committed phase plan, mirroring test_phases.py's seed_trip
    layout: trip_creation completed, everything else pending."""
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-TEST-{order_number}", order_number=order_number,
        operator_organization_id=seed["org"].id, client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id, horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id, destination_precinct_id=seed["dest"].id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=seed["origin"].id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()

    rows = [
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id, sequence_number=1, status=PhaseStatus.PENDING),
    ]
    if include_full_plan:
        rows += [
            PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id, sequence_number=2, status=PhaseStatus.PENDING),
            PhaseEvent(trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id, sequence_number=3, status=PhaseStatus.PENDING),
            PhaseEvent(trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id, sequence_number=4, status=PhaseStatus.PENDING),
            PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
            PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
        ]
    db_session.add_all(rows)
    await db_session.flush()
    return trip


async def _phase_id(client: AsyncClient, trip_id, token, phase_type: str) -> str:
    """Resolve a row's id from a real GET /phases call — never a hardcoded id."""
    resp = await client.get(f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token))
    row = next(p for p in resp.json() if p["phase_type"] == phase_type)
    return row["phase_event_id"]


def _dispatcher_token(seed) -> str:
    return make_token(sub=str(seed["dispatcher"].id), role="dispatcher")


# ── cancel ──────────────────────────────────────────────────────────────────

async def test_cancel_sets_cancelled_and_preserves_phase_rows(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="CANCEL-1")
    token = _dispatcher_token(seed)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "cargo pulled, trip abandoned"},
        headers=auth_header(token),
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    rows = (await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id == trip.id)
    )).scalars().all()
    activation = next(r for r in rows if r.phase_type == PhaseType.ACTIVATION)
    assert activation.status == PhaseStatus.PENDING


async def test_cancel_rejects_a_closed_trip(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="CANCEL-2", status=TripStatus.CLOSED)
    token = _dispatcher_token(seed)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "too late"},
        headers=auth_header(token),
    )

    assert resp.status_code == 409


async def test_cancel_frees_the_driver_to_activate_another_trip(client: AsyncClient, db_session, seed):
    stuck_trip = await _make_trip(db_session, seed, order_number="CANCEL-3A", status=TripStatus.ACTIVE)
    second_trip = await _make_trip(db_session, seed, order_number="CANCEL-3B", status=TripStatus.CREATED)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    dispatcher_token = _dispatcher_token(seed)

    activation_id = await _phase_id(client, second_trip.id, driver_token, "activation")
    blocked = await client.post(
        f"/api/v1/trips/{second_trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert blocked.status_code == 409

    cancel_resp = await client.post(
        f"/api/v1/trips/{stuck_trip.id}/cancel", json={"note": "vehicle broke down"},
        headers=auth_header(dispatcher_token),
    )
    assert cancel_resp.status_code == 200

    unblocked = await client.post(
        f"/api/v1/trips/{second_trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert unblocked.status_code == 200


# ── override ────────────────────────────────────────────────────────────────

async def test_override_resolves_a_pending_phase_and_unblocks_the_next(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="OVERRIDE-1")
    dispatcher_token = _dispatcher_token(seed)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "driver's phone was wiped, cannot complete activation"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 200
    body = resp.json()
    activation = next(p for p in body["phases"] if p["phase_type"] == "activation")
    assert activation["status"] == "overridden"
    # Step 6 — the override fields reach the wire, not just the DB row.
    assert activation["dispatcher_override_note"] == "driver's phone was wiped, cannot complete activation"
    assert activation["dispatcher_override_user_id"] == str(seed["dispatcher"].id)

    loading_id = await _phase_id(client, trip.id, driver_token, "loading")
    unblocked = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={"phase_type": "loading", "driver_visual_count": 5, "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(driver_token),
    )
    assert unblocked.status_code == 200


async def test_override_rejects_a_completed_phase(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="OVERRIDE-2")
    dispatcher_token = _dispatcher_token(seed)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")
    await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "too late, already completed"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 409


async def test_override_leaves_anchor_status_untouched(client: AsyncClient, db_session, seed):
    """D3 — an override must not fabricate an anchor state.

    Deliberately overrides a DEPARTURE, not an activation. Departure is P3: an
    anchored phase, so its anchor_status is PENDING — a receipt is genuinely owed.
    An activation is never anchored, so its anchor_status is the column's
    server_default ('not_required') and asserting that value would hold no matter
    what the code did, including if override_phase explicitly wrote NOT_REQUIRED —
    which is exactly the laundering D3 forbids. Only the PENDING case can fail.
    """
    trip = await _make_trip(db_session, seed, order_number="OVERRIDE-3")
    dispatcher_token = _dispatcher_token(seed)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")

    departure = (await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip.id, PhaseEvent.phase_type == PhaseType.DEPARTURE,
        )
    )).scalar_one()
    departure.anchor_status = AnchorStatus.PENDING
    await db_session.flush()

    departure_id = await _phase_id(client, trip.id, driver_token, "departure")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{departure_id}/override",
        json={"note": "driver stranded, no seal evidence exists"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 200
    body = resp.json()
    overridden = next(p for p in body["phases"] if p["phase_type"] == "departure")
    assert overridden["status"] == "overridden"
    # Still PENDING: the receipt this phase owed never landed, and the system keeps
    # saying so. NOT_REQUIRED would launder a real gap in the evidence chain;
    # FAILED would claim an anchor was attempted. Neither is true, so neither is written.
    assert overridden["anchor_status"] == "pending"


async def test_override_requires_a_note(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="OVERRIDE-4")
    dispatcher_token = _dispatcher_token(seed)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": ""},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 422


async def test_override_of_the_last_pending_phase_closes_the_trip(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="OVERRIDE-5", include_full_plan=False)
    dispatcher_token = _dispatcher_token(seed)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "driver unreachable, trip has no remaining plan"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


async def test_admin_routes_reject_a_foreign_org_trip(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="FOREIGN-1")

    other_org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(other_org)
    await db_session.flush()
    other_dispatcher = User(
        id=uuid.uuid4(), organization_id=other_org.id,
        email="other-dispatcher@test.co.za", full_name="Other Dispatcher",
    )
    db_session.add(other_dispatcher)
    await db_session.flush()
    other_token = make_token(sub=str(other_dispatcher.id), role="dispatcher")

    cancel_resp = await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "not my trip"},
        headers=auth_header(other_token),
    )
    assert cancel_resp.status_code == 404

    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")
    override_resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "not my trip"},
        headers=auth_header(other_token),
    )
    assert override_resp.status_code == 404


# ── D5: the intervention lands on the ledger ────────────────────────────────
# The point of an evidence platform is that a human bypassing a gate is itself an
# event worth recording. Without these, D5 was asserted in comments and nowhere else.


async def _exceptions_for(db_session, trip_id) -> list[TripException]:
    result = await db_session.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    return list(result.scalars().all())


async def test_cancel_writes_a_dispatcher_exception_to_the_ledger(
    client: AsyncClient, db_session, seed,
):
    trip = await _make_trip(db_session, seed, order_number="LEDGER-1", status=TripStatus.ACTIVE)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "cargo pulled by client"},
        headers=auth_header(_dispatcher_token(seed)),
    )

    assert resp.status_code == 200
    rows = await _exceptions_for(db_session, trip.id)
    assert len(rows) == 1
    assert rows[0].exception_type == ExceptionType.DISPATCHER_NOTE
    assert rows[0].source == ExceptionSource.DISPATCHER
    assert rows[0].severity == ExceptionSeverity.WARNING
    assert "cargo pulled by client" in rows[0].description
    # Attributable, not anonymous — see cancel_trip's note on the missing
    # raised_by_user_id column.
    assert str(seed["dispatcher"].id) in rows[0].description


async def test_override_writes_a_dispatcher_exception_to_the_ledger(
    client: AsyncClient, db_session, seed,
):
    trip = await _make_trip(db_session, seed, order_number="LEDGER-2")
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "driver's phone was wiped"},
        headers=auth_header(_dispatcher_token(seed)),
    )

    assert resp.status_code == 200
    rows = await _exceptions_for(db_session, trip.id)
    assert len(rows) == 1
    assert rows[0].exception_type == ExceptionType.DISPATCHER_NOTE
    assert rows[0].source == ExceptionSource.DISPATCHER
    assert rows[0].severity == ExceptionSeverity.WARNING
    assert rows[0].description == "driver's phone was wiped"
    # Scoped to the row it overrode, so the ledger entry is not merely trip-level.
    assert str(rows[0].phase_event_id) == activation_id


# ── terminal-trip guard ─────────────────────────────────────────────────────
# cancel_trip leaves every phase row PENDING on purpose (evidence, not
# completion), so without an explicit trip-status guard a cancelled trip's rows
# still look overridable — and recompute_position's unconditional close-branch
# would rewrite CANCELLED as CLOSED. These pin that it cannot happen.


async def test_override_rejects_a_cancelled_trip(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="TERM-1", status=TripStatus.ACTIVE)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    dispatcher_token = _dispatcher_token(seed)
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    cancelled = await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "cargo pulled"},
        headers=auth_header(dispatcher_token),
    )
    assert cancelled.status_code == 200

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "driver unreachable"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 409


async def test_override_of_a_cancelled_trips_last_phase_leaves_it_cancelled(
    client: AsyncClient, db_session, seed,
):
    """The regression this guard exists for: activation is the ONLY unresolved row,
    so an unguarded override would resolve the plan and let recompute_position
    overwrite CANCELLED with CLOSED — silently erasing the cancellation."""
    trip = await _make_trip(
        db_session, seed, order_number="TERM-2", status=TripStatus.ACTIVE,
        include_full_plan=False,
    )
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    dispatcher_token = _dispatcher_token(seed)
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    await client.post(
        f"/api/v1/trips/{trip.id}/cancel", json={"note": "vehicle broken down"},
        headers=auth_header(dispatcher_token),
    )
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "driver unreachable"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 409
    await db_session.refresh(trip)
    assert trip.status == TripStatus.CANCELLED


async def test_override_rejects_a_closed_trip(client: AsyncClient, db_session, seed):
    trip = await _make_trip(db_session, seed, order_number="TERM-3", status=TripStatus.CLOSED)
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    activation_id = await _phase_id(client, trip.id, driver_token, "activation")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{activation_id}/override",
        json={"note": "too late"},
        headers=auth_header(_dispatcher_token(seed)),
    )

    assert resp.status_code == 409
