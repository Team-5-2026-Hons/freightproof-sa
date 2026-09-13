"""FP-239 — the four handover routes end to end.

Two assertions here matter more than the happy path:

  * Every way a token can fail must produce a byte-identical response. The public page is
    reachable by anyone holding a guess, and it must not tell them which part of the guess
    was wrong. The true reason is written to handover_token_attempts and read by nobody
    over HTTP.
  * The browser binding must hold. Confirming needs the URL token AND the cookie minted
    when that URL was first opened, so a forwarded link cannot confirm a delivery the
    person holding it never attended.
"""

import base64
import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Trip, TripStop
from app.db.session import get_db
from app.main import app
from app.storage.supabase_storage import UploadResult
from tests.conftest import auth_header, make_token

# A minimal but genuine PNG payload: the magic number the schema validates, plus filler.
# Not a real image — nothing in this path decodes pixels, only the signature bytes.
_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()

_CONFIRM_BODY = {
    "receiver_name": "Thandi Nkosi",
    "receiver_id_number": "9202204720082",
    "signature_png_base64": _PNG,
}


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    """Point the app at the test transaction, exactly as test_artifacts.py does."""
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def handover_trip(db_session, seed):
    """An active trip at its destination stop, with a PENDING confirmation phase event."""
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-HANDOVER",
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

    db_session.add(Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY-HANDOVER",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    ))
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


@pytest_asyncio.fixture
async def other_driver_auth(db_session, seed):
    """A REAL second driver, not a random uuid.

    A made-up subject fails in get_current_driver and never reaches the endpoint, which
    would make the test below pass for the wrong reason — it is the ownership check in
    _load_confirmation_event that has to produce the 404, not the absence of an account.
    """
    from app.db.models.people import Driver

    other = Driver(
        id=uuid.uuid4(), organization_id=seed["org"].id, full_name="Other Driver",
        id_number="9001015009087", phone_number="+27829999999", license_number="DRV-OTHER",
    )
    db_session.add(other)
    await db_session.flush()
    return auth_header(make_token(sub=str(other.id), role="driver"))


@pytest_asyncio.fixture(autouse=True)
def fake_storage(monkeypatch):
    """Every confirm writes an artifact. Storage is not what these tests are about."""
    async def fake_upload(*, trip_id, file_bytes, mime_type):
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}", file_hash="a" * 64,
        )

    monkeypatch.setattr("app.orchestration.artifact_service.upload_evidence_file", fake_upload)


async def _issue(client: AsyncClient, handover_trip, driver_auth, *, force: bool = False):
    trip, event = handover_trip["trip"], handover_trip["event"]
    query = "?force=true" if force else ""
    return await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens{query}", headers=driver_auth,
    )


def _token_from(issued) -> str:
    return issued.json()["scan_url"].rsplit("/", 1)[1]


# ── Driver-authenticated routes ────────────────────────────────────────────────


async def test_issue_requires_a_driver_token(client: AsyncClient, handover_trip):
    # 403, not 401: get_current_driver returns FORBIDDEN when the Authorization header is
    # absent entirely, and reserves 401 for a token that is present but unusable.
    trip, event = handover_trip["trip"], handover_trip["event"]

    res = await client.post(f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens")

    assert res.status_code == 403


async def test_issue_returns_a_scan_url_and_rotation_interval(client, handover_trip, driver_auth):
    res = await _issue(client, handover_trip, driver_auth)

    assert res.status_code == 201
    body = res.json()
    assert "/h/" in body["scan_url"]
    assert body["rotate_after_seconds"] == 20
    assert body["receiver_opened"] is False


async def test_another_drivers_trip_is_a_404_not_a_403(client, handover_trip, other_driver_auth):
    # A trip id read off dispatch chatter must be indistinguishable from one that does not
    # exist — the NEW-12 reasoning from the Stage 3 phase-refactor plan. A 403 here would
    # confirm the trip is real, which is exactly what must not leak.
    trip, event = handover_trip["trip"], handover_trip["event"]

    res = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=other_driver_auth,
    )

    assert res.status_code == 404


async def test_status_is_unconfirmed_before_any_scan(client, handover_trip, driver_auth):
    trip, event = handover_trip["trip"], handover_trip["event"]

    res = await client.get(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover", headers=driver_auth,
    )

    assert res.status_code == 200
    assert res.json() == {
        "confirmed": False, "confirmed_at": None,
        "receiver_opened": False, "signature_artifact_id": None,
    }


# ── Public routes ──────────────────────────────────────────────────────────────


async def test_scan_shows_the_delivery_without_redeeming_it(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))

    first = await client.get(f"/api/v1/handover/{token}")
    second = await client.get(f"/api/v1/handover/{token}")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["trip_reference"] == handover_trip["trip"].trip_reference
    assert first.json()["waybill_references"] == ["WAY-HANDOVER"]


async def test_scan_reveals_nothing_about_the_driver(client, handover_trip, driver_auth):
    # POPIA and blast radius: a stranger holding a token learns which delivery they are
    # confirming and nothing else.
    token = _token_from(await _issue(client, handover_trip, driver_auth))

    body = (await client.get(f"/api/v1/handover/{token}")).json()

    assert set(body) == {"trip_reference", "destination_name", "waybill_references", "expires_at"}


async def test_the_first_scan_sets_a_binding_cookie_and_later_ones_do_not(
    client, handover_trip, driver_auth,
):
    token = _token_from(await _issue(client, handover_trip, driver_auth))

    first = await client.get(f"/api/v1/handover/{token}")
    second = await client.get(f"/api/v1/handover/{token}")

    assert "fp_handover_session" in first.cookies
    assert "fp_handover_session" not in second.cookies


async def test_every_bad_token_returns_an_identical_404(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")
    await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    unknown = await client.get(f"/api/v1/handover/{'a' * 43}")
    already_redeemed = await client.get(f"/api/v1/handover/{token}")

    assert unknown.status_code == already_redeemed.status_code == 404
    assert unknown.json() == already_redeemed.json()


async def test_confirm_creates_an_artifact_the_driver_can_submit(
    client, handover_trip, driver_auth,
):
    trip, event = handover_trip["trip"], handover_trip["event"]
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    confirmed = await client.post(
        f"/api/v1/handover/{token}/confirm",
        json={**_CONFIRM_BODY, "receiver_lat": "-33.9249", "receiver_lng": "18.4241"},
    )

    assert confirmed.status_code == 201
    status = await client.get(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover", headers=driver_auth,
    )
    assert status.json()["confirmed"] is True
    assert status.json()["signature_artifact_id"] is not None


async def test_confirming_without_the_binding_cookie_is_refused(
    client, handover_trip, driver_auth,
):
    # The anti-forwarding property. Someone who was sent the URL but never opened it in
    # this browser holds no cookie, and must not be able to confirm the delivery.
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")
    client.cookies.clear()

    res = await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    assert res.status_code == 404


async def test_a_refused_binding_does_not_burn_the_real_receivers_token(
    client, handover_trip, driver_auth,
):
    # A forwarded link must fail WITHOUT destroying the legitimate handover it was copied
    # from — which is why the binding is checked before the redemption gate.
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    scanned = await client.get(f"/api/v1/handover/{token}")
    real_cookie = scanned.cookies["fp_handover_session"]
    client.cookies.clear()
    await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    client.cookies.set("fp_handover_session", real_cookie)
    res = await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    assert res.status_code == 201


async def test_a_token_cannot_be_confirmed_twice(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    first = await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)
    second = await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    assert first.status_code == 201
    assert second.status_code == 404


async def test_a_malformed_signature_is_a_422(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    res = await client.post(f"/api/v1/handover/{token}/confirm", json={
        **_CONFIRM_BODY, "signature_png_base64": "not base64!!",
    })

    assert res.status_code == 422


async def test_a_non_png_signature_is_a_422(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    res = await client.post(f"/api/v1/handover/{token}/confirm", json={
        **_CONFIRM_BODY, "signature_png_base64": base64.b64encode(b"GIF89a" + b"\x00" * 32).decode(),
    })

    assert res.status_code == 422


# ── The rotation, through HTTP ─────────────────────────────────────────────────


async def test_issuing_again_retires_the_previous_code(client, handover_trip, driver_auth):
    stale = _token_from(await _issue(client, handover_trip, driver_auth))

    await _issue(client, handover_trip, driver_auth)

    assert (await client.get(f"/api/v1/handover/{stale}")).status_code == 404


async def test_the_rotation_pauses_once_the_receiver_opens_the_link(
    client, handover_trip, driver_auth,
):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    paused = await _issue(client, handover_trip, driver_auth)

    assert paused.json()["receiver_opened"] is True
    assert paused.json()["scan_url"] is None
    # And the receiver's code is still alive, which is the whole point of pausing.
    assert (await client.get(f"/api/v1/handover/{token}")).status_code == 200


async def test_forcing_a_new_code_retires_a_stranded_open_one(
    client, handover_trip, driver_auth,
):
    stranded = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{stranded}")

    forced = await _issue(client, handover_trip, driver_auth, force=True)

    assert forced.json()["scan_url"] is not None
    assert (await client.get(f"/api/v1/handover/{stranded}")).status_code == 404


async def test_issuing_after_confirmation_is_a_409(client, handover_trip, driver_auth):
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")
    await client.post(f"/api/v1/handover/{token}/confirm", json=_CONFIRM_BODY)

    res = await _issue(client, handover_trip, driver_auth)

    assert res.status_code == 409


async def test_the_status_route_reports_an_opened_but_unconfirmed_link(
    client, handover_trip, driver_auth,
):
    trip, event = handover_trip["trip"], handover_trip["event"]
    token = _token_from(await _issue(client, handover_trip, driver_auth))
    await client.get(f"/api/v1/handover/{token}")

    res = await client.get(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover", headers=driver_auth,
    )

    assert res.json()["receiver_opened"] is True
    assert res.json()["confirmed"] is False
