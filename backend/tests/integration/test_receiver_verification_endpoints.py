"""The four public receiver-verification routes.

The one thing every case here must prove alongside its own behaviour: every public
failure — unknown token, missing consent, whatever the reason — produces the byte-identical
generic 404 the FP-155 confirm surface already established. A distinguishable message on
any of these routes would hand a guesser an oracle.
"""

import base64
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import event, select

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
    TripStatus,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.phases import PhaseEvent
from app.db.models.receiver_verification import IdvsQuotaLedger, ReceiverIdentityVerification
from app.db.models.trips import Trip, TripStop
from app.db.session import get_db
from app.integrations.idvs import IdvsDecisionStatus, MockIdvsClient
from app.main import app
from app.orchestration.handover_service import hash_presented_token
from app.storage.supabase_storage import UploadResult
from tests.conftest import auth_header, make_token

_GENERIC_NOT_FOUND = "This delivery confirmation link is not valid."
_CONSENT_TEXT = "I agree to my identity document and photograph being checked."
_CONSENT_BODY = {"consent_text": _CONSENT_TEXT, "consented": True}


@pytest.fixture(autouse=True)
def _force_mock_idvs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin IDVS_USE_MOCK on for every test in this module.

    These tests are entirely mock-backed — they construct MockIdvsClient directly, or
    drive endpoints that reach it through get_idvs_client(). Without this they read the
    DEVELOPER'S .env: anyone running with IDVS_USE_MOCK=false (what you set to exercise
    live Didit locally) gets IdvsUnsupportedError from stage_decision, or an endpoint that
    builds a real DiditIdvsClient and tries to reach the vendor over the network — which
    surfaces as a verification stuck on 'pending'.

    These passed CI only by accident: CI checks out no .env, so the field fell back to its
    default of true. A test whose result depends on an untracked file on one machine is
    not testing what it claims to.
    """
    monkeypatch.setattr(settings, "IDVS_USE_MOCK", True)


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """The full-walk tests end in a confirm, which uploads the signature. Without this
    stub that upload goes to whatever SUPABASE_URL is set: a real bucket on a developer's
    machine, an unresolvable test host in CI. Same stub as test_handover_endpoints.py."""
    async def fake_upload(*, trip_id: uuid.UUID, file_bytes: bytes, mime_type: str) -> UploadResult:
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}", file_hash="a" * 64,
        )

    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake_upload)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    """Point the app at the test transaction, exactly as test_handover_endpoints.py does."""
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def handover_trip(db_session, seed):
    """An active trip at its destination stop, with a PENDING confirmation phase event.

    Copied from tests/integration/test_handover_endpoints.py — there is no shared fixture
    for this in conftest.py, and each handover test file builds its own.
    """
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-RECEIVERV",
        operator_organization_id=seed["org"].id,
        driver_id=seed["driver"].id,
        horse_id=seed["horse"].id,
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
        status=PhaseStatus.PENDING, anchor_status=AnchorStatus.PENDING,
    )
    db_session.add(event)
    await db_session.flush()

    return {"trip": trip, "stop": stop, "event": event, "driver": seed["driver"]}


@pytest_asyncio.fixture
def driver_auth(handover_trip):
    return auth_header(make_token(sub=str(handover_trip["driver"].id), role="driver"))


async def _issue(client: AsyncClient, handover_trip, driver_auth) -> str:
    """Issue a real capability token through the driver route, exactly as a driver would,
    and return the raw token string embedded in the resulting scan_url."""
    trip, event = handover_trip["trip"], handover_trip["event"]
    res = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    return res.json()["scan_url"].rsplit("/", 1)[1]


async def _verification_row(db_session, token: str) -> ReceiverIdentityVerification:
    """Read the verification row back by token hash, for assertions the HTTP surface
    deliberately does not expose (e.g. that no session was ever created)."""
    row = (
        await db_session.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.token_hash == hash_presented_token(token)
            )
        )
    ).scalar_one()
    return (
        await db_session.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.token_id == row.id
            )
        )
    ).scalar_one()


# ── Consent ──────────────────────────────────────────────────────────────────


async def test_consent_creates_a_pending_verification(client, handover_trip, driver_auth):
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "pending"
    assert body["tier"] == "document_and_face"
    # The token is still live afterwards — consent must not redeem it.
    assert (await client.get(f"/api/v1/handover/{token}")).status_code == 200


async def test_consent_is_idempotent_across_a_reload(client, handover_trip, driver_auth):
    token = await _issue(client, handover_trip, driver_auth)

    first = await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    second = await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()


async def test_consent_without_a_document_degrades_to_selfie_only(
    client, handover_trip, driver_auth,
):
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(
        f"/api/v1/handover/{token}/consent",
        json={**_CONSENT_BODY, "has_document": False},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["tier"] == "selfie_only"
    assert body["unverified_reason"] == "no_document"


async def test_declining_the_identity_check_records_no_consent(
    client, handover_trip, driver_auth, db_session,
):
    """A decline is the opposite of consent: the row must say a decision was made without
    claiming the receiver agreed to anything, or evidence of consent is manufactured."""
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(
        f"/api/v1/handover/{token}/consent", json={**_CONSENT_BODY, "consented": False},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == ReceiverVerificationStatus.UNVERIFIED.value
    assert body["unverified_reason"] == ReceiverVerificationUnverifiedReason.DECLINED_CONSENT.value
    assert body["tier"] == ReceiverVerificationTier.TYPED_ONLY.value

    row = await _verification_row(db_session, token)
    assert row.consent_given_at is None
    assert row.consent_text_hash is None
    assert row.provider_session_id is None


async def test_declining_is_idempotent_across_a_reload(client, handover_trip, driver_auth):
    token = await _issue(client, handover_trip, driver_auth)
    body = {**_CONSENT_BODY, "consented": False}

    first = await client.post(f"/api/v1/handover/{token}/consent", json=body)
    second = await client.post(f"/api/v1/handover/{token}/consent", json=body)

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()


async def test_consent_without_the_decision_field_is_rejected(
    client, handover_trip, driver_auth, db_session,
):
    """A receiver page cached from before this field existed sends its decline without it
    (the old decline body below). Missing data must never establish agreement, so the
    request is rejected and nothing is stored."""
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(
        f"/api/v1/handover/{token}/consent",
        json={"consent_text": _CONSENT_TEXT, "has_document": False},
    )

    assert res.status_code == 422
    token_row = (
        await db_session.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.token_hash == hash_presented_token(token)
            )
        )
    ).scalar_one()
    verification = (
        await db_session.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.token_id == token_row.id
            )
        )
    ).scalar_one_or_none()
    assert verification is None


async def test_agreeing_without_a_document_records_consent_at_selfie_only(
    client, handover_trip, driver_auth, db_session,
):
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(
        f"/api/v1/handover/{token}/consent",
        json={**_CONSENT_BODY, "consented": True, "has_document": False},
    )

    assert res.status_code == 201
    assert res.json()["tier"] == ReceiverVerificationTier.SELFIE_ONLY.value
    row = await _verification_row(db_session, token)
    assert row.consent_given_at is not None, "agreeing with no document is still consent"
    assert row.unverified_reason == ReceiverVerificationUnverifiedReason.NO_DOCUMENT


# ── Verify ───────────────────────────────────────────────────────────────────


async def test_verify_returns_a_session_url_in_mock_mode(
    client, handover_trip, driver_auth, monkeypatch,
):
    monkeypatch.setattr(settings, "IDVS_USE_MOCK", True)
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    res = await client.post(f"/api/v1/handover/{token}/verify")

    assert res.status_code == 200
    body = res.json()
    assert body["session_url"] is not None
    assert body["tier"] == "document_and_face"


async def test_verify_degrades_without_creating_a_session_when_quota_is_spent(
    client, handover_trip, driver_auth, db_session, monkeypatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 0)
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    res = await client.post(f"/api/v1/handover/{token}/verify")

    assert res.status_code == 200
    body = res.json()
    assert body["session_url"] is None
    assert body["unverified_reason"] == "quota_exhausted"

    row = await _verification_row(db_session, token)
    assert row.provider_session_id is None, "no vendor session may be created once quota is spent"


async def _quota_used(db_session) -> int:
    """Free-tier sessions spent across every ledger row (each test runs in its own
    rolled-back transaction, so this is only this test's own spend plus any baseline)."""
    used = (await db_session.execute(select(IdvsQuotaLedger.sessions_used))).scalars().all()
    return sum(used)


async def test_verify_after_a_decline_degrades_without_a_vendor_call_or_quota(
    client, handover_trip, driver_auth, db_session,
):
    """Declined means no biometric processing: no vendor session, and no free-tier session
    spent on a check nobody agreed to. Degrades like every other path (200, null URL)."""
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(
        f"/api/v1/handover/{token}/consent", json={**_CONSENT_BODY, "consented": False},
    )
    used_before = await _quota_used(db_session)

    res = await client.post(f"/api/v1/handover/{token}/verify")

    assert res.status_code == 200
    body = res.json()
    assert body["session_url"] is None
    assert body["tier"] == ReceiverVerificationTier.TYPED_ONLY.value
    assert body["unverified_reason"] == ReceiverVerificationUnverifiedReason.DECLINED_CONSENT.value
    row = await _verification_row(db_session, token)
    assert row.provider_session_id is None
    assert await _quota_used(db_session) == used_before


async def test_a_repeated_verify_returns_the_same_degraded_answer_not_a_second_session(
    client, handover_trip, driver_auth, db_session,
):
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    first = await client.post(f"/api/v1/handover/{token}/verify")
    session_id = (await _verification_row(db_session, token)).provider_session_id
    used_after_first = await _quota_used(db_session)

    second = await client.post(f"/api/v1/handover/{token}/verify")

    assert first.json()["session_url"] is not None
    assert second.status_code == 200
    assert second.json()["session_url"] is None
    assert (await _verification_row(db_session, token)).provider_session_id == session_id
    assert await _quota_used(db_session) == used_after_first


async def test_verify_locks_the_verification_row_before_deciding(
    client, handover_trip, driver_auth, db_session,
):
    """Two simultaneous /verify calls must serialise on the row, or both would pass the
    'no session yet' check. Asserts the lock is actually requested."""
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:
        statements.append(statement)

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        await client.post(f"/api/v1/handover/{token}/verify")
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    locking = [
        sql for sql in statements
        if "receiver_identity_verifications" in sql and "FOR UPDATE" in sql
    ]
    assert locking, "the verification row was read without FOR UPDATE"


async def test_verify_without_prior_consent_is_the_generic_404(client, handover_trip, driver_auth):
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.post(f"/api/v1/handover/{token}/verify")

    assert res.status_code == 404
    assert res.json()["detail"] == _GENERIC_NOT_FOUND


# ── Resolve ──────────────────────────────────────────────────────────────────


async def test_resolve_moves_the_row_to_a_terminal_status(
    client, handover_trip, driver_auth, db_session,
):
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    await client.post(f"/api/v1/handover/{token}/verify")

    res = await client.post(
        f"/api/v1/handover/{token}/verify/resolve",
        json={"receiver_name": "Thandi Nkosi", "receiver_id_number": "9202204720082"},
    )

    assert res.status_code == 200
    assert res.json()["status"] in {
        s.value for s in ReceiverVerificationStatus if s != ReceiverVerificationStatus.PENDING
    }

    row = await _verification_row(db_session, token)
    assert row.status != ReceiverVerificationStatus.PENDING


_NKOSI_NAME = "Thandi Nkosi"
_NKOSI_ID = "9202204720082"


async def _stage_nkosi_document(db_session, token: str) -> None:
    """Make the mock vendor 'read' Nkosi's document, so the identity cross-check has
    something to compare against (an unstaged mock session extracts nothing)."""
    row = await _verification_row(db_session, token)
    assert row.provider_session_id is not None
    await MockIdvsClient().stage_decision(
        row.provider_session_id,
        status=IdvsDecisionStatus.APPROVED,
        extracted_surname="Nkosi",
        extracted_id_number=_NKOSI_ID,
    )


async def _started_session(client, handover_trip, driver_auth, db_session) -> str:
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    await client.post(f"/api/v1/handover/{token}/verify")
    await _stage_nkosi_document(db_session, token)
    return token


async def test_resolve_compares_the_identity_sent_in_the_json_body(
    client, handover_trip, driver_auth, db_session,
):
    token = await _started_session(client, handover_trip, driver_auth, db_session)

    res = await client.post(
        f"/api/v1/handover/{token}/verify/resolve",
        json={"receiver_name": _NKOSI_NAME, "receiver_id_number": _NKOSI_ID},
    )

    assert res.status_code == 200
    assert res.json()["status"] == ReceiverVerificationStatus.VERIFIED.value
    assert res.json()["identity_match"] is True


async def test_resolve_ignores_identity_sent_in_the_query_string(
    client, handover_trip, driver_auth, db_session,
):
    """The query string lands in access and proxy logs, so it must never carry the
    identity: values there may not feed the comparison at all."""
    token = await _started_session(client, handover_trip, driver_auth, db_session)

    res = await client.post(
        f"/api/v1/handover/{token}/verify/resolve",
        params={"receiver_name": _NKOSI_NAME, "receiver_id_number": _NKOSI_ID},
        json={},
    )

    assert res.status_code == 200
    assert res.json()["identity_match"] is False, "the query-string identity was compared"
    assert res.json()["status"] == ReceiverVerificationStatus.FAILED.value


async def test_resolve_without_a_body_is_unprocessable(
    client, handover_trip, driver_auth, db_session,
):
    """An old client still sending only a query string must fail loudly, not be compared
    against two empty strings and file a false identity-mismatch finding."""
    token = await _started_session(client, handover_trip, driver_auth, db_session)

    res = await client.post(
        f"/api/v1/handover/{token}/verify/resolve",
        params={"receiver_name": _NKOSI_NAME, "receiver_id_number": _NKOSI_ID},
    )

    assert res.status_code == 422
    row = await _verification_row(db_session, token)
    assert row.status == ReceiverVerificationStatus.PENDING


@pytest.mark.parametrize(
    "body",
    [
        {"receiver_name": "n" * 121},
        {"receiver_id_number": "9" * 61},
    ],
)
async def test_resolve_rejects_oversized_identity_fields(
    client, handover_trip, driver_auth, db_session, body,
):
    token = await _started_session(client, handover_trip, driver_auth, db_session)

    res = await client.post(f"/api/v1/handover/{token}/verify/resolve", json=body)

    assert res.status_code == 422


# ── The shared oracle ────────────────────────────────────────────────────────


async def test_an_unknown_token_is_the_identical_404_on_every_route(client):
    unknown = "a" * 43

    consent = await client.post(f"/api/v1/handover/{unknown}/consent", json=_CONSENT_BODY)
    verify = await client.post(f"/api/v1/handover/{unknown}/verify")
    resolve = await client.post(f"/api/v1/handover/{unknown}/verify/resolve", json={})

    for res in (consent, verify, resolve):
        assert res.status_code == 404
        assert res.json()["detail"] == _GENERIC_NOT_FOUND


# ── Scan response verification block ────────────────────────────────────────


async def test_scan_before_consent_carries_a_null_verification_block(
    client, handover_trip, driver_auth,
):
    token = await _issue(client, handover_trip, driver_auth)

    res = await client.get(f"/api/v1/handover/{token}")

    assert res.status_code == 200
    assert res.json()["verification"] is None


async def test_scan_after_consent_carries_the_pending_verification_block(
    client, handover_trip, driver_auth,
):
    token = await _issue(client, handover_trip, driver_auth)
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    res = await client.get(f"/api/v1/handover/{token}")

    assert res.status_code == 200
    verification = res.json()["verification"]
    assert verification["status"] == "pending"
    assert verification["tier"] == "document_and_face"


# ── End-to-end walks ──────────────────────────────────────────────────────────
#
# The tests above prove each route in isolation. These three prove the thing that actually
# matters: a delivery gets confirmed. One walk for the happy path, and two for the ways the
# world goes wrong — because the whole design rests on the promise that a failed identity
# check never costs anyone a delivery that physically happened.

_E2E_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
_E2E_CONFIRM = {
    "receiver_name": "Thandi Nkosi",
    "receiver_id_number": "9202204720082",
    "signature_png_base64": _E2E_PNG,
}


async def test_full_walk_verified_receiver_confirms_the_delivery(
    client, handover_trip, driver_auth, db_session,
):
    """Scan -> consent -> verify -> resolve -> confirm, the way a real handover runs."""
    token = await _issue(client, handover_trip, driver_auth)

    scan = await client.get(f"/api/v1/handover/{token}")
    assert scan.status_code == 200
    assert scan.json()["verification"] is None

    consent = await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)
    assert consent.status_code == 201
    assert consent.json()["status"] == ReceiverVerificationStatus.PENDING.value

    started = await client.post(f"/api/v1/handover/{token}/verify")
    assert started.status_code == 200
    assert started.json()["session_url"] is not None, "the mock vendor must hand back a URL"

    resolved = await client.post(
        f"/api/v1/handover/{token}/verify/resolve",
        json={"receiver_name": "Thandi Nkosi", "receiver_id_number": "9202204720082"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == ReceiverVerificationStatus.VERIFIED.value

    confirmed = await client.post(f"/api/v1/handover/{token}/confirm", json=_E2E_CONFIRM)
    assert confirmed.status_code == 201, confirmed.text

    # The verification must now point at the confirmation the receiver actually signed.
    row = await _verification_row(db_session, token)
    assert row.handover_confirmation_id is not None, "verification was never linked to the POD"


async def test_full_walk_receiver_without_an_id_still_confirms(
    client, handover_trip, driver_auth, db_session,
):
    """No document on them. The delivery must still complete, at a lower evidence tier."""
    token = await _issue(client, handover_trip, driver_auth)
    await client.get(f"/api/v1/handover/{token}")

    consent = await client.post(
        f"/api/v1/handover/{token}/consent", json={**_CONSENT_BODY, "has_document": False},
    )
    assert consent.status_code == 201
    assert consent.json()["tier"] == "selfie_only"
    assert consent.json()["unverified_reason"] == "no_document"

    confirmed = await client.post(f"/api/v1/handover/{token}/confirm", json=_E2E_CONFIRM)
    assert confirmed.status_code == 201, "a receiver with no ID must still confirm the delivery"


async def test_full_walk_survives_the_vendor_being_unavailable(
    client, handover_trip, driver_auth, db_session, monkeypatch,
):
    """Quota exhausted stands in for any vendor-side failure. No session is created, no
    money is spent, and the delivery is confirmed anyway."""
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 0)
    token = await _issue(client, handover_trip, driver_auth)
    await client.get(f"/api/v1/handover/{token}")
    await client.post(f"/api/v1/handover/{token}/consent", json=_CONSENT_BODY)

    started = await client.post(f"/api/v1/handover/{token}/verify")
    assert started.status_code == 200
    assert started.json()["session_url"] is None
    assert started.json()["unverified_reason"] == "quota_exhausted"

    row = await _verification_row(db_session, token)
    assert row.provider_session_id is None, "no vendor session may be created past the ceiling"

    confirmed = await client.post(f"/api/v1/handover/{token}/confirm", json=_E2E_CONFIRM)
    assert confirmed.status_code == 201, "a vendor outage must never block a real delivery"
