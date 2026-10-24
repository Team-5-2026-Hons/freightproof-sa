"""FP-83 C6: the HTTP routes, against the contract's endpoint/status/code matrix.

Seeded on `db_session` (which the app's get_db shares), driven through the real ASGI app with
signed test tokens. The service clock is the C3 tests' fixed NOW, so licence/availability rules
are exact. Storage is a fake that hashes the real bytes.
"""

import hashlib
import os
import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.driver_substitutions import DriverSubstitutionNotice, DriverSubstitutionRequest
from app.db.models.enums import IdvsStatus, TripType
from app.db.models.people import User
from app.db.models.trips import Trip
from app.db.session import get_db
from app.main import app
from app.storage.supabase_storage import UploadResult
from tests.conftest import auth_header, make_token
from tests.integration._driver_substitution_world import SubWorld, driver_headers
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, clock, get_row, set_identity, world_with_licences,
)

BASE = "/api/v1/trips"
CAPTURED = (NOW - timedelta(minutes=10)).isoformat()


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    """The app's get_db yields the test's rolled-back session, so seeds and requests share it."""
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def storage(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_upload(*, trip_id: str, file_bytes: bytes, mime_type: str) -> UploadResult:
        return UploadResult(s3_bucket="b", s3_key=f"{trip_id}/{uuid.uuid4()}", file_hash=hashlib.sha256(file_bytes).hexdigest())

    monkeypatch.setattr("app.orchestration.substitutions.artifacts.upload_evidence_file", fake_upload)

    async def no_url(**_: object) -> None:
        return None

    monkeypatch.setattr("app.orchestration.substitutions.reads.create_signed_url", no_url)


def dispatcher(w: SubWorld, *, admin: bool = False, user_id: uuid.UUID | None = None) -> dict[str, str]:
    return auth_header(make_token(sub=str(user_id or w.user_id), role="admin_dispatcher" if admin else "dispatcher"))


async def foreign_dispatcher(db: AsyncSession, w: SubWorld) -> uuid.UUID:
    """A dispatcher account in another organisation (the org comes from the user row)."""
    user = User(id=uuid.uuid4(), organization_id=w.other_org_id, email=f"{uuid.uuid4()}@test.co.za", full_name="Other")
    db.add(user)
    await db.flush()
    return user.id


def arrangement(w: SubWorld, key: str | None = None, incoming: uuid.UUID | None = None) -> dict[str, object]:
    return {
        "client_request_id": key or str(uuid.uuid4()), "incoming_driver_id": str(incoming or w.b),
        "exchange": {"label": "Beaufort West depot", "latitude": -32.35, "longitude": 22.58, "instructions": "Gate 2"},
        "expected_at": (NOW + timedelta(hours=2)).isoformat(), "is_planned": True, "reason": "Hours of service",
    }


def immediate_arrangement(w: SubWorld, key: str | None = None) -> dict[str, object]:
    return {"client_request_id": key or str(uuid.uuid4()), "request_format": "immediate_v2", "incoming_driver_id": str(w.b), "reason": "Immediate relief"}


def capture(w: SubWorld, version: int, key: str | None = None) -> dict[str, object]:
    return {
        "client_request_id": key or str(uuid.uuid4()), "expected_version": version, "captured_at": CAPTURED,
        "latitude": -32.35, "longitude": 22.58, "accuracy_metres": 8.0, "confirmed_vehicle_ids": [str(w.horse_id)],
        "seal_checks": [{"vehicle_id": str(w.horse_id), "condition": "not_applicable", "seal_number": None,
                         "photo_artifact_ids": [], "not_applicable_reason": "Empty leg"}],
        "discrepancy_note": None,
    }


async def arranged(client: AsyncClient, db: AsyncSession) -> tuple[SubWorld, dict[str, object]]:
    """A pending A -> B arrangement, B holding a VERIFIED fleet identity (as `armed` does)."""
    w = await world_with_licences(db)
    await set_identity(db, w.b, IdvsStatus.VERIFIED)
    # An in-flight v1 request was accepted before deployment; new HTTP creates are v2.
    from app.orchestration.substitutions.service import arrange_substitution
    from app.schemas.driver_substitutions import ArrangeSubstitutionRequest
    from tests.integration.test_driver_substitution_service import dispatcher as service_dispatcher
    read = await arrange_substitution(db, trip_id=w.trip_id, actor=service_dispatcher(w), payload=ArrangeSubstitutionRequest.model_validate(arrangement(w)))
    return w, read.model_dump(mode="json")


def confirm_url(w: SubWorld, request_id: object) -> str:
    return f"{BASE}/me/{w.trip_id}/driver-substitutions/{request_id}/confirmations"


async def count_requests(db: AsyncSession, trip_id: uuid.UUID) -> int:
    return (await db.execute(
        select(func.count()).select_from(DriverSubstitutionRequest).where(DriverSubstitutionRequest.trip_id == trip_id)
    )).scalar_one()


# ── dispatcher arrangement, auth and the flag ────────────────────────────────


async def test_arrange_returns_201_and_an_exact_replay_returns_the_same_request(client: AsyncClient, db_session: AsyncSession):
    w = await world_with_licences(db_session)
    body = immediate_arrangement(w)
    url = f"{BASE}/{w.trip_id}/driver-substitutions"

    first = await client.post(url, json=body, headers=dispatcher(w))
    again = await client.post(url, json=body, headers=dispatcher(w))

    assert (first.status_code, again.status_code) == (201, 201)
    assert first.json()["id"] == again.json()["id"] and first.json()["state"] == "pending"
    assert await count_requests(db_session, w.trip_id) == 1


async def test_auth_role_tenant_and_validation(client: AsyncClient, db_session: AsyncSession):
    w = await world_with_licences(db_session)
    url = f"{BASE}/{w.trip_id}/driver-substitutions"

    missing = await client.post(url, json=arrangement(w))
    as_driver = await client.post(url, json=arrangement(w), headers=driver_headers(w.a))
    foreign = await client.post(url, json=arrangement(w), headers=dispatcher(w, user_id=await foreign_dispatcher(db_session, w)))
    malformed = await client.post(url, json={**arrangement(w), "reason": ""}, headers=dispatcher(w))

    assert missing.status_code in (401, 403) and as_driver.status_code == 403
    assert foreign.status_code == 404
    assert malformed.status_code == 422
    assert await count_requests(db_session, w.trip_id) == 0


async def test_disabled_flag_refuses_new_arrangements_but_keeps_existing_work(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch,
):
    w, pending = await arranged(client, db_session)
    replay_body = arrangement(w)
    monkeypatch.setattr(settings, "DRIVER_SUBSTITUTIONS_ENABLED", False)

    refused = await client.post(f"{BASE}/{w.trip_id}/driver-substitutions", json=replay_body, headers=dispatcher(w))
    confirmed = await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.a))
    cancelled = await client.post(
        f"{BASE}/{w.trip_id}/driver-substitutions/{pending['id']}/cancel",
        json={"client_request_id": str(uuid.uuid4()), "expected_version": 2, "reason": "Not needed"},
        headers=dispatcher(w),
    )

    assert refused.status_code == 503 and refused.json()["detail"]["code"] == "SUBSTITUTIONS_DISABLED"
    assert confirmed.status_code == 200 and cancelled.status_code == 200, cancelled.text
    assert await count_requests(db_session, w.trip_id) == 1


# ── driver confirmation and dispatcher completion ────────────────────────────


async def test_two_confirmations_complete_and_a_stale_version_is_a_coded_conflict(client: AsyncClient, db_session: AsyncSession):
    w, pending = await arranged(client, db_session)

    first = await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.a))
    stale = await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.b))
    final = await client.post(confirm_url(w, pending["id"]), json=capture(w, 2), headers=driver_headers(w.b))

    assert first.status_code == 200 and first.json()["state"] == "pending"
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "SUBSTITUTION_VERSION_CHANGED" and stale.json()["detail"]["current_version"] == 2
    assert final.status_code == 200 and final.json()["state"] == "completed", final.json()["completion_blocked_by"]


async def test_a_blocked_confirmation_is_200_pending_and_dispatcher_completion_is_409(client: AsyncClient, db_session: AsyncSession):
    w, pending = await arranged(client, db_session)
    await set_identity(db_session, w.b, IdvsStatus.PENDING)
    await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.a))

    blocked = await client.post(confirm_url(w, pending["id"]), json=capture(w, 2), headers=driver_headers(w.b))
    url = f"{BASE}/{w.trip_id}/driver-substitutions/{pending['id']}/complete"
    no_reason = await client.post(url, json={"client_request_id": str(uuid.uuid4()), "expected_version": 3}, headers=dispatcher(w))
    non_admin = await client.post(url, json={
        "client_request_id": str(uuid.uuid4()), "expected_version": 3, "identity_unavailable_reason": "IDVS down",
    }, headers=dispatcher(w))
    admin = await client.post(url, json={
        "client_request_id": str(uuid.uuid4()), "expected_version": 3, "identity_unavailable_reason": "IDVS down",
    }, headers=dispatcher(w, admin=True))

    assert blocked.status_code == 200
    assert (blocked.json()["state"], blocked.json()["completion_blocked_by"]) == ("pending", "identity_not_verified")
    assert no_reason.status_code == 409 and no_reason.json()["detail"]["code"] == "IDENTITY_NOT_VERIFIED"
    assert non_admin.status_code == 403 and non_admin.json()["detail"]["code"] == "IDENTITY_ATTESTATION_FORBIDDEN"
    assert admin.status_code == 200, admin.text
    assert (admin.json()["state"], admin.json()["identity"]["status"]) == ("completed", "pending")


async def test_a_reused_key_with_a_changed_body_is_a_coded_conflict(client: AsyncClient, db_session: AsyncSession):
    w = await world_with_licences(db_session)
    url = f"{BASE}/{w.trip_id}/driver-substitutions"
    key = str(uuid.uuid4())
    await client.post(url, json=immediate_arrangement(w, key), headers=dispatcher(w))

    changed = await client.post(url, json={**immediate_arrangement(w, key), "reason": "Something else"}, headers=dispatcher(w))

    assert changed.status_code == 409 and changed.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


# ── driver reads and notices ─────────────────────────────────────────────────


async def test_notice_route_is_not_parsed_as_trip_uuid(client: AsyncClient, db_session: AsyncSession):
    w, pending = await arranged(client, db_session)

    mine = await client.get(f"{BASE}/me/substitution-notices", headers=driver_headers(w.b))
    others = await client.get(f"{BASE}/me/substitution-notices", headers=driver_headers(w.c))

    assert mine.status_code == 200, mine.text
    assert [(n["request_id"], n["kind"]) for n in mine.json()] == [(pending["id"], "arranged")]
    assert others.status_code == 200 and others.json() == []


async def test_marking_a_notice_read_keeps_the_first_read_time_and_is_owner_only(client: AsyncClient, db_session: AsyncSession):
    w, _ = await arranged(client, db_session)
    [notice] = (await client.get(f"{BASE}/me/substitution-notices", headers=driver_headers(w.b))).json()
    url = f"{BASE}/me/substitution-notices/{notice['id']}/read"

    first = await client.post(url, headers=driver_headers(w.b))
    again = await client.post(url, headers=driver_headers(w.b))
    stranger = await client.post(url, headers=driver_headers(w.a))
    unread = await client.get(f"{BASE}/me/substitution-notices", headers=driver_headers(w.b))

    assert first.status_code == 200 and first.json()["read_at"] is not None
    assert again.json()["read_at"] == first.json()["read_at"]
    assert stranger.status_code == 404
    assert unread.json() == []
    stored = await get_row(db_session, DriverSubstitutionNotice, uuid.UUID(notice["id"]))
    assert stored.read_at is not None


async def test_the_incoming_driver_discovers_the_handover_without_an_active_trip(client: AsyncClient, db_session: AsyncSession):
    w, pending = await arranged(client, db_session)

    assignments = await client.get(f"{BASE}/me/driver-substitutions", headers=driver_headers(w.b))
    context = await client.get(f"{BASE}/me/{w.trip_id}/driver-substitutions/{pending['id']}", headers=driver_headers(w.b))
    stranger = await client.get(f"{BASE}/me/{w.trip_id}/driver-substitutions/{pending['id']}", headers=driver_headers(w.c))

    assert [a["id"] for a in assignments.json()] == [pending["id"]]
    assert assignments.json()[0]["permitted_actions"] == ["confirm_incoming"]
    assert context.status_code == 200 and context.json()["exchange"]["label"] == "Beaufort West depot"
    assert stranger.status_code == 404


async def test_handover_upload_then_confirmation_citing_it(client: AsyncClient, db_session: AsyncSession):
    w, pending = await arranged(client, db_session)
    (await get_row(db_session, Trip, w.trip_id)).trip_type = TripType.LOADED.value
    await db_session.flush()

    upload = await client.post(
        f"{BASE}/me/{w.trip_id}/driver-substitutions/{pending['id']}/artifacts",
        data={"client_request_id": str(uuid.uuid4()), "role": "outgoing", "artifact_type": "photo",
              "captured_at": CAPTURED},
        files={"file": ("seal.jpg", b"\xff\xd8\xff\xe0" + os.urandom(32), "image/jpeg")},
        headers=driver_headers(w.a),
    )
    wrong_role = await client.post(
        f"{BASE}/me/{w.trip_id}/driver-substitutions/{pending['id']}/artifacts",
        data={"client_request_id": str(uuid.uuid4()), "role": "incoming", "artifact_type": "photo",
              "captured_at": CAPTURED},
        files={"file": ("seal.jpg", b"\xff\xd8\xff\xe0" + os.urandom(32), "image/jpeg")},
        headers=driver_headers(w.a),
    )
    body = capture(w, 1)
    body["seal_checks"] = [{"vehicle_id": str(w.horse_id), "condition": "intact", "seal_number": "AB-1234",
                            "photo_artifact_ids": [upload.json()["id"]], "not_applicable_reason": None}]
    confirmed = await client.post(confirm_url(w, pending["id"]), json=body, headers=driver_headers(w.a))

    assert upload.status_code == 201, upload.text
    assert wrong_role.status_code == 422
    assert confirmed.status_code == 200, confirmed.text


# ── after the handover: history, late evidence, corrections ─────────────────


async def completed(client: AsyncClient, db: AsyncSession) -> tuple[SubWorld, dict[str, object]]:
    w, pending = await arranged(client, db)
    await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.a))
    done = await client.post(confirm_url(w, pending["id"]), json=capture(w, 2), headers=driver_headers(w.b))
    assert done.json()["state"] == "completed"
    return w, done.json()


async def test_the_former_driver_reads_only_their_own_participation(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)

    former = await client.get(f"{BASE}/me/{w.trip_id}/participation", headers=driver_headers(w.a))
    stranger = await client.get(f"{BASE}/me/{w.trip_id}/participation", headers=driver_headers(w.c))

    assert former.status_code == 200
    periods = former.json()["custody_periods"]
    assert [p["custody_sequence"] for p in periods] == [0] and periods[0]["ended_at"] is not None
    assert [d["role"] for d in former.json()["declarations"]] == ["outgoing"]
    assert stranger.status_code == 404


async def test_late_evidence_round_trip_and_dispatcher_acknowledgement(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)
    photo = await client.post(
        f"{BASE}/me/{w.trip_id}/late-evidence/artifacts",
        data={"client_request_id": str(uuid.uuid4()), "custody_sequence": "0", "artifact_type": "photo", "captured_at": CAPTURED},
        files={"file": ("late.jpg", b"\xff\xd8\xff\xe0" + os.urandom(32), "image/jpeg")},
        headers=driver_headers(w.a),
    )
    late = {
        "client_request_id": str(uuid.uuid4()), "custody_sequence": 0, "captured_at": CAPTURED,
        "original_idempotency_key": None, "artifact_ids": [photo.json()["id"]],
        "evidence": {"kind": "exception", "payload": {"exception_type": "mechanical", "description": "Flat tyre"}},
    }

    receipt = await client.post(f"{BASE}/me/{w.trip_id}/late-evidence", json=late, headers=driver_headers(w.a))
    replay = await client.post(f"{BASE}/me/{w.trip_id}/late-evidence", json=late, headers=driver_headers(w.a))
    current = await client.post(f"{BASE}/me/{w.trip_id}/late-evidence", json={**late, "client_request_id": str(uuid.uuid4()),
                                "custody_sequence": 1, "artifact_ids": []}, headers=driver_headers(w.b))
    review = await client.get(f"{BASE}/{w.trip_id}/late-evidence", headers=dispatcher(w))
    ack = await client.post(
        f"{BASE}/{w.trip_id}/late-evidence/{receipt.json()['id']}/acknowledge",
        json={"client_request_id": str(uuid.uuid4()), "note": "Reviewed"}, headers=dispatcher(w),
    )

    assert photo.status_code == 201, photo.text
    assert receipt.status_code == 201 and replay.json()["id"] == receipt.json()["id"]
    assert receipt.json()["status"] == "awaiting_review"
    assert current.status_code == 422
    [detail] = review.json()
    assert detail["evidence"]["kind"] == "exception" and len(detail["payload_sha256"]) == 64
    assert ack.status_code == 200 and ack.json()["status"] == "acknowledged"


async def test_a_correction_is_201_and_immutable(client: AsyncClient, db_session: AsyncSession):
    w, done = await completed(client, db_session)
    url = f"{BASE}/{w.trip_id}/driver-substitutions/completed/{done['completed_substitution_id']}/corrections"
    body = {"client_request_id": str(uuid.uuid4()), "reason": "Depot name", "correction_note": "Gate 3, not 2"}

    first = await client.post(url, json=body, headers=dispatcher(w))
    again = await client.post(url, json=body, headers=dispatcher(w))

    assert first.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert first.json()["anchor_status"] == "pending"


# ── OpenAPI ──────────────────────────────────────────────────────────────────


def test_route_operation_ids_are_unique_and_driver_literals_precede_trip_ids():
    schema = app.openapi()
    operation_ids = [op["operationId"] for path in schema["paths"].values() for op in path.values() if "operationId" in op]
    assert len(operation_ids) == len(set(operation_ids))
    paths = [route.path for route in app.routes if hasattr(route, "path")]
    assert paths.index("/api/v1/trips/me/driver-substitutions") < paths.index("/api/v1/trips/me/{trip_id}")

async def test_completed_detail_is_dispatcher_org_scoped(client: AsyncClient, db_session: AsyncSession):
    w, done = await completed(client, db_session)
    url = f"{BASE}/{w.trip_id}/driver-substitutions/completed/{done['completed_substitution_id']}"
    detail = await client.get(url, headers=dispatcher(w))
    driver = await client.get(url, headers=driver_headers(w.a))
    foreign = await client.get(url, headers=dispatcher(w, user_id=await foreign_dispatcher(db_session, w)))
    anonymous = await client.get(url)
    assert detail.status_code == 200, detail.text
    assert len(detail.json()['confirmations']) == 2
    assert driver.status_code == 403
    assert foreign.status_code == 404
    assert anonymous.status_code in (401, 403)


async def attested_completion(client: AsyncClient, db: AsyncSession) -> tuple[SubWorld, dict[str, object], User, User]:
    """A transfer completed over a PENDING identity by an admin who is not the dispatcher who arranged it."""
    w, pending = await arranged(client, db)
    arranger = await get_row(db, User, w.user_id)
    arranger.full_name = "Anna Arranger"
    attester = User(id=uuid.uuid4(), organization_id=arranger.organization_id, email=f"{uuid.uuid4()}@test.co.za", full_name="Bongani Attester")
    db.add(attester)
    await set_identity(db, w.b, IdvsStatus.PENDING)
    await client.post(confirm_url(w, pending["id"]), json=capture(w, 1), headers=driver_headers(w.a))
    await client.post(confirm_url(w, pending["id"]), json=capture(w, 2), headers=driver_headers(w.b))
    done = await client.post(f"{BASE}/{w.trip_id}/driver-substitutions/{pending['id']}/complete", json={
        "client_request_id": str(uuid.uuid4()), "expected_version": 3, "identity_unavailable_reason": "IDVS down",
    }, headers=dispatcher(w, admin=True, user_id=attester.id))
    assert done.status_code == 200, done.text
    return w, done.json(), arranger, attester


async def test_completed_detail_names_the_people_instead_of_their_ids(client: AsyncClient, db_session: AsyncSession):
    w, done, arranger, attester = await attested_completion(client, db_session)
    url = f"{BASE}/{w.trip_id}/driver-substitutions/completed/{done['completed_substitution_id']}"
    clarification = await client.post(f"{url}/corrections", json={
        "client_request_id": str(uuid.uuid4()), "reason": "Depot name", "correction_note": "Gate 3, not 2",
    }, headers=dispatcher(w))

    detail = await client.get(url, headers=dispatcher(w))

    assert clarification.status_code == 201, clarification.text
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["arranged_by_name"] == arranger.full_name
    assert body["completion"]["completed_by_name"] == attester.full_name
    assert body["identity_attestation"]["attested_by_name"] == attester.full_name
    assert [c["recorded_by_name"] for c in body["corrections"]] == [arranger.full_name]
    # The ids stay beside the labels: a name is a display aid, never the identity of the actor.
    assert body["arranged_by_user_id"] == str(arranger.id)
    assert body["completion"]["completed_by_user_id"] == str(attester.id)


async def test_a_driver_completed_transfer_names_the_completing_driver(client: AsyncClient, db_session: AsyncSession):
    w, done = await completed(client, db_session)
    detail = await client.get(f"{BASE}/{w.trip_id}/driver-substitutions/completed/{done['completed_substitution_id']}", headers=dispatcher(w))

    body = detail.json()
    assert body["completion"]["completed_by_driver_id"] == str(w.b)
    assert body["completion"]["completed_by_name"] == body["incoming"]["full_name"]
    assert body["identity_attestation"] is None


async def test_a_missing_name_is_null_not_an_error(client: AsyncClient, db_session: AsyncSession):
    w, done, arranger, _ = await attested_completion(client, db_session)
    # A label that cannot be resolved must never fail the read: park the arranger in another organisation.
    arranger.organization_id = w.other_org_id
    await db_session.flush()
    url = f"{BASE}/{w.trip_id}/driver-substitutions/completed/{done['completed_substitution_id']}"
    completion = done["completion"]
    assert isinstance(completion, dict)
    attester_id = uuid.UUID(completion["completed_by_user_id"])

    detail = await client.get(url, headers=dispatcher(w, admin=True, user_id=attester_id))

    assert detail.status_code == 200, detail.text
    assert detail.json()["arranged_by_name"] is None
    assert detail.json()["arranged_by_user_id"] == str(arranger.id)


async def test_an_unknown_completed_transfer_is_404(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)

    missing = await client.get(f"{BASE}/{w.trip_id}/driver-substitutions/completed/{uuid.uuid4()}", headers=dispatcher(w))

    assert missing.status_code == 404
