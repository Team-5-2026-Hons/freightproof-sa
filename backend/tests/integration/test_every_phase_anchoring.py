"""Integration coverage: every phase anchors.

This feature's own done-criterion: "every phase row of a completed test trip ends
ANCHORED with a matching receipt type". This file drives a real single-leg trip
through every phase over HTTP, then proves the anchor/reconstruction contract on
the resulting rows directly against the shared DB session — the same helpers
tests/integration/test_phases.py and tests/integration/test_arrival_phase.py
already use, not reinvented here.

Nothing in this module calls db_session.commit() to reach ANCHORED: `_dispatch_anchor`
(app/orchestration/phases/anchor_dispatch.py) only queues the Hedera submit on the session's
after_commit hook, and the shared `override_get_db` fixture below never commits mid-
request, so every advance_*/override_phase call in this file only ever gets as far as
setting `event_hash` in-request — matching production's real split between "evidence
written" and "receipt landed". Anchoring is instead driven directly through
`anchor_phase_event`, exactly the entry point the Celery worker itself calls, against
`no_live_hedera_submissions` (tests/integration/conftest.py's autouse fake HCS adapter).
"""

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest_asyncio
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.blockchain.anchor_service import compute_payload_hash
from app.core.config import settings
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, IdvsStatus, OrganizationType, PhaseStatus, PhaseType,
    SealCondition, SubjectType, TripStatus, VehicleType, VerifyStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_service import (
    _PHASE_RECEIPT_TYPES, anchor_phase_event, receipt_type_for, recover_phase_anchor,
)
from app.orchestration.verification_service import reconstruct_pending_phase_payload, verify_subject

from tests.conftest import auth_header, make_token
# override_get_db is autouse and never referenced by name below, so importing it is
# enough for pytest to pick it up — no F811 risk. seed_trip IS referenced by name as a
# test parameter below, which ruff reads as redefining the import (F811), so it is
# re-seeded locally instead (matching test_arrival_phase.py's own precedent).
from tests.integration.test_phases import (  # noqa: F401  (override_get_db is a fixture)
    _complete_activation, _complete_arrival, _complete_in_transit, _make_artifact, _phase_id,
    _walk_to_in_transit, override_get_db,
)


@pytest_asyncio.fixture
async def seed_trip(db_session):
    """Same single-leg shape as test_phases.py's own seed_trip fixture — duplicated
    rather than imported as a fixture (see the import comment above)."""
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
        id=uuid.uuid4(), trip_reference="FP-TEST-EPA", order_number="ORD-EPA",
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


async def _complete_unloading(client: AsyncClient, trip, token: str) -> None:
    unloading_id = await _phase_id(client, trip.id, token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{unloading_id}/complete",
        json={"phase_type": "unloading", "idempotency_key": str(uuid.uuid4())},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def _complete_confirmation(client: AsyncClient, db_session, trip, token: str) -> None:
    pod_photo_id = await _make_artifact(db_session, trip.id)
    pod_signature_id = await _make_artifact(db_session, trip.id)
    confirmation_id = await _phase_id(client, trip.id, token, "confirmation")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{confirmation_id}/complete",
        json={
            "phase_type": "confirmation",
            "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
            "driver_visual_count": 42, "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


async def _walk_to_closed(client: AsyncClient, db_session, trip, token: str) -> None:
    """activation -> loading -> departure -> in_transit -> arrival (matching seal) ->
    unloading -> confirmation. The shortest legal path to a fully closed trip."""
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)  # default seal "AB-1234" matches departure
    await _complete_unloading(client, trip, token)
    await _complete_confirmation(client, db_session, trip, token)


async def _all_phases(db_session, trip_id) -> list[PhaseEvent]:
    return list((await db_session.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id == trip_id).order_by(PhaseEvent.sequence_number)
    )).scalars().all())


async def test_every_phase_of_a_completed_trip_ends_anchored_with_matching_receipt_type(
    client: AsyncClient, db_session, seed_trip,
):
    """The stage's done-criterion, driven end to end: after a single-leg trip closes,
    every non-trip_creation row's committed hash reconstructs exactly, and anchoring
    that reconstruction lands a receipt whose type matches _PHASE_RECEIPT_TYPES."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")

    await _walk_to_closed(client, db_session, trip, token)

    phases = await _all_phases(db_session, trip.id)
    assert len(phases) == 8  # trip_creation + 7 driver-facing rows, single-leg plan

    non_creation = [p for p in phases if PhaseType(p.phase_type) != PhaseType.TRIP_CREATION]
    assert len(non_creation) == 7

    for event in non_creation:
        phase_type = PhaseType(event.phase_type)
        assert event.status == PhaseStatus.COMPLETED
        assert event.event_hash is not None, f"{phase_type} has no event_hash"

        reconstructed = await reconstruct_pending_phase_payload(db_session, event)
        assert reconstructed is not None, f"{phase_type} did not reconstruct"
        assert compute_payload_hash(reconstructed) == event.event_hash, (
            f"{phase_type}'s reconstructed payload does not match its completion-time hash"
        )

        anchored = await anchor_phase_event(
            db_session, phase_event_id=event.id,
            canonical_payload=reconstructed, receipt_type=receipt_type_for(event),
        )
        assert anchored is True, f"{phase_type} failed to anchor from its reconstructed payload"
        await db_session.flush()

        assert event.anchor_status == AnchorStatus.ANCHORED
        assert event.blockchain_receipt_id is not None
        receipt = await db_session.get(BlockchainReceipt, event.blockchain_receipt_id)
        assert receipt.subject_type == SubjectType.PHASE_EVENT
        assert receipt.subject_id == event.id
        assert receipt.receipt_type == _PHASE_RECEIPT_TYPES[phase_type]
        assert receipt.data_hash == event.event_hash


async def test_arrival_seal_mismatch_still_anchors_and_reconstructs(
    client: AsyncClient, db_session, seed_trip,
):
    """A CRITICAL finding is exactly the evidence a dispute needs sealed — arrival
    anchors on EXCEPTION just as it does on COMPLETED (advance_arrival's own comment)."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)

    # Departure's seal defaults to "AB-1234" (test_phases._walk_to_in_transit); a
    # different arrival seal is the mismatch this test exists to anchor.
    await _complete_arrival(client, db_session, trip, token, seal_number_at_arrival="ZZ-9999")

    arrival = next(p for p in await _all_phases(db_session, trip.id) if PhaseType(p.phase_type) == PhaseType.ARRIVAL)
    assert arrival.status == PhaseStatus.EXCEPTION
    assert arrival.event_hash is not None

    reconstructed = await reconstruct_pending_phase_payload(db_session, arrival)
    assert reconstructed is not None
    assert compute_payload_hash(reconstructed) == arrival.event_hash

    anchored = await anchor_phase_event(
        db_session, phase_event_id=arrival.id,
        canonical_payload=reconstructed, receipt_type=receipt_type_for(arrival),
    )
    assert anchored is True
    await db_session.flush()
    assert arrival.anchor_status == AnchorStatus.ANCHORED
    receipt = await db_session.get(BlockchainReceipt, arrival.blockchain_receipt_id)
    assert receipt.receipt_type == BlockchainReceiptType.ARRIVAL_INSPECTION


async def test_dispatcher_override_of_a_pending_phase_anchors_with_override_receipt_type(
    client: AsyncClient, db_session, seed_trip,
):
    """An override anchors its own PHASE_OVERRIDE record, never the phase's own
    receipt type — anchor_phase_event must reject an attempt to anchor the override
    under the phase's normal type."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, driver_token)

    user = (await db_session.execute(
        select(User).where(User.organization_id == trip.operator_organization_id)
    )).scalar_one()
    dispatcher_token = make_token(sub=str(user.id), role="dispatcher")

    loading_id = await _phase_id(client, trip.id, driver_token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/override",
        json={"note": "driver's phone was lost before loading"},
        headers=auth_header(dispatcher_token),
    )
    assert resp.status_code == 200, resp.text

    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert loading.status == PhaseStatus.OVERRIDDEN
    assert loading.event_hash is not None

    reconstructed = await reconstruct_pending_phase_payload(db_session, loading)
    assert reconstructed is not None
    assert compute_payload_hash(reconstructed) == loading.event_hash

    # Anchoring the reconstructed override payload under the phase's OWN receipt
    # type (LOADING) must be rejected: the row is overridden, not driver-evidenced.
    rejected = await anchor_phase_event(
        db_session, phase_event_id=loading.id,
        canonical_payload=reconstructed, receipt_type=_PHASE_RECEIPT_TYPES[PhaseType.LOADING],
    )
    assert rejected is False
    await db_session.flush()
    assert loading.anchor_status == AnchorStatus.FAILED
    assert loading.blockchain_receipt_id is None

    # The correct receipt type — PHASE_OVERRIDE — anchors it.
    anchored = await anchor_phase_event(
        db_session, phase_event_id=loading.id,
        canonical_payload=reconstructed, receipt_type=receipt_type_for(loading),
    )
    assert anchored is True
    await db_session.flush()
    assert loading.anchor_status == AnchorStatus.ANCHORED
    receipt = await db_session.get(BlockchainReceipt, loading.blockchain_receipt_id)
    assert receipt.receipt_type == BlockchainReceiptType.PHASE_OVERRIDE


# ── recovery sweep: overridden rows and loading's optional linehaul photo ──────

async def test_recover_phase_anchor_picks_up_an_overdue_override_and_anchors_it(
    client: AsyncClient, db_session, seed_trip,
):
    """recover_phase_anchor's eligibility set includes OVERRIDDEN (not just COMPLETED/
    EXCEPTION) rows — an override that never got its receipt must be recoverable by the
    same sweep as any other phase, and must still land the PHASE_OVERRIDE receipt type,
    never the phase's own."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, driver_token)

    user = (await db_session.execute(
        select(User).where(User.organization_id == trip.operator_organization_id)
    )).scalar_one()
    dispatcher_token = make_token(sub=str(user.id), role="dispatcher")

    loading_id = await _phase_id(client, trip.id, driver_token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/override",
        json={"note": "driver's phone was lost before loading"},
        headers=auth_header(dispatcher_token),
    )
    assert resp.status_code == 200, resp.text

    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert loading.status == PhaseStatus.OVERRIDDEN
    assert loading.event_hash is not None
    # Simulate a dispatch that never landed a receipt — recover_phase_anchor's own
    # eligibility case (anchor_status FAILED/PENDING, no receipt, overdue updated_at).
    loading.anchor_status = AnchorStatus.FAILED
    loading.updated_at = datetime.now(UTC) - timedelta(minutes=10)
    await db_session.flush()

    recovered = await recover_phase_anchor(db_session, due_before=datetime.now(UTC))

    assert recovered is True
    await db_session.flush()
    assert loading.anchor_status == AnchorStatus.ANCHORED
    assert loading.blockchain_receipt_id is not None
    receipt = await db_session.get(BlockchainReceipt, loading.blockchain_receipt_id)
    assert receipt.receipt_type == BlockchainReceiptType.PHASE_OVERRIDE


async def test_recover_phase_anchor_recovers_a_loading_row_with_a_linehaul_photo(
    client: AsyncClient, db_session, seed_trip,
):
    """The linehaul photo is optional evidence on loading (PhaseEvent.
    linehaul_photo_artifact_id) — reconstruction must still succeed and anchor with
    the LOADING receipt type when one was actually captured, not just on the bare
    IDs-only case the rest of this module's loading coverage exercises."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, token)

    linehaul_photo_id = await _make_artifact(db_session, trip.id)
    loading_id = await _phase_id(client, trip.id, token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/complete",
        json={
            "phase_type": "loading",
            "linehaul_photo_artifact_id": linehaul_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    assert str(loading.linehaul_photo_artifact_id) == linehaul_photo_id
    assert loading.event_hash is not None
    loading.anchor_status = AnchorStatus.PENDING
    loading.updated_at = datetime.now(UTC) - timedelta(minutes=10)
    await db_session.flush()

    recovered = await recover_phase_anchor(db_session, due_before=datetime.now(UTC))

    assert recovered is True
    await db_session.flush()
    assert loading.anchor_status == AnchorStatus.ANCHORED
    receipt = await db_session.get(BlockchainReceipt, loading.blockchain_receipt_id)
    assert receipt.receipt_type == BlockchainReceiptType.LOADING
    assert receipt.payload_json["linehaul_photo_sha256"] is not None


# ── tamper detection: a row edited after anchoring must verify as DB_MISMATCH ──

async def test_verify_subject_detects_tampered_seal_condition_after_arrival_anchors(
    client: AsyncClient, db_session, seed_trip,
):
    """The anchored payload commits to seal_condition (compute_arrival_canonical_
    payload_v2) — editing the column directly in the DB after anchoring, bypassing
    every code path that would normally raise a finding, must still be caught as
    tampering by verify_subject rather than silently re-verifying."""
    trip, driver = seed_trip
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, token)
    await _complete_in_transit(client, trip, token)
    await _complete_arrival(client, db_session, trip, token)  # default seal "AB-1234" matches departure

    arrival = next(
        p for p in await _all_phases(db_session, trip.id) if PhaseType(p.phase_type) == PhaseType.ARRIVAL
    )
    reconstructed = await reconstruct_pending_phase_payload(db_session, arrival)
    assert reconstructed is not None
    anchored = await anchor_phase_event(
        db_session, phase_event_id=arrival.id,
        canonical_payload=reconstructed, receipt_type=receipt_type_for(arrival),
    )
    assert anchored is True
    await db_session.flush()

    arrival.seal_condition = SealCondition.DAMAGED.value
    await db_session.flush()

    outcome = await verify_subject(db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=arrival.id)

    assert outcome.status == VerifyStatus.DB_MISMATCH


async def test_verify_subject_detects_tampered_override_note_after_anchoring(
    client: AsyncClient, db_session, seed_trip,
):
    """The override's anchored payload commits to a keyed hash of dispatcher_override_
    note (compute_override_canonical_payload_v2) — editing the plain note after
    anchoring must change the reconstructed hash and be caught, same as any other
    anchored evidence column."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")
    await _complete_activation(client, trip.id, driver_token)

    user = (await db_session.execute(
        select(User).where(User.organization_id == trip.operator_organization_id)
    )).scalar_one()
    dispatcher_token = make_token(sub=str(user.id), role="dispatcher")

    loading_id = await _phase_id(client, trip.id, driver_token, "loading")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{loading_id}/override",
        json={"note": "driver's phone was lost before loading"},
        headers=auth_header(dispatcher_token),
    )
    assert resp.status_code == 200, resp.text

    loading = await db_session.get(PhaseEvent, uuid.UUID(loading_id))
    reconstructed = await reconstruct_pending_phase_payload(db_session, loading)
    assert reconstructed is not None
    anchored = await anchor_phase_event(
        db_session, phase_event_id=loading.id,
        canonical_payload=reconstructed, receipt_type=receipt_type_for(loading),
    )
    assert anchored is True
    await db_session.flush()

    loading.dispatcher_override_note = "a completely different note, substituted after the fact"
    await db_session.flush()

    outcome = await verify_subject(db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=loading.id)

    assert outcome.status == VerifyStatus.DB_MISMATCH


@respx.mock
async def test_verify_subject_after_arrival_anchors_returns_verified(
    client: AsyncClient, db_session, seed_trip, monkeypatch,
):
    """Mirrors tests/integration/test_phase_anchoring.py's
    test_upload_complete_anchor_verify_and_detect_replacement_end_to_end (the
    established way this suite stubs live Storage/HCS transports for /blockchain/verify),
    scoped to the arrival phase specifically — real HTTP, real hashing, real SQL."""
    trip, driver = seed_trip
    driver_token = make_token(sub=str(driver.id), role="driver")

    objects: dict[str, bytes] = {}
    from unittest.mock import MagicMock

    storage_client = MagicMock()

    def store(path: str, file_bytes: bytes, file_options: dict) -> None:
        objects[path] = file_bytes

    storage_client.storage.from_.return_value.upload.side_effect = store
    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: storage_client)

    async def upload(label: str) -> str:
        content = b"\xff\xd8\xff" + label.encode()
        response = await client.post(
            "/api/v1/artifacts", headers=auth_header(driver_token),
            data={
                "trip_id": str(trip.id), "artifact_type": "photo",
                "captured_at": datetime.now(UTC).isoformat(),
            },
            files={"file": ("evidence.jpg", content, "image/jpeg")},
        )
        assert response.status_code == 201
        return response.json()["id"]

    await _walk_to_in_transit(client, db_session, trip, driver_token)
    await _complete_in_transit(client, trip, driver_token)

    arrival_id = await _phase_id(client, trip.id, driver_token, "arrival")
    seal_photo_id = await upload("arrival-seal")
    resp = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{arrival_id}/complete",
        json={
            "phase_type": "arrival", "seal_condition": "intact",
            "seal_number_at_arrival": "AB-1234", "seal_photo_artifact_id": seal_photo_id,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200, resp.text

    arrival = await db_session.get(PhaseEvent, uuid.UUID(arrival_id))
    reconstructed = await reconstruct_pending_phase_payload(db_session, arrival)
    assert reconstructed is not None
    anchored = await anchor_phase_event(
        db_session, phase_event_id=arrival.id,
        canonical_payload=reconstructed, receipt_type=receipt_type_for(arrival),
    )
    assert anchored is True
    await db_session.flush()
    receipt = await db_session.get(BlockchainReceipt, arrival.blockchain_receipt_id)

    artifact = await db_session.get(EvidenceArtifact, uuid.UUID(seal_photo_id))
    prefix = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/evidence-artifacts/"

    def download(request: httpx.Request) -> httpx.Response:
        key = request.url.path.split("/evidence-artifacts/", 1)[1]
        return httpx.Response(200, content=objects[key])

    respx.get(url__startswith=prefix).mock(side_effect=download)
    mirror = respx.get(url__regex=r"/api/v1/topics/.*/messages/\d+").respond(200, json={
        "message": base64.b64encode(receipt.data_hash.encode()).decode(),
    })

    admin = (await db_session.execute(
        select(User).where(User.organization_id == trip.operator_organization_id)
    )).scalar_one()
    admin_headers = auth_header(
        make_token(sub=str(admin.id), role="admin_dispatcher", org_id=str(trip.operator_organization_id)),
    )

    verified = await client.post(
        "/api/v1/blockchain/verify", headers=admin_headers,
        json={"subject_type": "phase_event", "subject_id": arrival_id},
    )

    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    assert verified.json()["evidence_verified"] is True
    assert mirror.call_count == 1
    assert artifact.file_hash == hashlib.sha256(b"\xff\xd8\xff" + b"arrival-seal").hexdigest()
