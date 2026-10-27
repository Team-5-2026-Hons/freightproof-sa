"""Integration tests for incidents in the audit pack: the manifest's `investigations`, the
consignment scope cut, the incident summary for a hijacking reported only by phone, the
observations an adjuster reads, and the incident fact sheet rendering.
"""

import pytest
import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio

from app.db.models.enums import IdvsStatus, TripStatus
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.orchestration.audit_packs.builder import build_audit_manifest
from app.orchestration.incidents.manifest import SCOPE_REDACTION
from app.reporting.incident_sheet import render_incident_sheet_html
from app.reporting.pdf_renderer import render_audit_pack_html
from app.schemas.audit_pack import AuditPackManifest, AuditPackOptions

from tests.conftest import auth_header, make_token

pytestmark = pytest.mark.usefixtures("fake_pdf_renderer")


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def _trip(db_session, seed) -> tuple[Trip, list[Consignment], list[Parcel]]:
    """An active trip with two consignments of two parcels each, all scanned out, none in."""
    suffix = uuid.uuid4().hex[:8]
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-INV-{suffix}", order_number=f"INV-{suffix}",
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
    consignments = [
        Consignment(
            id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WB{n}-{suffix}",
            client_organization_id=seed["client_org"].id,
        )
        for n in range(2)
    ]
    db_session.add_all(consignments)
    await db_session.flush()
    out_at = datetime.now(UTC) - timedelta(hours=3)
    parcels = [
        Parcel(id=uuid.uuid4(), consignment_id=c.id, barcode=f"{c.parcel_perfect_reference}-{i}", pp_scan_out_at=out_at)
        for c in consignments for i in range(2)
    ]
    db_session.add_all(parcels)
    await db_session.flush()
    return trip, consignments, parcels


def _token(seed) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed["dispatcher"].id), role="dispatcher"))


async def _report(client, seed, trip: Trip, **overrides) -> dict:
    body = {
        "incident_type": "parcel_shortage", "summary": "Short on delivery", "reporter_role": "receiver",
        "report_channel": "phone", "confidence": "reported", **overrides,
    }
    resp = await client.post(f"/api/v1/trips/{trip.id}/incidents", json=body, headers=_token(seed))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _close(client, seed, incident_id: str, outcome: str, reason: str) -> None:
    resp = await client.post(
        f"/api/v1/incidents/{incident_id}/close", json={"outcome": outcome, "reason": reason}, headers=_token(seed),
    )
    assert resp.status_code == 200, resp.text


async def _manifest(db_session, seed, trip: Trip, **options) -> AuditPackManifest:
    return await build_audit_manifest(
        db_session, trip_id=trip.id, operator_organization_id=seed["org"].id, options=AuditPackOptions(**options),
    )


def _codes(manifest: AuditPackManifest) -> list[str]:
    return [o.code for o in manifest.observations]


async def test_manifest_includes_open_incident_with_timeline(client, db_session, seed):
    trip, _, parcels = await _trip(db_session, seed)
    incident = await _report(client, seed, trip, parcel_ids=[str(p.id) for p in parcels[:2]])
    await client.post(
        f"/api/v1/incidents/{incident['incident_id']}/updates",
        json={"kind": "note", "note": "Receiver re-counting"}, headers=_token(seed),
    )

    manifest = await _manifest(db_session, seed, trip)

    [record] = manifest.investigations
    assert record.reference == "INC1" and record.status == "open" and record.tier == "declared"
    assert [e.kind for e in record.entries][:2] == ["opened", "assigned"]
    assert record.entries[-1].note == "Receiver re-counting"
    assert {p.scan_state for p in record.parcels} == {"no_scan_in_recorded"}
    assert "incident.open" in _codes(manifest)
    assert "incident.report_vs_system" in _codes(manifest)


async def test_scope_cuts_other_consignment_parcels(client, db_session, seed):
    trip, consignments, parcels = await _trip(db_session, seed)
    await _report(client, seed, trip, incident_type="hijacking", all_parcels=True)

    manifest = await _manifest(db_session, seed, trip, scope_consignment_id=consignments[0].id)

    [record] = manifest.investigations
    assert {p.consignment_id for p in record.parcels} == {consignments[0].id}
    other_parcels = {p.id for p in parcels if p.consignment_id == consignments[1].id}
    assert not any(e.parcel_id in other_parcels for e in record.entries)
    assert SCOPE_REDACTION in manifest.redactions


async def test_phone_reported_hijack_produces_incident_summary_and_sheet(client, db_session, seed):
    trip, _, _ = await _trip(db_session, seed)
    occurred = datetime.now(UTC) - timedelta(minutes=40)
    await _report(
        client, seed, trip, incident_type="hijacking", reporter_role="tracking_company",
        summary="Tracker reports vehicle taken at gunpoint near Harrismith",
        reported_occurred_at=occurred.isoformat(), stop_trip=True, all_parcels=True,
    )

    manifest = await _manifest(db_session, seed, trip)
    html = render_incident_sheet_html(manifest, verify_url=None)

    assert manifest.incident is not None
    assert manifest.incident.basis == "investigation"
    assert manifest.incident.first_raised_at == occurred
    assert "Reported event" in html and "Hijacking / robbery (reported)" in html
    assert "Tracker reports vehicle taken at gunpoint near Harrismith" in html
    assert "incident.trip_stopped" in _codes(manifest)


async def test_closed_with_unresolved_parcels_is_observed(client, db_session, seed):
    trip, _, parcels = await _trip(db_session, seed)
    incident = await _report(client, seed, trip, parcel_ids=[str(p.id) for p in parcels[:3]])
    await client.post(
        f"/api/v1/incidents/{incident['incident_id']}/updates",
        json={"kind": "parcel_finding", "parcel_id": str(parcels[0].id), "finding": "located", "note": "On the floor"},
        headers=_token(seed),
    )
    await _close(client, seed, incident["incident_id"], "partial_recovery", "One found, two not traced")

    manifest = await _manifest(db_session, seed, trip)

    unresolved = next(o for o in manifest.observations if o.code == "incident.unresolved_parcels")
    assert "2 affected parcel(s)" in unresolved.text
    assert set(unresolved.evidence_ids) == {parcels[1].id, parcels[2].id}
    assert "incident.closed_outcome" in _codes(manifest)
    assert "incident.open" not in _codes(manifest)


async def test_theft_reported_without_cas_is_observed(client, db_session, seed):
    trip, _, _ = await _trip(db_session, seed)
    incident = await _report(client, seed, trip, incident_type="hijacking")
    await _close(client, seed, incident["incident_id"], "theft_reported", "Vehicle not recovered")

    manifest = await _manifest(db_session, seed, trip)

    assert "incident.theft_reported_without_cas" in _codes(manifest)


async def test_theft_reported_with_cas_is_not_flagged(client, db_session, seed):
    trip, _, _ = await _trip(db_session, seed)
    incident = await _report(client, seed, trip, incident_type="hijacking")
    await client.post(
        f"/api/v1/trips/{trip.id}/incident-declarations",
        json={"incident_id": incident["incident_id"], "saps_cas_number": "CAS 55/10/2026"}, headers=_token(seed),
    )
    await _close(client, seed, incident["incident_id"], "theft_reported", "Case opened")

    manifest = await _manifest(db_session, seed, trip)

    assert "incident.theft_reported_without_cas" not in _codes(manifest)


async def test_trip_without_incidents_has_no_investigations(db_session, seed):
    trip, _, _ = await _trip(db_session, seed)

    manifest = await _manifest(db_session, seed, trip)

    assert manifest.investigations == []
    assert manifest.incident is None


async def test_pack_html_renders_investigation_section(client, db_session, seed):
    trip, _, parcels = await _trip(db_session, seed)
    incident = await _report(client, seed, trip, parcel_ids=[str(parcels[0].id)])
    await _close(client, seed, incident["incident_id"], "shortage_confirmed", "Never loaded at origin")

    html = render_audit_pack_html(await _manifest(db_session, seed, trip), issue=None, mirror_base_url="https://mirror.test")

    assert "Investigations" in html
    assert "Never loaded at origin" in html
    assert parcels[0].barcode in html
    investigations = html[html.index('id="investigations"'):]
    row = next(line for line in investigations.splitlines() if parcels[0].barcode in line)
    assert "No scan in recorded" in row and "not established" in row and "stolen" not in row.lower()


async def test_scoped_pack_drops_another_clients_shortage(client, db_session, seed):
    trip, consignments, parcels = await _trip(db_session, seed)
    other_client_parcels = [p for p in parcels if p.consignment_id == consignments[1].id]
    await _report(
        client, seed, trip, summary="Client B receiver says 2 short", reported_by_name="B. Receiver",
        parcel_ids=[str(p.id) for p in other_client_parcels],
    )

    manifest = await _manifest(db_session, seed, trip, scope_consignment_id=consignments[0].id)

    assert manifest.investigations == []
    assert SCOPE_REDACTION in manifest.redactions
    assert "B. Receiver" not in manifest.model_dump_json()


async def test_scoped_pack_keeps_a_shortage_on_its_own_consignment(client, db_session, seed):
    trip, consignments, parcels = await _trip(db_session, seed)
    own = [p for p in parcels if p.consignment_id == consignments[0].id]
    await _report(client, seed, trip, parcel_ids=[str(p.id) for p in own])

    manifest = await _manifest(db_session, seed, trip, scope_consignment_id=consignments[0].id)

    assert [i.reference for i in manifest.investigations] == ["INC1"]


async def test_reporter_name_never_enters_the_hashed_manifest(client, db_session, seed):
    trip, _, parcels = await _trip(db_session, seed)
    await _report(
        client, seed, trip, incident_type="hijacking", reporter_role="tracking_company",
        reported_by_name="Thandiwe Mokoena", parcel_ids=[str(parcels[0].id)],
    )

    manifest = await _manifest(db_session, seed, trip)

    [record] = manifest.investigations
    assert record.reporter_role == "tracking_company"
    assert "Thandiwe" not in manifest.model_dump_json()
    assert "Thandiwe" not in render_incident_sheet_html(manifest, verify_url=None)
