"""FP-291: a pack issued to an email address mails the link and a password the moment it
is issued; opening the link needs a viewer grant earned by entering that password.

SendGrid is replaced by a recorder, so every test can read the password the recipient
would have received. No auth header is ever sent on the public routes below: these are
the zero-login public routes.
"""

import hashlib
import re
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_packs import AuditPackAccessEvent, AuditPackGrant
from app.db.session import get_db
from app.main import app
from app.orchestration.audit_packs import access, lifecycle, viewer_password
from app.orchestration.audit_packs.lifecycle import IssuedPack, issue_audit_pack, revoke_audit_pack
from app.orchestration.audit_packs.viewer_password import LOCKOUT_WINDOW, MAX_FAILED_ATTEMPTS
from app.schemas.audit_pack import AuditPackCreate
from app.schemas.people import UserRead
from app.storage.supabase_storage import UploadResult

from tests.integration.audit_pack_seed import AuditTrip, seed_audit_trip

# Renders no real PDF unless a test is marked real_pdf (see fake_pdf_renderer in conftest.py).
pytestmark = pytest.mark.usefixtures("fake_pdf_renderer")

PUBLIC = "/api/v1/public/audit-packs"
GRANT_HEADER = "X-Audit-Pack-Grant"
RECIPIENT = "jane@santam.example"


@dataclass(frozen=True)
class SentEmail:
    to_address: str
    subject: str
    body: str

    @property
    def password(self) -> str:
        match = re.search(r"Password to open it:\n\n {4}(\S+)\n\n", self.body)
        assert match is not None, "no password in the issue email"
        return match.group(1)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    store: dict[str, bytes] = {}

    async def fake_upload(*, trip_id: str, pack_id: str, pdf_bytes: bytes) -> UploadResult:
        key = f"audit-packs/{trip_id}/{pack_id}.pdf"
        store[key] = pdf_bytes
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=key, file_hash=hashlib.sha256(pdf_bytes).hexdigest())

    async def fake_download(*, s3_bucket: str, s3_key: str) -> bytes:
        return store[s3_key]

    monkeypatch.setattr(lifecycle, "upload_audit_pack_pdf", fake_upload)
    monkeypatch.setattr(access, "download_audit_pack_pdf", fake_download)
    return store


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[SentEmail]:
    sent: list[SentEmail] = []

    async def fake_send(*, to_address: str, subject: str, body: str) -> None:
        sent.append(SentEmail(to_address=to_address, subject=subject, body=body))

    monkeypatch.setattr(viewer_password, "send_plain_text_email", fake_send)
    return sent


async def _issue(db: AsyncSession, seed: AuditTrip, outbox: list[SentEmail]) -> IssuedPack:
    """Issuing mails the link and password automatically; outbox must be active for this
    to succeed without the fail-open path swallowing it."""
    request = AuditPackCreate.model_validate({
        "recipient_name": "Jane Adjuster", "recipient_organization": "Santam Claims",
        "recipient_email": RECIPIENT, "purpose": "insurance_claim",
    })
    return await issue_audit_pack(
        db, trip_id=seed.trip.id, issued_by=UserRead.model_validate(seed.dispatcher), request=request,
    )


async def _events(db: AsyncSession) -> list[str]:
    # Sorted, not in insertion order: one test is one transaction, where now() is the same
    # instant for every row, so created_at cannot order them.
    rows = (await db.execute(select(AuditPackAccessEvent.event_type))).scalars().all()
    return sorted(str(getattr(r, "value", r)) for r in rows)


async def _grants(db: AsyncSession, issued: IssuedPack) -> list[AuditPackGrant]:
    return list((await db.execute(
        select(AuditPackGrant).where(AuditPackGrant.audit_pack_id == issued.pack.id)
    )).scalars().all())


async def _grant(client: AsyncClient, issued: IssuedPack) -> str:
    assert issued.raw_password is not None
    verified = await client.post(
        f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": issued.raw_password},
    )
    assert verified.status_code == 200, verified.text
    return verified.json()["grant"]


# ── Issuing mails the password ────────────────────────────────────────────────────────


async def test_issuing_mails_the_link_and_password_and_logs_it(db_session, audit_trip, storage, outbox):
    # Act
    issued = await _issue(db_session, audit_trip, outbox)

    # Assert
    assert len(outbox) == 1
    assert outbox[0].to_address == RECIPIENT
    assert "FP-AUDIT-AP1" in outbox[0].body
    assert lifecycle.share_url(issued.raw_token) in outbox[0].body
    assert issued.raw_password == outbox[0].password
    assert issued.pack.password_hash is not None
    assert outbox[0].password not in issued.pack.password_hash, "the raw password must never be stored"
    assert await _events(db_session) == ["password_emailed"]


async def test_issue_email_carries_no_trip_details(db_session, audit_trip, storage, outbox):
    """The body goes through SendGrid outside South Africa (POPIA): link, password and
    label only — the share link is meant to be there, but nothing about the trip, cargo
    or who is involved."""
    # Act
    await _issue(db_session, audit_trip, outbox)

    # Assert
    body = outbox[0].body
    for private in ("Jane Adjuster", "Santam Claims", str(audit_trip.trip.id)):
        assert private not in body


async def test_sendgrid_outage_at_issue_does_not_block_issuing(db_session, audit_trip, storage, monkeypatch):
    """Fail-open like the Hedera seal: issuing must not hinge on a third party being up."""
    # Arrange
    async def fake_send(*, to_address: str, subject: str, body: str) -> None:
        from app.core.exceptions import EmailUnavailableError
        raise EmailUnavailableError("SendGrid is down")

    monkeypatch.setattr(viewer_password, "send_plain_text_email", fake_send)

    # Act
    issued = await _issue(db_session, audit_trip, [])

    # Assert: still issued, with a password the dispatcher can still hand over
    assert issued.pack.id is not None
    assert issued.raw_password is not None
    assert await _events(db_session) == []  # not logged: the send never succeeded


# ── The gate ─────────────────────────────────────────────────────────────────────────


async def test_open_emailed_pack_without_grant_is_401_and_logged(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 401
    body = response.json()
    assert body["verification_required"] is True
    assert body["email_hint"] == "j***@santam.example"
    assert "manifest" not in body
    assert await _events(db_session) == sorted(["password_emailed", "denied_unverified"])


@pytest.mark.parametrize("method,suffix", [
    ("GET", "/pdf"),
    ("GET", "/incident-sheet.pdf"),
    ("GET", f"/artifacts/{uuid.uuid4()}"),
    ("POST", "/verify"),
], ids=["pdf", "incident-sheet", "artifact", "verify"])
async def test_every_pack_route_needs_a_grant(client, db_session, audit_trip, storage, outbox, method, suffix):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.request(method, f"{PUBLIC}/{issued.raw_token}{suffix}")

    # Assert
    assert response.status_code == 401
    assert response.json()["verification_required"] is True


async def test_seal_check_stays_open_without_a_grant(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.get(f"{PUBLIC}/seal/{issued.pack.id}")

    # Assert
    assert response.status_code == 200


async def test_open_emailed_pack_with_grant_succeeds(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    grant = await _grant(client, issued)

    # Act
    view = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: grant})
    pdf = await client.get(f"{PUBLIC}/{issued.raw_token}/pdf", headers={GRANT_HEADER: grant})

    # Assert
    assert view.status_code == 200
    assert view.json()["manifest"]["trip"]["trip_reference"] == "FP-AUDIT"
    assert pdf.status_code == 200
    assert await _events(db_session) == sorted(["password_emailed", "password_verified", "viewed", "pdf_downloaded"])


async def test_password_is_reusable_across_devices(client, db_session, audit_trip, storage, outbox):
    """Unlike the old one-time code, the same password earns a second, independent grant."""
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    first_grant = await _grant(client, issued)

    # Act: a second "device" enters the same password
    second = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": outbox[0].password})

    # Assert
    assert second.status_code == 200
    second_grant = second.json()["grant"]
    assert second_grant != first_grant
    assert len(await _grants(db_session, issued)) == 2
    both_open = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: first_grant})
    assert both_open.status_code == 200


async def test_grant_for_one_pack_does_not_open_another(client, db_session, audit_trip, storage, outbox):
    # Arrange
    first = await _issue(db_session, audit_trip, outbox)
    second = await _issue(db_session, audit_trip, outbox)
    grant = await _grant(client, first)

    # Act
    response = await client.get(f"{PUBLIC}/{second.raw_token}", headers={GRANT_HEADER: grant})

    # Assert
    assert response.status_code == 401


async def test_made_up_grant_is_401(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: "not-a-grant"})

    # Assert
    assert response.status_code == 401


async def test_revoking_the_link_shuts_out_an_earned_grant(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    grant = await _grant(client, issued)
    await revoke_audit_pack(
        db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id, user_id=audit_trip.dispatcher.id,
    )

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: grant})

    # Assert
    assert response.status_code == 410


async def test_pack_without_email_opens_with_link_alone(client, db_session, audit_trip, storage, outbox):
    """Packs issued before this existed were shared on that promise; they must keep working."""
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    issued.pack.recipient_email = None
    await db_session.flush()

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 200


async def test_pack_emailed_before_passwords_opens_with_link_alone(client, db_session, audit_trip, storage, outbox):
    """A pack issued to an email under the old one-time-code flow has no password to enter."""
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    issued.pack.password_hash = None
    await db_session.flush()

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 200
    assert issued.pack.recipient_email == RECIPIENT


# ── Entering the password ───────────────────────────────────────────────────────────


async def test_verify_right_password_returns_grant_until_link_expiry(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": outbox[0].password})

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert len(body["grant"]) >= 40
    assert datetime.fromisoformat(body["expires_at"]) == issued.pack.expires_at
    [row] = await _grants(db_session, issued)
    assert body["grant"] not in row.grant_hash


async def test_verify_wrong_password_is_400_and_counted(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": "not-it"})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "wrong"
    await db_session.refresh(issued.pack)
    assert issued.pack.password_failed_attempts == 1
    assert await _events(db_session) == sorted(["password_emailed", "denied_bad_password"])


async def test_password_locks_after_too_many_wrong_guesses(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    right = outbox[0].password
    for _ in range(MAX_FAILED_ATTEMPTS):
        await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": "not-it"})

    # Act: even the right password is refused once locked
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": right})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "locked"


async def test_lockout_clears_after_the_window_passes(client, db_session, audit_trip, storage, outbox):
    """Unlike the old dead-end code, a lockout is temporary: there is no 'ask for a new
    one' recovery path for a password mailed only once."""
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    right = outbox[0].password
    for _ in range(MAX_FAILED_ATTEMPTS):
        await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": "not-it"})
    await db_session.refresh(issued.pack)
    assert issued.pack.password_locked_until is not None
    issued.pack.password_locked_until -= LOCKOUT_WINDOW + timedelta(seconds=1)
    await db_session.flush()

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": right})

    # Assert
    assert response.status_code == 200


async def test_password_works_more_than_once(client, db_session, audit_trip, storage, outbox):
    """The whole point of a persistent password: unlike the old one-time code, entering
    it again later still works."""
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    await _grant(client, issued)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": outbox[0].password})

    # Assert
    assert response.status_code == 200


async def test_verify_on_pack_without_password_is_400_not_500(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    issued.pack.password_hash = None
    await db_session.flush()

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": "anything-at-all"})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "wrong"


async def test_verify_unknown_token_is_404(client, db_session, audit_trip, storage, outbox):
    # Act
    response = await client.post(f"{PUBLIC}/not-a-real-token/password/verify", json={"password": "anything"})

    # Assert
    assert response.status_code == 404


async def test_verify_on_revoked_link_is_410(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)
    await revoke_audit_pack(
        db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id, user_id=audit_trip.dispatcher.id,
    )

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": outbox[0].password})

    # Assert
    assert response.status_code == 410


@pytest.mark.parametrize("password", ["", "x" * 129])
async def test_verify_malformed_password_is_422(client, db_session, audit_trip, storage, outbox, password):
    # Arrange
    issued = await _issue(db_session, audit_trip, outbox)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/password/verify", json={"password": password})

    # Assert
    assert response.status_code == 422
