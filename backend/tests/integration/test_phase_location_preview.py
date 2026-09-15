"""Integration coverage for the read-only phase location preview boundary."""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db.models.evidence import EvidenceArtifact
from app.db.models.enums import OrganizationType, PhaseStatus, TripStatus
from app.db.models.organisations import Organization
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.people import Driver
from app.db.models.transit import TripException
from tests.conftest import auth_header, make_token

# Reuse the real Pulsit mock boundary and a fully planned trip fixture.  The
# preview must be measured against the same adapter completion uses, not a test-only
# replacement that could hide an accidental persistence call.
pytest_plugins = ("tests.integration.test_phase_corroboration",)


async def _phase_id(client: AsyncClient, trip_id: uuid.UUID, token: str) -> str:
    response = await client.get(
        f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token),
    )
    return next(item for item in response.json() if item["phase_type"] == "activation")["phase_event_id"]


def _capture() -> dict[str, object]:
    return {
        "driver_phone_lat": -33.9249,
        "driver_phone_lng": 18.4241,
        "driver_captured_at": datetime.now(UTC).isoformat(),
        "driver_accuracy_metres": 10.0,
    }


async def _preview(
    client: AsyncClient, trip_id: uuid.UUID, phase_event_id: str, token: str, payload: dict[str, object] | None = None,
):
    return await client.post(
        f"/api/v1/trips/{trip_id}/phases/{phase_event_id}/location-preview",
        headers=auth_header(token), json=_capture() if payload is None else payload,
    )


async def _state_counts(db_session) -> tuple[int, int, int]:
    evidence = await db_session.scalar(select(func.count()).select_from(EvidenceArtifact))
    exceptions = await db_session.scalar(select(func.count()).select_from(TripException))
    snapshots = await db_session.scalar(select(func.count()).select_from(TrailerGpsSnapshot))
    return int(evidence or 0), int(exceptions or 0), int(snapshots or 0)


async def test_location_preview_assesses_without_writing_evidence_or_progression(
    client: AsyncClient, db_session, corroboration_trip,
) -> None:
    """Removing the read-only service path must make this success/no-write contract fail."""
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)
    before = await _state_counts(db_session)

    response = await _preview(client, trip.id, phase_event_id, token)

    assert response.status_code == 200
    assert response.json()["proximity"] in {"within_limit", "separated", "unverified"}
    assert await _state_counts(db_session) == before
    event = await db_session.get(PhaseEvent, uuid.UUID(phase_event_id))
    assert event is not None
    assert event.status == PhaseStatus.PENDING
    assert event.completed_at is None
    assert event.action_location_assessment is None


async def test_location_preview_requires_authenticated_assigned_driver(
    client: AsyncClient, db_session, corroboration_trip,
) -> None:
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)
    other_organization = Organization(
        id=uuid.uuid4(), name="Other operator", org_type=OrganizationType.OPERATOR,
    )
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=other_organization.id, full_name="Other driver",
        id_number="8001015009088", phone_number="+27821234568", license_number="DRV-OTHER",
    )
    db_session.add_all([other_organization, other_driver])
    await db_session.flush()

    unauthenticated = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/location-preview", json=_capture(),
    )
    wrong_driver = await _preview(
        client, trip.id, phase_event_id, make_token(sub=str(other_driver.id), role="driver"),
    )

    assert unauthenticated.status_code == 403
    assert wrong_driver.status_code == 404


async def test_location_preview_rejects_foreign_phase_and_malformed_capture(
    client: AsyncClient, corroboration_trip,
) -> None:
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)

    foreign_phase = await _preview(client, trip.id, str(uuid.uuid4()), token)
    malformed = await _preview(client, trip.id, phase_event_id, token, {
        **_capture(), "driver_phone_lat": 91.0,
    })

    assert foreign_phase.status_code == 404
    assert malformed.status_code == 422


async def test_location_preview_returns_unverified_when_tracker_is_unavailable(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
) -> None:
    trip, driver, org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)
    before = await _state_counts(db_session)
    pulsit_store.data.clear()

    response = await _preview(client, trip.id, phase_event_id, token)

    assert response.status_code == 200
    assert response.json()["proximity"] == "unverified"
    assert "missing_tracker" in response.json()["reasons"]
    assert await _state_counts(db_session) == before


async def test_phase_completion_re_evaluates_after_a_successful_preview(
    client: AsyncClient, db_session, corroboration_trip, pulsit_store,
) -> None:
    """A preview's result is advisory; completion must take and persist its own reading."""
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)

    preview = await _preview(client, trip.id, phase_event_id, token)
    assert preview.status_code == 200
    pulsit_store.data.clear()

    completion = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        headers=auth_header(token),
        json={
            "phase_type": "activation",
            "idempotency_key": f"completion-{uuid.uuid4()}",
            **_capture(),
        },
    )

    assert completion.status_code == 200
    event = await db_session.get(PhaseEvent, uuid.UUID(phase_event_id))
    assert event is not None
    assert event.action_location_assessment is not None
    assert event.action_location_assessment["proximity"] == "unverified"
    assert "missing_tracker" in event.action_location_assessment["reasons"]


@pytest.mark.parametrize("terminal", ["phase", "trip"])
async def test_location_preview_rejects_stale_or_terminal_state_without_mutation(
    client: AsyncClient, db_session, corroboration_trip, terminal: str,
) -> None:
    trip, driver, _org, _stop = corroboration_trip
    token = make_token(sub=str(driver.id), role="driver")
    phase_event_id = await _phase_id(client, trip.id, token)
    event = await db_session.get(PhaseEvent, uuid.UUID(phase_event_id))
    assert event is not None
    if terminal == "phase":
        event.status = PhaseStatus.COMPLETED
    else:
        trip.status = TripStatus.CANCELLED
    await db_session.flush()
    before = await _state_counts(db_session)

    response = await _preview(client, trip.id, phase_event_id, token)

    assert response.status_code == 409
    assert await _state_counts(db_session) == before
    refreshed = await db_session.get(PhaseEvent, uuid.UUID(phase_event_id))
    assert refreshed is not None
    assert refreshed.status == (PhaseStatus.COMPLETED if terminal == "phase" else PhaseStatus.PENDING)
