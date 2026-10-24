"""One-time email codes that stand between a share link and the pack it opens (FP-291).

An audit-pack link is a bearer token: before this, anyone a link was forwarded to could
read the trip's evidence. A pack issued to an email address now opens only for a browser
that entered a code sent to that address. The code is exchanged for a viewer grant the
browser keeps, so the recipient enters it once, not on every visit.

This is a verification code for one external recipient, not a notification channel: the
team decided against email alerts, and nothing else is ever sent from here.

Packs issued before FP-291 without an email address keep opening with the link alone:
they were shared on that promise and must not break in an insurer's hands.
"""

import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_packs import AuditPack, AuditPackEmailCode
from app.integrations.sendgrid import send_plain_text_email
from app.orchestration.audit_packs.lifecycle import hash_token

logger = logging.getLogger(__name__)

CODE_DIGITS = 6
# Long enough to switch to a mail app and back on a slow connection; short enough that
# an inbox read later (a shared mailbox, a compromised account) finds a dead code.
CODE_TTL = timedelta(minutes=10)
# Six digits is 1 in a million per guess; five guesses per code and five codes an hour
# keeps an attacker holding the link far from that, while a recipient's typo costs nothing.
MAX_FAILED_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_CODES_PER_HOUR = 5
_HOUR = timedelta(hours=1)
# The grant is a second bearer secret, sized like the share token itself.
GRANT_BYTES = 32

_EMAIL_SUBJECT = "Your FreightProof access code"


class EmailCodeNotRequired(Exception):
    """The pack has no recipient email (issued before FP-291), so it opens without a code."""


class EmailCodeRequestTooSoon(Exception):
    """Another code was sent too recently, or too many were sent this hour."""

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("A code was sent too recently")
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class CodeCheck:
    """Outcome of one code entry. Returned, not raised, so the caller can log a failure
    and still commit: get_db rolls back on an exception, which would erase the very
    attempt count that stops guessing."""

    outcome: Literal["verified", "wrong", "expired", "locked"]
    grant: str | None = None
    grant_expires_at: datetime | None = None


def requires_email_code(pack: AuditPack) -> bool:
    return pack.recipient_email is not None


def mask_email(address: str) -> str:
    """Enough for the recipient to recognise which inbox to check (j***@santam.co.za),
    not enough to hand a stranger holding the link a full address."""
    local, _, domain = address.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def hash_code(pack_id: uuid.UUID, code: str) -> str:
    # Salted with the pack id: a six-digit space is tiny, and one precomputed table
    # must not cover every pack at once.
    return hash_token(f"{pack_id}:{code}")


def _new_code() -> str:
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def _email_body(code: str, label: str) -> str:
    # Code and pack label only — the body passes through SendGrid outside South Africa
    # (POPIA), so nothing about the trip, cargo, driver or incident goes in it.
    minutes = int(CODE_TTL.total_seconds() // 60)
    return (
        f"Your code to open FreightProof audit pack {label} is:\n\n"
        f"    {code}\n\n"
        f"It expires in {minutes} minutes and works once.\n\n"
        "If you did not ask for this code, you can ignore this email. Without it the "
        "pack stays closed.\n"
    )


async def _latest_code(db: AsyncSession, pack: AuditPack, *, lock: bool = False) -> AuditPackEmailCode | None:
    query = (
        select(AuditPackEmailCode)
        .where(AuditPackEmailCode.audit_pack_id == pack.id)
        .order_by(AuditPackEmailCode.created_at.desc(), AuditPackEmailCode.id.desc())
        .limit(1)
    )
    if lock:
        # Two tabs submitting at once must not both spend the same attempt allowance.
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def send_email_code(db: AsyncSession, pack: AuditPack, *, label: str, now: datetime) -> None:
    """Create a fresh code for the pack and email it to the recipient.

    Every earlier code for the pack stops working: only the newest is ever checked. Raises
    EmailCodeNotRequired for a pack with no email, EmailCodeRequestTooSoon inside the
    cooldown or over the hourly cap, and EmailUnavailableError when SendGrid cannot take
    the message (the new row is rolled back with the request, so no unsent code is live).
    """
    if pack.recipient_email is None:
        raise EmailCodeNotRequired()

    latest = await _latest_code(db, pack)
    if latest is not None and latest.created_at > now - RESEND_COOLDOWN:
        wait = latest.created_at + RESEND_COOLDOWN - now
        raise EmailCodeRequestTooSoon(max(1, int(wait.total_seconds())))

    sent_this_hour = (await db.execute(
        select(func.count()).select_from(AuditPackEmailCode).where(
            AuditPackEmailCode.audit_pack_id == pack.id,
            AuditPackEmailCode.created_at > now - _HOUR,
        )
    )).scalar_one()
    if sent_this_hour >= MAX_CODES_PER_HOUR:
        raise EmailCodeRequestTooSoon(int(_HOUR.total_seconds()))

    code = _new_code()
    db.add(AuditPackEmailCode(
        id=uuid.uuid4(), audit_pack_id=pack.id, code_hash=hash_code(pack.id, code),
        code_expires_at=now + CODE_TTL, failed_attempts=0,
        # Set explicitly, not left to the server default: the cooldown compares against
        # `now`, and a test or a clock-skewed caller must see the same instant.
        created_at=now, updated_at=now,
    ))
    await db.flush()
    await send_plain_text_email(to_address=pack.recipient_email, subject=_EMAIL_SUBJECT, body=_email_body(code, label))


async def check_email_code(db: AsyncSession, pack: AuditPack, *, code: str, now: datetime) -> CodeCheck:
    """Check an entered code against the pack's newest one; on a match, issue a grant.

    The grant lasts as long as the share link itself: revoking or expiring the link
    already closes it (the link is checked before the grant on every request), so a
    shorter grant would only make the recipient re-enter codes for no added protection.
    """
    row = await _latest_code(db, pack, lock=True)
    if row is None or row.verified_at is not None or row.code_expires_at <= now:
        return CodeCheck(outcome="expired")
    if row.failed_attempts >= MAX_FAILED_ATTEMPTS:
        return CodeCheck(outcome="locked")

    # Constant-time: the comparison must not leak how many leading characters matched.
    if not hmac.compare_digest(row.code_hash, hash_code(pack.id, code)):
        row.failed_attempts += 1
        await db.flush()
        return CodeCheck(outcome="locked" if row.failed_attempts >= MAX_FAILED_ATTEMPTS else "wrong")

    grant = secrets.token_urlsafe(GRANT_BYTES)
    row.verified_at = now
    row.grant_hash = hash_token(grant)
    row.grant_expires_at = pack.expires_at
    await db.flush()
    return CodeCheck(outcome="verified", grant=grant, grant_expires_at=pack.expires_at)


async def grant_is_valid(db: AsyncSession, pack: AuditPack, *, raw_grant: str | None, now: datetime) -> bool:
    if not raw_grant:
        return False
    row = (await db.execute(
        select(AuditPackEmailCode.grant_expires_at).where(
            AuditPackEmailCode.audit_pack_id == pack.id,
            AuditPackEmailCode.grant_hash == hash_token(raw_grant),
        )
    )).scalar_one_or_none()
    return row is not None and row > now
