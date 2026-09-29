"""Integration tests for the ARRIVAL phase (the seal inspection at the destination
gate, before anything is opened): POST /trips/{trip_id}/phases/{phase_event_id}/complete
with phase_type="arrival", exercised over real HTTP.

The seal comparison used to live in advance_unloading; it moved whole to its own
phase, completed before unloading can run, so "inspected before opened" is a
sequence rule the server enforces rather than an order photos happen to be taken
in (see advance_arrival's own docstring in app/orchestration/phase_service.py).

Reuses override_get_db, _phase_id, _make_artifact, _walk_to_in_transit and
_complete_in_transit from tests/integration/test_phases.py rather than
reinventing them — this file is the arrival-specific complement to that one.
`_seed_trip` below is a plain async function, not a pytest fixture reused
across modules (matching test_trip_admin.py's own `_make_trip` precedent),
since a same-named fixture parameter imported from another module reads to
static analysis as an unused-import shadow.
"""

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import (
    ExceptionSeverity, ExceptionType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle

from tests.conftest import auth_header, make_token
from tests.integration.test_phases import (  # noqa: F401  (override_get_db is a fixture)
    _complete_in_transit, _make_artifact, _phase_id, _walk_to_in_transit, override_get_db,
)


async def _seed_trip(db_session) -> tuple[Trip, Driver]:
    """One trip + its full pending phase plan, mirroring test_phases.py's own
    seed_trip fixture (kept as a plain function here — see module docstring)."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex[:8]}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number=uuid.uuid4().hex[:13], phone_number=f"+2782{uuid.uuid4().hex[:7]}",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"AR{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:8]}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-ARR-{uuid.uuid4().hex[:8]}", order_number=f"ORD-ARR-{uuid.uuid4().hex[:8]}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db_session.add_all([stop0, stop1])
    await db_session.flush()
    db_session.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id, sequence_number=1, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop0.id, sequence_number=2, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.DEPARTURE, trip_stop_id=stop0.id, sequence_number=3, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.IN_TRANSIT, trip_stop_id=stop0.id, sequence_number=4, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.ARRIVAL, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=7, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    return trip, driver


async def _walk_to_arrival(client: AsyncClient, db_session, trip, token: str) -> None:
    """activation -> loading -> departure -> in_transit, leaving the trip sitting on
    a PENDING arrival row — the shortest legal path to the seal inspection."""
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)


async def _complete_arrival(
    client: AsyncClient, trip_id, token: str, *, seal_photo_artifact_id: str, **fields,
):
    arrival_id = await _phase_id(client, trip_id, token, "arrival")
    body = {
        "phase_type": "arrival",
        "seal_photo_artifact_id": seal_photo_artifact_id,
        "idempotency_key": str(uuid.uuid4()),
        **fields,
    }
    return await client.post(
        f"/api/v1/trips/{trip_id}/phases/{arrival_id}/complete",
        json=body,
        headers=auth_header(token),
    )


async def _dispatcher_token_for(db_session, trip) -> str:
    """_seed_trip creates exactly one User for the operator org — resolved by
    query, never a hardcoded id, matching test_phase_service.py's override
    test precedent."""
    user = (await db_session.execute(
        select(User).where(User.organization_id == trip.operator_organization_id)
    )).scalar_one()
    return make_token(sub=str(user.id), role="dispatcher")


async def _arrival_row(db_session, trip_id) -> PhaseEvent:
    return (await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == PhaseType.ARRIVAL,
        )
    )).scalar_one()


# ── happy path ───────────────────────────────────────────────────────────────

async def test_arrival_intact_matching_seal_completes_with_no_exceptions(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="intact", seal_number_at_arrival="AB-1234",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["exceptions"] == []
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "completed"
    assert arrival["seal_number"] == "AB-1234"
    assert arrival["seal_condition"] == "intact"
    assert arrival["seal_photo_artifact_id"] == seal_photo_id

    trip_id = trip.id  # captured before expire_all() — see MissingGreenlet note elsewhere
    db_session.expire_all()
    row = await _arrival_row(db_session, trip_id)
    assert row.seal_number == "AB-1234"
    assert row.seal_condition == "intact"
    assert str(row.seal_photo_artifact_id) == seal_photo_id


# ── seal outcomes ────────────────────────────────────────────────────────────

async def test_arrival_seal_number_mismatch_raises_one_critical_exception(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="intact", seal_number_at_arrival="ZZ-9999",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    assert len(body["exceptions"]) == 1
    assert body["exceptions"][0]["exception_type"] == "seal_mismatch"
    assert body["exceptions"][0]["severity"] == "critical"


async def test_arrival_damaged_seal_raises_seal_compromised(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="damaged", seal_number_at_arrival="AB-1234",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    exception_types = {e["exception_type"] for e in body["exceptions"]}
    assert "seal_compromised" in exception_types
    compromised = next(e for e in body["exceptions"] if e["exception_type"] == "seal_compromised")
    assert compromised["severity"] == "critical"


async def test_arrival_missing_seal_with_no_number_is_accepted_and_raises_seal_compromised(
    client: AsyncClient, db_session,
):
    """A missing seal is photographed as a missing seal — the empty hasp is the
    evidence — so no seal number is required for this one condition."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id, seal_condition="missing",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    assert arrival["seal_number"] is None
    exception_types = {e["exception_type"] for e in body["exceptions"]}
    assert "seal_compromised" in exception_types


async def test_arrival_intact_without_a_seal_number_is_rejected(
    client: AsyncClient, db_session,
):
    """Only MISSING waives the number requirement — an intact/damaged seal usually
    still shows its number, so the driver is not let off recording it."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id, seal_condition="intact",
    )

    assert resp.status_code == 422


async def test_arrival_with_no_departure_seal_raises_seal_unverified(
    client: AsyncClient, db_session,
):
    """No seal recorded at departure is a data-integrity anomaly (advance_departure
    writes seal_number unconditionally), not a mismatch — the finding is narrower
    and stays loud (CRITICAL) precisely because nothing legitimate produces it."""
    trip, driver = await _seed_trip(db_session)
    trip_id = trip.id  # captured before expire_all() — see MissingGreenlet note elsewhere
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)

    db_session.expire_all()
    departure = (await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == PhaseType.DEPARTURE,
        )
    )).scalar_one()
    departure.seal_number = None
    await db_session.flush()

    seal_photo_id = await _make_artifact(db_session, trip_id)
    resp = await _complete_arrival(
        client, trip_id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="intact", seal_number_at_arrival="AB-1234",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["exceptions"]) == 1
    assert body["exceptions"][0]["exception_type"] == "seal_unverified"
    assert body["exceptions"][0]["severity"] == "critical"


# ── combined seal findings ───────────────────────────────────────────────────

async def test_arrival_damaged_seal_with_wrong_number_raises_compromised_and_mismatch(
    client: AsyncClient, db_session,
):
    """The two findings are independent (advance_arrival's own comment): a damaged
    seal that also carries the wrong number records both, not just one."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="damaged", seal_number_at_arrival="ZZ-9999",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    findings = {(e["exception_type"], e["severity"]) for e in body["exceptions"]}
    assert findings == {
        (ExceptionType.SEAL_COMPROMISED.value, ExceptionSeverity.CRITICAL.value),
        (ExceptionType.SEAL_MISMATCH.value, ExceptionSeverity.CRITICAL.value),
    }


async def test_arrival_damaged_seal_with_no_departure_seal_raises_compromised_and_unverified(
    client: AsyncClient, db_session,
):
    """No departure seal to compare against means no mismatch is possible — the
    damaged-seal finding and the unverified-continuity finding both still fire,
    independently of each other, and neither is a mismatch."""
    trip, driver = await _seed_trip(db_session)
    trip_id = trip.id  # captured before expire_all() — see MissingGreenlet note elsewhere
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)

    db_session.expire_all()
    departure = (await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == PhaseType.DEPARTURE,
        )
    )).scalar_one()
    departure.seal_number = None
    await db_session.flush()

    seal_photo_id = await _make_artifact(db_session, trip_id)
    resp = await _complete_arrival(
        client, trip_id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="damaged", seal_number_at_arrival="AB-9999",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    findings = {(e["exception_type"], e["severity"]) for e in body["exceptions"]}
    assert findings == {
        (ExceptionType.SEAL_COMPROMISED.value, ExceptionSeverity.CRITICAL.value),
        (ExceptionType.SEAL_UNVERIFIED.value, ExceptionSeverity.CRITICAL.value),
    }


async def test_arrival_missing_seal_with_departure_seal_present_raises_only_compromised(
    client: AsyncClient, db_session,
):
    """A missing seal has no number to compare, so it must never ALSO raise
    seal_mismatch — even though the departure leg genuinely has a seal on record."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id, seal_condition="missing",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "exception"
    findings = {(e["exception_type"], e["severity"]) for e in body["exceptions"]}
    assert findings == {
        (ExceptionType.SEAL_COMPROMISED.value, ExceptionSeverity.CRITICAL.value),
    }


# ── sequencing: arrival gates unloading ─────────────────────────────────────

async def test_unloading_before_arrival_is_rejected(client: AsyncClient, db_session):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    assert resp.status_code == 409


async def test_unloading_after_arrival_completes_with_only_base_fields(
    client: AsyncClient, db_session,
):
    """UnloadingCompleteRequest carries no seal fields any more — the seal moved
    whole to ArrivalCompleteRequest — so a base-only body is all it needs."""
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="intact", seal_number_at_arrival="AB-1234",
    )
    assert resp.status_code == 200, resp.text

    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )

    assert resp.status_code == 200, resp.text
    unloading = next(p for p in resp.json()["phases"] if p["phase_type"] == "unloading")
    assert unloading["status"] == "completed"


# ── dispatcher override ─────────────────────────────────────────────────────

async def test_dispatcher_override_of_arrival_writes_warning_seal_unverified_and_dispatcher_note(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, driver_token)
    dispatcher_token = await _dispatcher_token_for(db_session, trip)

    arrival_id = await _phase_id(client, trip.id, driver_token, "arrival")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/override",
        json={"note": "driver's phone was wiped; the seal could not be inspected"},
        headers=auth_header(dispatcher_token),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    arrival = next(p for p in body["phases"] if p["phase_type"] == "arrival")
    assert arrival["status"] == "overridden"

    exceptions = (await db_session.execute(
        select(TripException).where(
            TripException.trip_id == trip.id, TripException.phase_event_id == uuid.UUID(arrival_id),
        )
    )).scalars().all()
    by_type = {e.exception_type: e for e in exceptions}
    assert ExceptionType.SEAL_UNVERIFIED in by_type
    assert by_type[ExceptionType.SEAL_UNVERIFIED].severity == ExceptionSeverity.WARNING
    assert ExceptionType.DISPATCHER_NOTE in by_type
    assert by_type[ExceptionType.DISPATCHER_NOTE].description == (
        "driver's phone was wiped; the seal could not be inspected"
    )


# ── auth / not-found / validation ───────────────────────────────────────────

async def test_arrival_complete_unknown_driver_token_returns_401(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    owner_token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, owner_token)
    arrival_id = await _phase_id(client, trip.id, owner_token, "arrival")
    seal_photo_id = await _make_artifact(db_session, trip.id)

    other_driver_token = make_token(sub=str(uuid.uuid4()), role="driver")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234", "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(other_driver_token),
    )

    assert resp.status_code == 401


async def test_arrival_complete_unknown_trip_returns_404(client: AsyncClient, db_session):
    driver = (await _seed_trip(db_session))[1]
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{uuid.uuid4()}/phases/{uuid.uuid4()}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234", "seal_photo_artifact_id": str(uuid.uuid4()),
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 404


async def test_arrival_complete_unknown_phase_event_returns_404(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{uuid.uuid4()}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234", "seal_photo_artifact_id": str(uuid.uuid4()),
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 404


async def test_arrival_complete_missing_seal_photo_returns_422(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    arrival_id = await _phase_id(client, trip.id, token, "arrival")

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )

    assert resp.status_code == 422
    assert "seal_photo_artifact_id" in resp.text


async def test_arrival_complete_missing_seal_with_number_returns_422_without_completing(
    client: AsyncClient, db_session,
):
    trip, driver = await _seed_trip(db_session)
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip.id)

    resp = await _complete_arrival(
        client, trip.id, token,
        seal_photo_artifact_id=seal_photo_id,
        seal_condition="missing", seal_number_at_arrival="AB-1234",
    )

    assert resp.status_code == 422
    assert "seal_number_at_arrival" in resp.text
    arrival = await _arrival_row(db_session, trip.id)
    assert arrival.status == PhaseStatus.PENDING
