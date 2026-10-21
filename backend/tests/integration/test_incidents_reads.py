"""Integration tests for the incident read side beyond the detail itself: the evidence view
(GET /incidents/{id}/evidence) and the hijacking response guide on the detail.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio

from app.db.models.enums import (
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
)
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
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


async def _trip_with_shortage(db_session, seed) -> tuple[Trip, Consignment, list[Parcel]]:
    """An active trip carrying one consignment of 4 parcels, all scanned out, 1 scanned in."""
    suffix = uuid.uuid4().hex[:8]
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-INCR-{suffix}", order_number=f"INCR-{suffix}",
        operator_organization_id=seed["org"].id, client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id, horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id, destination_precinct_id=seed["dest"].id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED, planned_departure_at=datetime.now(UTC),
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()
    db_session.add_all([
        TripStop(trip_id=trip.id, precinct_id=seed["origin"].id, sequence=0),
        TripStop(trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1),
    ])
    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WB-{suffix}", parcel_count_expected=4,
    )
    db_session.add(consignment)
    await db_session.flush()
    out_at = datetime.now(UTC) - timedelta(hours=6)
    parcels = [
        Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"B{i}-{suffix}", pp_scan_out_at=out_at,
            pp_scan_in_at=out_at + timedelta(hours=5) if i == 0 else None,
        )
        for i in range(4)
    ]
    db_session.add_all(parcels)
    await db_session.flush()
    return trip, consignment, parcels


def _token(seed) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed["dispatcher"].id), role="dispatcher"))


async def _exception(db_session, trip: Trip) -> TripException:
    exc = TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING, description="3 short",
        review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    db_session.add(exc)
    await db_session.flush()
    return exc


async def _report(client, seed, trip: Trip, **overrides) -> dict:
    body = {
        "incident_type": "parcel_shortage", "summary": "3 parcels short", "reporter_role": "receiver",
        "report_channel": "phone", "confidence": "reported", **overrides,
    }
    resp = await client.post(f"/api/v1/trips/{trip.id}/incidents", json=body, headers=_token(seed))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_evidence_counts_no_scan_in_recorded_per_consignment(client, db_session, seed):
    trip, consignment, _ = await _trip_with_shortage(db_session, seed)
    incident = await _report(client, seed, trip)

    resp = await client.get(f"/api/v1/incidents/{incident['incident_id']}/evidence", headers=_token(seed))

    assert resp.status_code == 200
    summary = next(c for c in resp.json()["consignments"] if c["consignment_id"] == str(consignment.id))
    assert summary["parcel_count_expected"] == 4
    assert summary["scanned_out"] == 4
    assert summary["scanned_in"] == 1
    assert summary["no_scan_in_recorded"] == 3


async def test_evidence_lists_trip_exceptions_with_holding_incident(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)
    grouped = await _exception(db_session, trip)
    loose = await _exception(db_session, trip)
    incident = await _report(client, seed, trip, exception_ids=[str(grouped.id)])

    resp = await client.get(f"/api/v1/incidents/{incident['incident_id']}/evidence", headers=_token(seed))

    holders = {e["exception_id"]: e["incident_id"] for e in resp.json()["trip_exceptions"]}
    assert holders[str(grouped.id)] == incident["incident_id"]
    assert holders[str(loose.id)] is None


async def test_evidence_position_reference_is_reported_time_when_known(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)
    occurred = datetime.now(UTC) - timedelta(hours=2)
    incident = await _report(client, seed, trip, reported_occurred_at=occurred.isoformat())

    resp = await client.get(f"/api/v1/incidents/{incident['incident_id']}/evidence", headers=_token(seed))

    assert datetime.fromisoformat(resp.json()["position_reference_time"]) == occurred


async def test_evidence_404_other_org(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)
    incident = await _report(client, seed, trip)
    org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other = User(id=uuid.uuid4(), organization_id=org.id, email=f"x-{uuid.uuid4().hex[:6]}@t.co.za", full_name="X")
    db_session.add(other)
    await db_session.flush()

    resp = await client.get(
        f"/api/v1/incidents/{incident['incident_id']}/evidence",
        headers=auth_header(make_token(sub=str(other.id), role="dispatcher")),
    )

    assert resp.status_code == 404


async def test_hijacking_detail_carries_response_guide(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)

    incident = await _report(
        client, seed, trip, incident_type="hijacking", reporter_role="tracking_company", stop_trip=True,
        all_parcels=True,
    )

    guide = {step["key"]: step["state"] for step in incident["response_guide"]}
    assert guide["trip_stopped"] == "done"
    assert guide["saps_reported"] == "todo"


async def test_hijacking_guide_tracks_recorded_actions(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)
    incident = await _report(client, seed, trip, incident_type="hijacking", reporter_role="driver")

    resp = await client.post(
        f"/api/v1/incidents/{incident['incident_id']}/updates",
        json={"kind": "external_action", "action": "saps_reported"}, headers=_token(seed),
    )

    guide = {step["key"]: step["state"] for step in resp.json()["response_guide"]}
    assert guide["saps_reported"] == "in_progress"
    assert guide["trip_stopped"] == "todo"


async def test_shortage_detail_has_no_response_guide(client, db_session, seed):
    trip, _, _ = await _trip_with_shortage(db_session, seed)

    incident = await _report(client, seed, trip)

    assert incident["response_guide"] is None
