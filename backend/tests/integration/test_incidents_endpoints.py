"""Integration tests for incidents: reporting, follow-up, closing, reopening and reading back.

  POST /trips/{trip_id}/incidents, GET /trips/{trip_id}/incidents
  GET /incidents, GET /incidents/{id}
  POST /incidents/{id}/updates, /close, /reopen

Every write asserts DB state afterwards, and _assert_cache_matches_ledger checks the rule the
whole design rests on: the Incident row's status/owner/outcome columns equal a replay of its
append-only ledger.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text

from app.db.models.audit_packs import IncidentDeclaration
from app.db.models.enums import (
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
)
from app.db.models.incidents import Incident, IncidentParcel, IncidentUpdate
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.orchestration.incidents.creation import TRIP_STOPPED_NOTE
from app.orchestration.incidents.ledger import to_fact
from app.orchestration.incidents.state import THEFT_REPORTED_WITHOUT_CAS, replay

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _make_trip(db_session, seed, *, status: TripStatus = TripStatus.ACTIVE) -> Trip:
    suffix = uuid.uuid4().hex[:8]
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-INC-{suffix}", order_number=f"INC-{suffix}",
        operator_organization_id=seed["org"].id, client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id, horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id, destination_precinct_id=seed["dest"].id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED, planned_departure_at=datetime.now(UTC),
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()
    db_session.add_all([
        TripStop(trip_id=trip.id, precinct_id=seed["origin"].id, sequence=0),
        TripStop(trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1),
    ])
    await db_session.flush()
    return trip


async def _make_parcels(db_session, trip: Trip, *, count: int = 3, scanned_in: int = 0) -> list[Parcel]:
    """`count` parcels scanned out at origin, the first `scanned_in` of them scanned in again."""
    consignment = Consignment(id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WB-{uuid.uuid4().hex[:6]}")
    db_session.add(consignment)
    await db_session.flush()
    out_at = datetime.now(UTC) - timedelta(hours=5)
    parcels = [
        Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"P{i}-{uuid.uuid4().hex[:6]}",
            pp_scan_out_at=out_at, pp_scan_in_at=out_at + timedelta(hours=4) if i < scanned_in else None,
        )
        for i in range(count)
    ]
    db_session.add_all(parcels)
    await db_session.flush()
    return parcels


async def _make_exception(db_session, trip: Trip, exception_type: ExceptionType = ExceptionType.PARCEL_COUNT_MISMATCH) -> TripException:
    exc = TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=exception_type, source=ExceptionSource.SYSTEM,
        severity=ExceptionSeverity.WARNING, description="3 parcels short at delivery",
        review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    db_session.add(exc)
    await db_session.flush()
    return exc


def _token(seed) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed["dispatcher"].id), role="dispatcher"))


def _shortage_body(**overrides):
    body = {
        "incident_type": "parcel_shortage", "summary": "Receiver counted 3 parcels short",
        "reported_by_name": "J. Receiver", "reporter_role": "receiver", "report_channel": "phone",
        "confidence": "reported",
    }
    return {**body, **overrides}


async def _report(client: AsyncClient, seed, trip: Trip, **overrides):
    return await client.post(f"/api/v1/trips/{trip.id}/incidents", json=_shortage_body(**overrides), headers=_token(seed))


async def _assert_cache_matches_ledger(db_session, incident_id) -> None:
    db_session.expire_all()
    incident = (await db_session.execute(select(Incident).where(Incident.id == incident_id))).scalar_one()
    entries = (await db_session.execute(
        select(IncidentUpdate).where(IncidentUpdate.incident_id == incident_id).order_by(IncidentUpdate.sequence)
    )).scalars().all()
    state = replay([to_fact(e) for e in entries])
    assert incident.status == state.status
    assert incident.confidence == state.confidence
    assert incident.assigned_to_user_id == state.assigned_to
    assert incident.outcome == state.outcome
    assert incident.closed_at == state.closed_at
    assert incident.closure_reason == state.closure_reason
    parcels = (await db_session.execute(select(IncidentParcel).where(IncidentParcel.incident_id == incident_id))).scalars().all()
    for named in parcels:
        assert named.latest_finding == state.parcel_findings.get(named.parcel_id)


async def _other_org_dispatcher(db_session) -> User:
    org = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"o-{uuid.uuid4().hex[:6]}@t.co.za", full_name="Other")
    db_session.add(user)
    await db_session.flush()
    return user


async def test_report_incident_returns_201_with_opened_and_assigned_entries(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip)
    exc = await _make_exception(db_session, trip)

    resp = await _report(client, seed, trip, exception_ids=[str(exc.id)], parcel_ids=[str(p.id) for p in parcels])

    assert resp.status_code == 201
    body = resp.json()
    assert body["reference"] == "INC1"
    assert body["status"] == "open"
    assert body["confidence"] == "reported"
    assert body["assigned_to_user_id"] == str(seed["dispatcher"].id)
    assert [u["kind"] for u in body["updates"]][:2] == ["opened", "assigned"]
    assert body["exceptions_total"] == 1 and body["parcels_total"] == 3 and body["parcels_unresolved"] == 3
    assert (await db_session.execute(select(Trip.status).where(Trip.id == trip.id))).scalar_one() == TripStatus.ACTIVE
    await _assert_cache_matches_ledger(db_session, uuid.UUID(body["incident_id"]))


async def test_report_incident_numbers_per_trip(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    await _report(client, seed, trip)
    second = await _report(client, seed, trip)

    assert second.json()["reference"] == "INC2"


async def test_report_incident_without_token_403(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    resp = await client.post(f"/api/v1/trips/{trip.id}/incidents", json=_shortage_body())

    assert resp.status_code == 403


async def test_report_incident_malformed_token_401(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/incidents", json=_shortage_body(), headers=auth_header("not-a-jwt"),
    )

    assert resp.status_code == 401


async def test_report_incident_422_unknown_type(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    resp = await _report(client, seed, trip, incident_type="breakdown")

    assert resp.status_code == 422


async def test_report_incident_404_other_org_trip(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    other = await _other_org_dispatcher(db_session)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/incidents", json=_shortage_body(),
        headers=auth_header(make_token(sub=str(other.id), role="dispatcher")),
    )

    assert resp.status_code == 404


async def test_report_hijacking_stop_trip_cancels_trip_without_naming_hijacking(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=2)

    resp = await _report(
        client, seed, trip, incident_type="hijacking", summary="Tracking company reports vehicle hijacked on N3",
        reporter_role="tracking_company", stop_trip=True, all_parcels=True,
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["trip_status"] == "cancelled"
    assert body["trip_stopped_at"] is not None
    assert body["parcels_total"] == len(parcels)
    assert "trip_stopped" in [u["kind"] for u in body["updates"]]
    trip_id = trip.id
    db_session.expire_all()
    assert (await db_session.execute(select(Trip.status).where(Trip.id == trip_id))).scalar_one() == TripStatus.CANCELLED
    note = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip_id, TripException.exception_type == ExceptionType.DISPATCHER_NOTE)
    )).scalar_one()
    assert note.description.endswith(TRIP_STOPPED_NOTE)
    assert not any(word in note.description.lower() for word in ("hijack", "incident", "inc1", "theft"))


async def test_report_incident_stop_trip_on_closed_trip_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed, status=TripStatus.CLOSED)

    resp = await _report(client, seed, trip, stop_trip=True)

    assert resp.status_code == 409
    assert (await db_session.execute(select(Incident).where(Incident.trip_id == trip.id))).first() is None


async def test_report_shortage_on_closed_trip_allowed_without_stop(client, db_session, seed):
    trip = await _make_trip(db_session, seed, status=TripStatus.CLOSED)

    resp = await _report(client, seed, trip)

    assert resp.status_code == 201
    assert resp.json()["trip_status"] == "closed"


async def test_report_parcel_from_other_trip_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    other_trip = await _make_trip(db_session, seed)
    foreign = await _make_parcels(db_session, other_trip, count=1)

    resp = await _report(client, seed, trip, parcel_ids=[str(foreign[0].id)])

    assert resp.status_code == 422


async def test_report_all_parcels_and_parcel_ids_together_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=1)

    resp = await _report(client, seed, trip, all_parcels=True, parcel_ids=[str(parcels[0].id)])

    assert resp.status_code == 422


async def test_report_in_app_without_exception_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    resp = await _report(client, seed, trip, report_channel="in_app", reporter_role="freightproof")

    assert resp.status_code == 422


async def test_report_future_received_at_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)

    resp = await _report(client, seed, trip, received_at=(datetime.now(UTC) + timedelta(days=1)).isoformat())

    assert resp.status_code == 422


async def test_report_occurred_after_received_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    now = datetime.now(UTC)

    resp = await _report(
        client, seed, trip, received_at=(now - timedelta(hours=2)).isoformat(),
        reported_occurred_at=(now - timedelta(hours=1)).isoformat(),
    )

    assert resp.status_code == 422


async def test_link_exception_already_in_incident_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    exc = await _make_exception(db_session, trip)
    first = await _report(client, seed, trip, exception_ids=[str(exc.id)])

    second = await _report(client, seed, trip, exception_ids=[str(exc.id)])

    assert second.status_code == 409
    assert second.json()["detail"]["incident_id"] == first.json()["incident_id"]


async def test_link_exception_leaves_review_status_unchanged(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    exc = await _make_exception(db_session, trip)

    exception_id = exc.id
    await _report(client, seed, trip, exception_ids=[str(exception_id)])

    db_session.expire_all()
    status = (await db_session.execute(select(TripException.review_status).where(TripException.id == exception_id))).scalar_one()
    assert status == ExceptionReviewStatus.NEEDS_REVIEW


async def _incident(client, seed, trip, **overrides) -> str:
    return (await _report(client, seed, trip, **overrides)).json()["incident_id"]


async def _update(client, seed, incident_id: str, body):
    return await client.post(f"/api/v1/incidents/{incident_id}/updates", json=body, headers=_token(seed))


async def test_append_update_does_not_mutate_previous_rows(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    before = (await db_session.execute(
        select(IncidentUpdate.id, IncidentUpdate.note, IncidentUpdate.to_value)
        .where(IncidentUpdate.incident_id == uuid.UUID(incident_id)).order_by(IncidentUpdate.sequence)
    )).all()

    resp = await _update(client, seed, incident_id, {"kind": "note", "note": "Called the receiver back"})

    assert resp.status_code == 201
    db_session.expire_all()
    after = (await db_session.execute(
        select(IncidentUpdate.id, IncidentUpdate.note, IncidentUpdate.to_value)
        .where(IncidentUpdate.incident_id == uuid.UUID(incident_id)).order_by(IncidentUpdate.sequence)
    )).all()
    assert after[: len(before)] == before
    assert len(after) == len(before) + 1 and after[-1].note == "Called the receiver back"


async def test_status_change_then_back_to_open_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)

    forward = await _update(client, seed, incident_id, {"kind": "status_changed", "status": "investigating"})
    back = await _update(client, seed, incident_id, {"kind": "status_changed", "status": "open"})

    assert forward.status_code == 201 and forward.json()["status"] == "investigating"
    assert back.status_code == 409
    await _assert_cache_matches_ledger(db_session, uuid.UUID(incident_id))


async def test_confidence_change_requires_note_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)

    resp = await _update(client, seed, incident_id, {"kind": "confidence_changed", "confidence": "corroborated"})

    assert resp.status_code == 422


async def test_assign_to_user_from_other_org_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    other = await _other_org_dispatcher(db_session)

    resp = await _update(client, seed, incident_id, {"kind": "assigned", "assigned_to_user_id": str(other.id)})

    assert resp.status_code == 422


async def test_parcel_finding_requires_parcel_on_incident_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=1)
    incident_id = await _incident(client, seed, trip)

    resp = await _update(client, seed, incident_id, {
        "kind": "parcel_finding", "parcel_id": str(parcels[0].id), "finding": "located", "note": "On the depot floor",
    })

    assert resp.status_code == 422


async def test_parcel_finding_updates_cache_and_unresolved_count(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=3)
    incident_id = await _incident(client, seed, trip, parcel_ids=[str(p.id) for p in parcels])

    resp = await _update(client, seed, incident_id, {
        "kind": "parcel_finding", "parcel_id": str(parcels[0].id), "finding": "located",
        "note": "Found on the depot floor, never loaded",
    })

    assert resp.status_code == 201
    body = resp.json()
    assert body["parcels_unresolved"] == 2
    found = next(p for p in body["parcels"] if p["parcel_id"] == str(parcels[0].id))
    assert found["latest_finding"] == "located"
    await _assert_cache_matches_ledger(db_session, uuid.UUID(incident_id))


async def test_missing_scan_in_reads_no_scan_in_recorded(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=2, scanned_in=1)

    resp = await _report(client, seed, trip, parcel_ids=[str(p.id) for p in parcels])

    states = {p["parcel_id"]: p["scan_state"] for p in resp.json()["parcels"]}
    assert states[str(parcels[0].id)] == "scanned_in"
    assert states[str(parcels[1].id)] == "no_scan_in_recorded"
    assert all(p["latest_finding"] is None for p in resp.json()["parcels"])


async def test_add_parcels_only_existing_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    parcels = await _make_parcels(db_session, trip, count=1)
    incident_id = await _incident(client, seed, trip, parcel_ids=[str(parcels[0].id)])

    resp = await _update(client, seed, incident_id, {"kind": "parcel_added", "parcel_ids": [str(parcels[0].id)]})

    assert resp.status_code == 422


async def test_link_exception_through_update(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    exc = await _make_exception(db_session, trip, ExceptionType.SEAL_COMPROMISED)
    incident_id = await _incident(client, seed, trip)

    resp = await _update(client, seed, incident_id, {"kind": "exception_linked", "exception_id": str(exc.id)})

    assert resp.status_code == 201
    assert [e["exception_id"] for e in resp.json()["exceptions"]] == [str(exc.id)]


async def test_external_action_other_requires_note_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)

    resp = await _update(client, seed, incident_id, {"kind": "external_action", "action": "other"})

    assert resp.status_code == 422


async def test_external_action_recorded_with_action_time(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    told_at = (datetime.now(UTC) - timedelta(minutes=20)).isoformat()

    resp = await _update(client, seed, incident_id, {
        "kind": "external_action", "action": "tracking_company_alerted", "action_at": told_at,
    })

    last = resp.json()["updates"][-1]
    assert last["external_action"] == "tracking_company_alerted"
    assert last["action_at"] is not None


async def _close(client, seed, incident_id: str, body):
    return await client.post(f"/api/v1/incidents/{incident_id}/close", json=body, headers=_token(seed))


async def test_close_without_reason_422(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)

    resp = await _close(client, seed, incident_id, {"outcome": "inconclusive", "reason": "  "})

    assert resp.status_code == 422


async def test_close_theft_reported_without_cas_succeeds_with_warning(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")

    resp = await _close(client, seed, incident_id, {"outcome": "theft_reported", "reason": "Truck not recovered"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "closed" and body["outcome"] == "theft_reported"
    assert body["warnings"] == [THEFT_REPORTED_WITHOUT_CAS]
    await _assert_cache_matches_ledger(db_session, uuid.UUID(incident_id))


async def test_close_theft_reported_with_cas_has_no_warning(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")
    declared = await client.post(
        f"/api/v1/trips/{trip.id}/incident-declarations",
        json={"incident_id": incident_id, "saps_station": "Harrismith", "saps_cas_number": "CAS 123/10/2026"},
        headers=_token(seed),
    )

    resp = await _close(client, seed, incident_id, {"outcome": "theft_reported", "reason": "Case opened"})

    assert declared.status_code == 201
    assert resp.json()["warnings"] == []
    assert [d["saps_cas_number"] for d in resp.json()["declarations"]] == ["CAS 123/10/2026"]


async def test_declaration_for_incident_on_other_trip_404(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    other_trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, other_trip)

    resp = await client.post(
        f"/api/v1/trips/{trip.id}/incident-declarations",
        json={"incident_id": incident_id, "saps_station": "Harrismith"}, headers=_token(seed),
    )

    assert resp.status_code == 404
    assert (await db_session.execute(select(IncidentDeclaration).where(IncidentDeclaration.trip_id == trip.id))).first() is None


async def test_update_on_closed_incident_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    await _close(client, seed, incident_id, {"outcome": "recording_error", "reason": "Scanner double-counted"})

    resp = await _update(client, seed, incident_id, {"kind": "note", "note": "late thought"})

    assert resp.status_code == 409


async def test_reopen_then_update_allowed(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    await _close(client, seed, incident_id, {"outcome": "inconclusive", "reason": "No leads"})

    reopened = await client.post(
        f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "Client found CCTV"}, headers=_token(seed),
    )
    note = await _update(client, seed, incident_id, {"kind": "note", "note": "Reviewing CCTV"})

    assert reopened.status_code == 200
    assert reopened.json()["status"] == "investigating" and reopened.json()["outcome"] is None
    assert note.status_code == 201
    await _assert_cache_matches_ledger(db_session, uuid.UUID(incident_id))


async def test_reopen_open_incident_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)

    resp = await client.post(f"/api/v1/incidents/{incident_id}/reopen", json={"reason": "x"}, headers=_token(seed))

    assert resp.status_code == 409


async def test_get_incident_404_other_org(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    other = await _other_org_dispatcher(db_session)

    resp = await client.get(
        f"/api/v1/incidents/{incident_id}", headers=auth_header(make_token(sub=str(other.id), role="dispatcher")),
    )

    assert resp.status_code == 404


async def test_get_incident_404_unknown(client, db_session, seed):
    resp = await client.get(f"/api/v1/incidents/{uuid.uuid4()}", headers=_token(seed))

    assert resp.status_code == 404


async def test_list_incidents_filters_by_status(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    open_id = await _incident(client, seed, trip)
    closed_id = await _incident(client, seed, trip)
    await _close(client, seed, closed_id, {"outcome": "inconclusive", "reason": "No leads"})

    open_list = await client.get("/api/v1/incidents?status=open", headers=_token(seed))
    trip_list = await client.get(f"/api/v1/trips/{trip.id}/incidents", headers=_token(seed))

    assert [i["incident_id"] for i in open_list.json()] == [open_id]
    assert {i["incident_id"] for i in trip_list.json()} == {open_id, closed_id}


async def test_detail_reports_document_upload_flag(client, db_session, seed, monkeypatch):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    monkeypatch.setattr("app.orchestration.incidents.queries.settings.INCIDENT_DOCUMENTS_ENABLED", True)

    resp = await client.get(f"/api/v1/incidents/{incident_id}", headers=_token(seed))

    assert resp.json()["document_upload_enabled"] is True


async def test_stop_trip_later_cancels_trip_and_records_entry(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    trip_id = trip.id
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")

    resp = await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    assert resp.status_code == 200
    body = resp.json()
    assert body["trip_status"] == "cancelled" and body["trip_stopped_at"] is not None
    assert body["updates"][-1]["kind"] == "trip_stopped"
    db_session.expire_all()
    assert (await db_session.execute(select(Trip.status).where(Trip.id == trip_id))).scalar_one() == TripStatus.CANCELLED
    await _assert_cache_matches_ledger(db_session, uuid.UUID(incident_id))


async def test_stop_trip_later_on_finished_trip_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed, status=TripStatus.CLOSED)
    incident_id = await _incident(client, seed, trip)

    resp = await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    assert resp.status_code == 409


async def test_stop_trip_later_twice_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")
    await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    resp = await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    assert resp.status_code == 409


async def test_stop_trip_later_closed_incident_409(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip)
    await _close(client, seed, incident_id, {"outcome": "inconclusive", "reason": "No leads"})

    resp = await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    assert resp.status_code == 409


async def test_stop_trip_later_sees_a_cancel_committed_after_the_trip_was_loaded(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")
    await db_session.execute(text("UPDATE trips SET status = 'cancelled' WHERE id = :id"), {"id": trip.id})

    resp = await client.post(f"/api/v1/incidents/{incident_id}/stop-trip", headers=_token(seed))

    assert resp.status_code == 409
    notes = (await db_session.execute(
        select(TripException).where(TripException.trip_id == trip.id, TripException.exception_type == ExceptionType.DISPATCHER_NOTE)
    )).scalars().all()
    assert notes == []


async def test_list_trip_incidents_404_for_other_org_trip(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    other = await _other_org_dispatcher(db_session)

    resp = await client.get(
        f"/api/v1/trips/{trip.id}/incidents", headers=auth_header(make_token(sub=str(other.id), role="dispatcher")),
    )

    assert resp.status_code == 404


async def test_detail_counts_a_trip_level_case_number_like_the_close_warning(client, db_session, seed):
    trip = await _make_trip(db_session, seed)
    incident_id = await _incident(client, seed, trip, incident_type="hijacking")
    await client.post(
        f"/api/v1/trips/{trip.id}/incident-declarations",
        json={"saps_cas_number": "CAS 9/10/2026"}, headers=_token(seed),
    )

    detail = await client.get(f"/api/v1/incidents/{incident_id}", headers=_token(seed))
    closed = await _close(client, seed, incident_id, {"outcome": "theft_reported", "reason": "Case opened earlier"})

    assert [d["saps_cas_number"] for d in detail.json()["declarations"]] == ["CAS 9/10/2026"]
    guide = {s["key"]: s["state"] for s in detail.json()["response_guide"]}
    assert guide["saps_reported"] == "done"
    assert closed.json()["warnings"] == []
