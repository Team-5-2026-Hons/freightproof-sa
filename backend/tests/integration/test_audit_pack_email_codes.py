"""FP-291: a pack issued to an email address opens only after a code sent there is entered.

SendGrid is replaced by a recorder, so every test can read the code the recipient would
have received. No auth header is ever sent: these are the zero-login public routes.
"""

import hashlib
import re
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.audit_packs import AuditPackAccessEvent, AuditPackEmailCode
from app.db.session import get_db
from app.main import app
from app.orchestration.audit_packs import access, email_codes, lifecycle
from app.orchestration.audit_packs.email_codes import MAX_CODES_PER_HOUR, MAX_FAILED_ATTEMPTS, send_email_code
from app.orchestration.audit_packs.lifecycle import IssuedPack, issue_audit_pack, revoke_audit_pack
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
    def code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.body)
        assert match is not None, "no six-digit code in the email"
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

    monkeypatch.setattr(email_codes, "send_plain_text_email", fake_send)
    return sent


async def _issue(db: AsyncSession, seed: AuditTrip) -> IssuedPack:
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


async def _code_rows(db: AsyncSession, issued: IssuedPack) -> list[AuditPackEmailCode]:
    return list((await db.execute(
        select(AuditPackEmailCode).where(AuditPackEmailCode.audit_pack_id == issued.pack.id)
    )).scalars().all())


async def _backdate_codes(db: AsyncSession, issued: IssuedPack, by: timedelta) -> None:
    """Move every code for the pack into the past, as if the recipient came back later."""
    for row in await _code_rows(db, issued):
        row.created_at -= by
        row.code_expires_at -= by
    await db.flush()


async def _grant(client: AsyncClient, issued: IssuedPack, outbox: list[SentEmail]) -> str:
    sent = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    assert sent.status_code == 202, sent.text
    verified = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": outbox[-1].code})
    assert verified.status_code == 200, verified.text
    return verified.json()["grant"]


# ── The gate ─────────────────────────────────────────────────────────────────────────


async def test_open_emailed_pack_without_grant_is_401_and_logged(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 401
    body = response.json()
    assert body["verification_required"] is True
    assert body["email_hint"] == "j***@santam.example"
    assert "manifest" not in body
    assert await _events(db_session) == ["denied_unverified"]


# Explicit ids: the artifact case's path holds a fresh uuid4, and a parallel run (pytest -n)
# refuses test names that differ between workers.
@pytest.mark.parametrize("method,suffix", [
    ("GET", "/pdf"),
    ("GET", "/incident-sheet.pdf"),
    ("GET", f"/artifacts/{uuid.uuid4()}"),
    ("POST", "/verify"),
], ids=["pdf", "incident-sheet", "artifact", "verify"])
async def test_every_pack_route_needs_a_grant(client, db_session, audit_trip, storage, method, suffix):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.request(method, f"{PUBLIC}/{issued.raw_token}{suffix}")

    # Assert
    assert response.status_code == 401
    assert response.json()["verification_required"] is True


async def test_seal_check_stays_open_without_a_grant(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/seal/{issued.pack.id}")

    # Assert
    assert response.status_code == 200


async def test_open_emailed_pack_with_grant_succeeds(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    grant = await _grant(client, issued, outbox)

    # Act
    view = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: grant})
    pdf = await client.get(f"{PUBLIC}/{issued.raw_token}/pdf", headers={GRANT_HEADER: grant})

    # Assert
    assert view.status_code == 200
    assert view.json()["manifest"]["trip"]["trip_reference"] == "FP-AUDIT"
    assert pdf.status_code == 200
    assert await _events(db_session) == sorted(["code_sent", "code_verified", "viewed", "pdf_downloaded"])


async def test_grant_for_one_pack_does_not_open_another(client, db_session, audit_trip, storage, outbox):
    # Arrange
    first = await _issue(db_session, audit_trip)
    second = await _issue(db_session, audit_trip)
    grant = await _grant(client, first, outbox)

    # Act
    response = await client.get(f"{PUBLIC}/{second.raw_token}", headers={GRANT_HEADER: grant})

    # Assert
    assert response.status_code == 401


async def test_made_up_grant_is_401(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: "not-a-grant"})

    # Assert
    assert response.status_code == 401


async def test_revoking_the_link_shuts_out_an_earned_grant(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    grant = await _grant(client, issued, outbox)
    await revoke_audit_pack(
        db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id, user_id=audit_trip.dispatcher.id,
    )

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}", headers={GRANT_HEADER: grant})

    # Assert
    assert response.status_code == 410


async def test_pack_without_email_opens_with_link_alone(client, db_session, audit_trip, storage):
    """Packs issued before FP-291 were shared on that promise; they must keep working."""
    # Arrange
    issued = await _issue(db_session, audit_trip)
    issued.pack.recipient_email = None
    await db_session.flush()

    # Act
    response = await client.get(f"{PUBLIC}/{issued.raw_token}")

    # Assert
    assert response.status_code == 200


# ── Sending a code ───────────────────────────────────────────────────────────────────


async def test_request_code_emails_the_recipient_and_logs_it(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    assert response.status_code == 202
    assert response.json() == {"email_hint": "j***@santam.example"}
    assert len(outbox) == 1
    assert outbox[0].to_address == RECIPIENT
    assert "FP-AUDIT-AP1" in outbox[0].body
    rows = await _code_rows(db_session, issued)
    assert len(rows) == 1
    assert outbox[0].code not in rows[0].code_hash, "the raw code must never be stored"
    assert await _events(db_session) == ["code_sent"]


async def test_code_email_carries_no_trip_details(client, db_session, audit_trip, storage, outbox):
    """The body goes through SendGrid outside South Africa (POPIA): code and label only."""
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    body = outbox[0].body
    for private in ("Jane Adjuster", "Santam Claims", str(audit_trip.trip.id), issued.raw_token):
        assert private not in body


async def test_request_code_again_within_cooldown_is_429(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0
    assert len(outbox) == 1


async def test_hourly_cap_on_codes(db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    start = datetime.now(UTC)
    for minute in range(MAX_CODES_PER_HOUR):
        await send_email_code(db_session, issued.pack, label="L", now=start + timedelta(minutes=2 * minute))

    # Act / Assert
    with pytest.raises(email_codes.EmailCodeRequestTooSoon):
        await send_email_code(db_session, issued.pack, label="L", now=start + timedelta(minutes=2 * MAX_CODES_PER_HOUR))
    assert len(outbox) == MAX_CODES_PER_HOUR


async def test_request_code_without_sendgrid_key_is_503(client, db_session, audit_trip, storage, monkeypatch):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    monkeypatch.setattr(settings, "SENDGRID_API_KEY", "")

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    assert response.status_code == 503
    assert "code_sent" not in await _events(db_session)


async def test_request_code_for_pack_without_email_is_409(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    issued.pack.recipient_email = None
    await db_session.flush()

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    assert response.status_code == 409
    assert outbox == []


async def test_request_code_unknown_token_is_404(client, db_session, audit_trip, storage, outbox):
    # Act
    response = await client.post(f"{PUBLIC}/not-a-real-token/email-code")

    # Assert
    assert response.status_code == 404
    assert outbox == []


async def test_request_code_on_revoked_link_is_410(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await revoke_audit_pack(
        db_session, pack_id=issued.pack.id, organization_id=audit_trip.org.id, user_id=audit_trip.dispatcher.id,
    )

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Assert
    assert response.status_code == 410
    assert outbox == []


# ── Entering a code ──────────────────────────────────────────────────────────────────


async def test_verify_right_code_returns_grant_until_link_expiry(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": outbox[0].code})

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert len(body["grant"]) >= 40
    assert datetime.fromisoformat(body["expires_at"]) == issued.pack.expires_at
    row = (await _code_rows(db_session, issued))[0]
    assert row.verified_at is not None
    assert row.grant_hash is not None and body["grant"] not in row.grant_hash


async def test_verify_wrong_code_is_400_and_counted(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    wrong = "000000" if outbox[0].code != "000000" else "111111"

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": wrong})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "wrong"
    assert (await _code_rows(db_session, issued))[0].failed_attempts == 1
    assert await _events(db_session) == sorted(["code_sent", "denied_bad_code"])


async def test_code_locks_after_too_many_wrong_guesses(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    right = outbox[0].code
    wrong = "000000" if right != "000000" else "111111"
    for _ in range(MAX_FAILED_ATTEMPTS):
        await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": wrong})

    # Act: even the right code is refused once the code is locked
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": right})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "locked"


async def test_expired_code_is_refused(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    await _backdate_codes(db_session, issued, email_codes.CODE_TTL + timedelta(seconds=1))

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": outbox[0].code})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "expired"


async def test_code_works_only_once(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await _grant(client, issued, outbox)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": outbox[0].code})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "expired"


async def test_new_code_replaces_the_old_one(client, db_session, audit_trip, storage, outbox):
    # Arrange
    issued = await _issue(db_session, audit_trip)
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    await _backdate_codes(db_session, issued, email_codes.RESEND_COOLDOWN + timedelta(seconds=1))
    await client.post(f"{PUBLIC}/{issued.raw_token}/email-code")
    first, second = outbox[0].code, outbox[1].code

    # Act
    old = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": first})
    new = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": second})

    # Assert
    assert old.status_code == 400 or first == second
    assert new.status_code == 200


async def test_verify_before_any_code_was_sent_is_400(client, db_session, audit_trip, storage):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": "123456"})

    # Assert
    assert response.status_code == 400
    assert response.json()["reason"] == "expired"


@pytest.mark.parametrize("code", ["12345", "1234567", "abcdef", ""])
async def test_verify_malformed_code_is_422(client, db_session, audit_trip, storage, code):
    # Arrange
    issued = await _issue(db_session, audit_trip)

    # Act
    response = await client.post(f"{PUBLIC}/{issued.raw_token}/email-code/verify", json={"code": code})

    # Assert
    assert response.status_code == 422
