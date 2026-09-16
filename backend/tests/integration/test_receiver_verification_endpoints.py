"""The four public receiver-verification routes (Stage 2B, Task 4).

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
from sqlalchemy import select

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    TripStatus,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.phases import PhaseEvent
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.db.models.trips import Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.orchestration.handover_service import hash_presented_token
from tests.conftest import auth_header, make_token

_GENERIC_NOT_FOUND = "This delivery confirmation link is not valid."
_CONSENT_BODY = {"consent_text": "I agree to my identity document and photograph being checked."}


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
        params={"receiver_name": "Thandi Nkosi", "receiver_id_number": "9202204720082"},
    )

    assert res.status_code == 200
    assert res.json()["status"] in {
        s.value for s in ReceiverVerificationStatus if s != ReceiverVerificationStatus.PENDING
    }

    row = await _verification_row(db_session, token)
    assert row.status != ReceiverVerificationStatus.PENDING


# ── The shared oracle ────────────────────────────────────────────────────────


async def test_an_unknown_token_is_the_identical_404_on_every_route(client):
    unknown = "a" * 43

    consent = await client.post(f"/api/v1/handover/{unknown}/consent", json=_CONSENT_BODY)
    verify = await client.post(f"/api/v1/handover/{unknown}/verify")
    resolve = await client.post(f"/api/v1/handover/{unknown}/verify/resolve")

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
        params={"receiver_name": "Thandi Nkosi", "receiver_id_number": "9202204720082"},
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
