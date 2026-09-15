"""Integration tests: departure/confirmation phase completion anchors to
Hedera HCS. D7/T5 (task 2.6) moved the anchor whole from loading to
departure — see DepartureCompleteRequest/advance_departure in
app/schemas/phases.py and app/orchestration/phase_service.py.

Mirrors tests/integration/test_trips_anchor.py's approach (patch HederaService
at the app.blockchain.anchor_service import boundary) applied to the
driver-JWT-authenticated phase endpoints exercised in
tests/integration/test_phases.py — this file reuses that module's seeding
fixtures rather than DEMO_MODE auth, since these phases require a real Driver row.

The routing surface itself is covered by tests/integration/test_phases.py.
"""

import asyncio
import base64
import hashlib
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import httpx
import pytest
import pytest_asyncio
import respx
from sqlalchemy import select
from httpx import AsyncClient

from app.blockchain.hedera import HederaReceipt
from app.core.config import settings
from app.core.exceptions import HederaTimeoutError
from app.db.models.enums import (
    ArtifactType, BlockchainReceiptType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType,
    TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
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


@pytest_asyncio.fixture
async def seed_trip(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-HA", order_number="ORD-HA",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        # Activation is gated on the trip being due (phase_service._reject_if_not_due) and
        # an unscheduled trip is deliberately unstartable, so this fixture books itself for
        # today — what it always meant: a trip a driver is about to run.
        planned_departure_at=datetime.now(UTC),
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    # Hand-built single-leg phase plan, mirroring what create_trip's plan
    # generator (task 2.1) writes at trip creation — every PhaseEvent row a
    # driver will ever complete already exists, `pending`, before any endpoint
    # call. IN_TRANSIT (P4) is included and stays PENDING like every other
    # driver-facing row: it is opened by advance_departure and closed by the
    # driver's own arrival submission — see advance_in_transit's docstring in
    # phase_service.py.
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
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.UNLOADING, trip_stop_id=stop1.id, sequence_number=5, status=PhaseStatus.PENDING),
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id, sequence_number=6, status=PhaseStatus.PENDING),
    ])
    await db_session.flush()

    return trip, driver


async def _make_artifact(db_session, trip_id) -> str:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return str(artifact.id)


def _fake_hedera_receipt() -> HederaReceipt:
    return HederaReceipt(
        topic_id="0.0.12345", sequence_number=7,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )


async def _phase_event_id(client: AsyncClient, trip_id, token, phase_type: str) -> str:
    """Resolve a row's id from a real GET /phases call — never a hardcoded id
    or a sequence-to-id mapping."""
    resp = await client.get(f"/api/v1/trips/{trip_id}/phases", headers=auth_header(token))
    row = next(p for p in resp.json() if p["phase_type"] == phase_type)
    return row["phase_event_id"]


async def _complete_activation(client: AsyncClient, db_session, trip, token) -> None:
    phase_event_id = await _phase_event_id(client, trip.id, token, "activation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        json={
            "phase_type": "activation",
            "driver_phone_lat": "0.0001", "driver_phone_lng": "0.0001",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200


def _loading_payload() -> dict:
    # The legacy count field is accepted but ignored so an older offline entry can
    # still drain; loading no longer captures a driver-entered count.
    return {"phase_type": "loading", "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4())}


def _departure_payload(waybill_id: str, seal_photo_id: str, **overrides: object) -> dict:
    # D7/T5: the seal (waybill photo, seal number, seal photo) is applied at
    # departure now, not loading.
    payload = {
        "phase_type": "departure",
        "waybill_photo_artifact_id": waybill_id,
        "seal_number": "AB-1234",
        "seal_photo_artifact_id": seal_photo_id,
        "guard_verified_seal": True,
        "idempotency_key": str(uuid.uuid4()),
    }
    payload.update(overrides)
    return payload


async def _complete_loading(client: AsyncClient, db_session, trip, token) -> None:
    phase_event_id = await _phase_event_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{phase_event_id}/complete",
        json=_loading_payload(),
        headers=auth_header(token),
    )
    assert resp.status_code == 200


@pytest.fixture(autouse=True)
def captured_anchor_dispatches(monkeypatch):
    """Capture the anchor dispatch instead of queueing a real Celery task.

    Anchoring runs on the worker now, dispatched from the session's after_commit hook —
    and an integration request DOES commit, so without this the test outcome would depend
    on whether a Redis broker happens to be running (broker up: queued and never run;
    broker down: _dispatch_anchor's local fallback attempts a receipt). Capturing makes
    it deterministic, and _drain_anchors runs the same entry point the worker calls.
    """
    dispatched: list[tuple[str, dict, str]] = []

    class _StubTask:
        @staticmethod
        def delay(phase_event_id: str, canonical_payload: dict, receipt_type: str) -> None:
            dispatched.append((phase_event_id, canonical_payload, receipt_type))

    monkeypatch.setattr("app.tasks.blockchain.anchor_phase_event_task", _StubTask)
    return dispatched


async def _drain_anchors(db_session, dispatched) -> None:
    """Commit first — the override of get_db in these tests doesn't commit, so the
    after_commit hook that dispatches the anchor hasn't fired yet — then run every queued
    anchor exactly as the worker would."""
    from app.orchestration.phase_service import _BACKGROUND_ANCHOR_TASKS, anchor_phase_event

    await db_session.commit()
    await asyncio.gather(*_BACKGROUND_ANCHOR_TASKS)
    for phase_event_id, canonical_payload, receipt_type in dispatched:
        await anchor_phase_event(
            db_session, phase_event_id=uuid.UUID(phase_event_id),
            canonical_payload=canonical_payload,
            receipt_type=BlockchainReceiptType(receipt_type),
        )
    await db_session.commit()
    dispatched.clear()


async def test_departure_complete_anchors_and_returns_event_hash(client: AsyncClient, db_session, seed_trip):
    """POST departure/complete → 200 with event_hash set on the DEPARTURE row, and no
    receipt yet.

    The hash is derived from this request's own evidence and is still computed in-request.
    The receipt is not: since 2026-08-05 the Hedera submit is queued for the worker rather
    than awaited (a ~4-6s round trip was holding the driver's swipe open), so the response
    carries blockchain_receipt_id = null and the driver app renders "anchoring in
    progress" until the worker lands it. D7/T5 (task 2.6): the anchor moved whole from
    loading to departure, so the loading row in the same response must stay entirely
    unanchored — regression guard that the anchor really moved, not just got duplicated."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, db_session, trip, token)
    await _complete_loading(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_departure_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    departure = next(h for h in body["phases"] if h["phase_type"] == "departure")
    assert departure["event_hash"] is not None
    assert departure["blockchain_receipt_id"] is None

    loading_phase = next(h for h in body["phases"] if h["phase_type"] == "loading")
    assert loading_phase["event_hash"] is None
    assert loading_phase["blockchain_receipt_id"] is None


async def test_departure_complete_hedera_failure_still_returns_200_fail_open(
    client: AsyncClient, db_session, seed_trip,
):
    """D7 (task 2.5's fail-open policy, wired into advance_departure for the
    first time in task 2.6): unlike the old loading-phase fail-closed anchor, a Hedera
    failure during departure completion must NOT block the phase from
    completing or the trip from advancing — the seal event already happened.
    No 504/502 here; the endpoint doesn't even catch
    HederaTimeoutError/HederaServiceError for departure, because
    advance_departure -> _anchor_or_fail_open never lets one escape.
    """
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, db_session, trip, token)
    await _complete_loading(client, db_session, trip, token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.side_effect = HederaTimeoutError("Simulated Hedera timeout")

        resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_departure_payload(waybill_id, seal_photo_id),
            headers=auth_header(token),
        )

    assert resp.status_code == 200
    body = resp.json()
    departure = next(h for h in body["phases"] if h["phase_type"] == "departure")
    assert departure["status"] == "completed"
    assert departure["blockchain_receipt_id"] is None  # retry owed, not raised
    # Read the trip's advancement straight off the response body rather than
    # re-querying via db_session — expire_all() followed by a synchronous
    # attribute read on an already-loaded ORM instance (trip.id) is a known
    # sharp edge in this test suite's async session (see the identical hazard
    # in test_vehicles_validation.py::test_update_vehicle_invalid_vin_leaves_db_state_unchanged).
    assert body["status"] == "active"  # departure still advanced the trip, even on a failed anchor


async def test_trip_detail_lists_departure_receipt_for_dispatcher(
    client: AsyncClient, db_session, seed_trip, captured_anchor_dispatches,
):
    """The driver→dispatcher anchoring link: after departure anchors, GET
    /trips/{id} (the dispatcher portal's data source) must list the
    PHASE_EVENT receipt in blockchain_receipts. resource_service.get_trip_detail
    used to filter subject_type == TRIP only, silently hiding every
    driver-anchored receipt from the dispatcher's per-trip evidence view."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, db_session, trip, driver_token)
    await _complete_loading(client, db_session, trip, driver_token)
    waybill_id = await _make_artifact(db_session, trip.id)
    seal_photo_id = await _make_artifact(db_session, trip.id)
    departure_id = await _phase_event_id(client, trip.id, driver_token, "departure")

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        departure_resp = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{departure_id}/complete",
            json=_departure_payload(waybill_id, seal_photo_id),
            headers=auth_header(driver_token),
        )
        assert departure_resp.status_code == 200
        # The worker's half, run inside the same patch: without it there is no receipt
        # for the dispatcher to see, and outside the patch it would hit the real SDK.
        await _drain_anchors(db_session, captured_anchor_dispatches)
    departure_id_str = next(
        h["phase_event_id"] for h in departure_resp.json()["phases"] if h["phase_type"] == "departure"
    )

    # Receipts are role-gated (FP-115): only admin_dispatcher sees the full list,
    # so the read side authenticates as an admin in the trip's operator org.
    admin = User(
        id=uuid.uuid4(), organization_id=trip.operator_organization_id,
        email="admin@test.co.za", full_name="Admin",
    )
    db_session.add(admin)
    await db_session.flush()
    admin_token = make_token(
        sub=str(admin.id), role="admin_dispatcher",
        org_id=str(trip.operator_organization_id),
    )

    detail_resp = await client.get(f"/api/v1/trips/{trip.id}", headers=auth_header(admin_token))

    assert detail_resp.status_code == 200
    receipts = detail_resp.json()["blockchain_receipts"]
    phase_receipts = [r for r in receipts if r["subject_type"] == "phase_event"]
    assert len(phase_receipts) == 1
    assert phase_receipts[0]["subject_id"] == departure_id_str


@pytest.mark.parametrize("phase_type", ["departure", "confirmation", "receiver_confirmation"])
@respx.mock
async def test_upload_complete_anchor_verify_and_detect_replacement_end_to_end(
    client, db_session, seed_trip, captured_anchor_dispatches, monkeypatch, phase_type,
):
    """Only external Storage/HCS transports are fake; HTTP, hashing and SQL are real."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    objects: dict[str, bytes] = {}
    storage_client = MagicMock()

    def store(path: str, file_bytes: bytes, file_options: dict) -> None:
        objects[path] = file_bytes

    storage_client.storage.from_.return_value.upload.side_effect = store
    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: storage_client)

    async def upload(label: str) -> str:
        content = b"\xff\xd8\xff" + label.encode()
        response = await client.post("/api/v1/artifacts", headers=auth_header(driver_token),
            data={"trip_id": str(trip.id), "artifact_type": "photo", "captured_at": datetime.now(UTC).isoformat()},
            files={"file": ("evidence.jpg", content, "image/jpeg")})
        assert response.status_code == 201
        assert response.json()["file_hash"] == hashlib.sha256(content).hexdigest()
        return response.json()["id"]

    async def complete(name: str, fields: dict) -> str:
        event_id = await _phase_event_id(client, trip.id, driver_token, name)
        response = await client.post(
            f"/api/v1/trips/{trip.id}/phases/{event_id}/complete",
            headers=auth_header(driver_token),
            json={"phase_type": name, "idempotency_key": str(uuid.uuid4()), **fields},
        )
        assert response.status_code == 200
        return event_id

    await _complete_activation(client, db_session, trip, driver_token)
    await _complete_loading(client, db_session, trip, driver_token)
    selected_artifact_id = await upload("seal")
    event_id = await complete("departure", {"seal_number": "AB-1234", "seal_photo_artifact_id": selected_artifact_id})
    if phase_type != "departure":
        await complete("in_transit", {})
        await complete("unloading", {"seal_number_at_destination": "AB-1234", "gate_photo_artifact_id": await upload("arrival")})
        selected_artifact_id = await upload("POD")
        if phase_type == "receiver_confirmation":
            confirmation_id = await _phase_event_id(client, trip.id, driver_token, "confirmation")
            handover_url = f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/handover"
            issued = await client.post(f"{handover_url}/tokens", headers=auth_header(driver_token))
            assert issued.status_code == 201
            token = issued.json()["scan_url"].rsplit("/", 1)[1]
            opened = await client.get(f"/api/v1/handover/{token}")
            assert opened.status_code == 200
            signature_bytes = b"\x89PNG\r\n\x1a\n" + b"receiver attestation"
            confirmed = await client.post(f"/api/v1/handover/{token}/confirm", json={
                "receiver_name": "Test Receiver",
                "receiver_id_number": "9202204720082",
                "signature_png_base64": base64.b64encode(signature_bytes).decode(),
            })
            assert confirmed.status_code == 201
            handover = await client.get(handover_url, headers=auth_header(driver_token))
            assert handover.status_code == 200
            signature_id = handover.json()["signature_artifact_id"]
            receiver_artifact = await db_session.get(EvidenceArtifact, uuid.UUID(signature_id))
            assert receiver_artifact.captured_by_driver_id is None
            assert receiver_artifact.file_hash == hashlib.sha256(signature_bytes).hexdigest()
        else:
            signature_id = await upload("signature")
        event_id = await complete("confirmation", {
            "pod_photo_artifact_id": selected_artifact_id,
            "pod_signature_artifact_id": signature_id,
        })
        if phase_type == "receiver_confirmation":
            selected_artifact_id = signature_id

    await _drain_anchors(db_session, captured_anchor_dispatches)
    event = await db_session.get(PhaseEvent, uuid.UUID(event_id))
    receipt = await db_session.get(BlockchainReceipt, event.blockchain_receipt_id)
    assert receipt.payload_json["payload_version"] == 2
    assert receipt.data_hash == event.event_hash
    artifact = await db_session.get(EvidenceArtifact, uuid.UUID(selected_artifact_id))
    original_hash = artifact.file_hash

    prefix = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/evidence-artifacts/"

    def download(request: httpx.Request) -> httpx.Response:
        key = request.url.path.split("/evidence-artifacts/", 1)[1]
        assert request.url.params["cacheNonce"]
        return httpx.Response(200, content=objects[key])

    storage = respx.get(url__startswith=prefix).mock(side_effect=download)
    mirror = respx.get(url__regex=r"/api/v1/topics/.*/messages/\d+").respond(200, json={
        "message": base64.b64encode(receipt.data_hash.encode()).decode(),
    })
    user = (await db_session.execute(select(User).where(User.id == trip.created_by_user_id))).scalar_one()
    headers = auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(user.organization_id)))
    body = {"subject_type": "phase_event", "subject_id": event_id}

    verified = await client.post("/api/v1/blockchain/verify", headers=headers, json=body)
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    assert verified.json()["evidence_verified"] is True
    assert mirror.call_count == 1

    objects[artifact.s3_key] = b"replaced after anchoring"
    changed = await client.post("/api/v1/blockchain/verify", headers=headers, json=body)
    assert changed.json()["status"] == "db_mismatch"
    assert changed.json()["evidence_verified"] is False
    assert artifact.file_hash == original_hash
    assert mirror.call_count == 1  # Local mismatch never spends a Hedera read.

    storage.respond(503)
    unavailable = await client.post("/api/v1/blockchain/verify", headers=headers, json=body)
    assert unavailable.json()["status"] == "error"
    assert mirror.call_count == 1

    regular_headers = auth_header(make_token(sub=str(user.id), role="dispatcher", org_id=str(user.organization_id)))
    redacted = await client.post("/api/v1/blockchain/verify", headers=regular_headers, json=body)
    assert redacted.json()["receipt"] is None
    assert redacted.json()["expected_hash"] is None
    assert redacted.json()["current_hash"] is None
