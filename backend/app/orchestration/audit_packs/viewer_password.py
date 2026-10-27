"""The password that stands between a share link and the pack it opens (FP-291).

An audit-pack link is a bearer token: before this, anyone a link was forwarded to could
read the trip's evidence. A pack issued to an email address gets a password at the same
time, mailed once to that address alongside the link. Entering it exchanges it for a
viewer grant the browser keeps, so the recipient enters it once per device, not on every
visit.

The password is reusable and does not expire on its own: it lives as long as the pack
does (revoked or expired closes it same as the link). There is no "send me another one"
step, so a wrong-guess lockout is temporary, not a dead end.

Packs issued before this existed, without an email address, keep opening with the link
alone: they were shared on that promise and must not break in an insurer's hands.
"""

import hashlib
import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_packs import AuditPack, AuditPackGrant
from app.integrations.sendgrid import send_plain_text_email

logger = logging.getLogger(__name__)

PASSWORD_BYTES = 12
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_WINDOW = timedelta(minutes=15)
GRANT_BYTES = 32

_EMAIL_SUBJECT = "Your FreightProof audit pack"


@dataclass(frozen=True)
class PasswordCheck:
    """Outcome of one password entry. Returned, not raised, so the caller can log a
    failure and still commit: get_db rolls back on an exception, which would erase the
    very attempt count that stops guessing."""

    outcome: Literal["verified", "wrong", "locked"]
    grant: str | None = None
    grant_expires_at: datetime | None = None


def requires_viewer_password(pack: AuditPack) -> bool:
    return pack.recipient_email is not None and pack.password_hash is not None


def mask_email(address: str) -> str:
    """Enough for the recipient to recognise which inbox to check (j***@santam.co.za),
    not enough to hand a stranger holding the link a full address."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def hash_password(pack_id: uuid.UUID, password: str) -> str:
    return hash_token(f"{pack_id}:{password}")


def generate_password() -> str:
    return secrets.token_urlsafe(PASSWORD_BYTES)


def issue_email_body(*, password: str, label: str, share_url: str, expires_at: datetime) -> str:
    return (
        f"FreightProof audit pack {label} has been shared with you:\n\n"
        f"    {share_url}\n\n"
        f"Password to open it:\n\n"
        f"    {password}\n\n"
        f"This password stays valid until the pack is revoked or expires on "
        f"{expires_at.date().isoformat()}. Keep it private — anyone with the link and this "
        "password can view the pack.\n"
    )


async def send_issue_email(
    pack: AuditPack, *, label: str, share_url: str, raw_password: str,
) -> None:
    """Email the share link and password to the pack's recipient, once, at issue.

    Raises EmailUnavailableError when SendGrid cannot take the message. Callers should
    treat that as fail-open (the pack is still issued, same as a Hedera outage): the
    dispatcher can still hand the link and the issue response's password to the recipient
    another way.
    """
    assert pack.recipient_email is not None
    await send_plain_text_email(
        to_address=pack.recipient_email, subject=_EMAIL_SUBJECT,
        body=issue_email_body(password=raw_password, label=label, share_url=share_url, expires_at=pack.expires_at),
    )


async def verify_password(db: AsyncSession, pack: AuditPack, *, password: str, now: datetime) -> PasswordCheck:
    """Check an entered password against the pack's; on a match, issue a fresh grant.

    The grant lasts as long as the share link itself: revoking or expiring the link
    already closes it (the link is checked before the grant on every request), so a
    shorter grant would only make the recipient re-enter the password for no added
    protection.
    """
    if pack.password_hash is None:
        return PasswordCheck(outcome="wrong")

    if pack.password_locked_until is not None:
        if pack.password_locked_until > now:
            return PasswordCheck(outcome="locked")
        pack.password_failed_attempts = 0
        pack.password_locked_until = None

    if not hmac.compare_digest(pack.password_hash, hash_password(pack.id, password)):
        pack.password_failed_attempts += 1
        if pack.password_failed_attempts >= MAX_FAILED_ATTEMPTS:
            pack.password_locked_until = now + LOCKOUT_WINDOW
            await db.flush()
            return PasswordCheck(outcome="locked")
        await db.flush()
        return PasswordCheck(outcome="wrong")

    pack.password_failed_attempts = 0
    pack.password_locked_until = None
    grant = secrets.token_urlsafe(GRANT_BYTES)
    db.add(AuditPackGrant(
        id=uuid.uuid4(), audit_pack_id=pack.id, grant_hash=hash_token(grant), expires_at=pack.expires_at,
    ))
    await db.flush()
    return PasswordCheck(outcome="verified", grant=grant, grant_expires_at=pack.expires_at)


async def grant_is_valid(db: AsyncSession, pack: AuditPack, *, raw_grant: str | None, now: datetime) -> bool:
    if not raw_grant:
        return False
    row = (await db.execute(
        select(AuditPackGrant.expires_at).where(
            AuditPackGrant.audit_pack_id == pack.id,
            AuditPackGrant.grant_hash == hash_token(raw_grant),
            AuditPackGrant.expires_at > now,
        ).limit(1)
    )).scalar_one_or_none()
    return row is not None
