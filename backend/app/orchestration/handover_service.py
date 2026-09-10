"""Receiver QR handover (FP-155) — issuing and redeeming capability tokens.

FP-236 scope only: the token primitive. What issues the rotating on-screen series
sharing one grant (FP-237), renders the QR (FP-238), exposes the public scan page
(FP-239) and reads same-device evidence (FP-240) all call into this module rather
than reimplementing the redemption gate.

Layering: orchestration -> db only, per CLAUDE.md. No caller-specific concerns
(HTTP status codes, rate limiting, session comparison) belong here.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Optional

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.db.models.enums import HandoverTokenRejectionReason
from app.db.models.handover import HandoverCapabilityToken, HandoverTokenAttempt

# 32 random bytes (256 bits) base64url-encoded — far beyond brute-force range for a
# token that lives at most HANDOVER_TOKEN_EXPIRY_MINUTES. Never derived from trip,
# stop, or timestamp data: the ticket is explicit that a sequential or derivable
# value defeats the whole mechanism.
_TOKEN_BYTES = 32


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class HandoverRedemptionResult:
    """Outcome of one redemption attempt.

    `reason` is None exactly when `success` is True. Callers building a public-facing
    response (FP-239) must not surface `reason` verbatim — the ticket requires
    EXPIRED, UNKNOWN and ALREADY_REDEEMED to look identical to the caller so the scan
    page cannot be used as an oracle; the true reason is what got written to
    HandoverTokenAttempt, not what the receiver's browser is told.
    """

    success: bool
    reason: Optional[HandoverTokenRejectionReason]
    token_id: Optional[uuid.UUID]


async def issue_capability_token(
    db: AsyncSession,
    *,
    phase_event_id: uuid.UUID,
    trip_id: uuid.UUID,
    trip_stop_id: uuid.UUID,
) -> tuple[str, HandoverCapabilityToken]:
    """Create a new single-use grant. Returns the raw token exactly once — it is
    never recoverable from the row afterward, only re-issuable as a fresh grant.
    """
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = datetime.now(UTC)

    token = HandoverCapabilityToken(
        id=uuid.uuid4(),
        phase_event_id=phase_event_id,
        trip_id=trip_id,
        trip_stop_id=trip_stop_id,
        token_hash=_hash_token(raw_token),
        expires_at=now + timedelta(minutes=settings.HANDOVER_TOKEN_EXPIRY_MINUTES),
    )
    db.add(token)
    await db.flush()

    return raw_token, token


async def _log_attempt(
    db: AsyncSession,
    *,
    token_id: Optional[uuid.UUID],
    presented_trip_id: uuid.UUID,
    presented_trip_stop_id: uuid.UUID,
    rejection_reason: Optional[HandoverTokenRejectionReason],
) -> None:
    db.add(
        HandoverTokenAttempt(
            id=uuid.uuid4(),
            token_id=token_id,
            presented_trip_id=presented_trip_id,
            presented_trip_stop_id=presented_trip_stop_id,
            rejection_reason=rejection_reason,
        )
    )
    await db.flush()


async def redeem_capability_token(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    trip_stop_id: uuid.UUID,
    raw_token: str,
) -> HandoverRedemptionResult:
    """Redeem a presented token, atomically.

    The raw token is never compared to a stored value character-by-character — it is
    hashed once and matched via an indexed equality lookup, so there is no partial-
    match timing channel for a guesser to exploit (the ticket's "constant time"
    requirement, satisfied by never doing a byte-wise comparison in the first place
    rather than by a compare_digest call this design has no use for).

    The actual redemption gate is the single conditional UPDATE below — `WHERE
    redeemed_at IS NULL AND expires_at > now()` — not the SELECT that precedes it.
    The SELECT only classifies wrong-trip/wrong-stop/unknown, none of which are racy
    (a token's trip/stop binding never changes after creation); expiry and prior
    redemption ARE racy, and those are decided by the UPDATE's WHERE clause and
    nothing else, so two simultaneous callers race the database, not this function.
    """
    token_hash = _hash_token(raw_token)

    row = (
        await db.execute(select(HandoverCapabilityToken).where(HandoverCapabilityToken.token_hash == token_hash))
    ).scalar_one_or_none()

    if row is None:
        await _log_attempt(
            db, token_id=None, presented_trip_id=trip_id, presented_trip_stop_id=trip_stop_id,
            rejection_reason=HandoverTokenRejectionReason.UNKNOWN,
        )
        return HandoverRedemptionResult(success=False, reason=HandoverTokenRejectionReason.UNKNOWN, token_id=None)

    if row.trip_id != trip_id:
        await _log_attempt(
            db, token_id=row.id, presented_trip_id=trip_id, presented_trip_stop_id=trip_stop_id,
            rejection_reason=HandoverTokenRejectionReason.WRONG_TRIP,
        )
        return HandoverRedemptionResult(success=False, reason=HandoverTokenRejectionReason.WRONG_TRIP, token_id=row.id)

    if row.trip_stop_id != trip_stop_id:
        await _log_attempt(
            db, token_id=row.id, presented_trip_id=trip_id, presented_trip_stop_id=trip_stop_id,
            rejection_reason=HandoverTokenRejectionReason.WRONG_STOP,
        )
        return HandoverRedemptionResult(success=False, reason=HandoverTokenRejectionReason.WRONG_STOP, token_id=row.id)

    now = datetime.now(UTC)
    updated = (
        await db.execute(
            update(HandoverCapabilityToken)
            .where(
                HandoverCapabilityToken.id == row.id,
                HandoverCapabilityToken.redeemed_at.is_(None),
                HandoverCapabilityToken.expires_at > now,
            )
            .values(redeemed_at=now)
            .returning(HandoverCapabilityToken.id)
        )
    ).scalar_one_or_none()

    if updated is not None:
        await _log_attempt(
            db, token_id=row.id, presented_trip_id=trip_id, presented_trip_stop_id=trip_stop_id,
            rejection_reason=None,
        )
        return HandoverRedemptionResult(success=True, reason=None, token_id=row.id)

    # Lost the race, or expired between the SELECT above and the UPDATE. Re-read to
    # classify which, for the attempt log — the caller-facing response must not
    # distinguish the two (FP-239), but the record kept here must.
    current = (
        await db.execute(select(HandoverCapabilityToken).where(HandoverCapabilityToken.id == row.id))
    ).scalar_one()
    reason = (
        HandoverTokenRejectionReason.ALREADY_REDEEMED
        if current.redeemed_at is not None
        else HandoverTokenRejectionReason.EXPIRED
    )
    await _log_attempt(
        db, token_id=row.id, presented_trip_id=trip_id, presented_trip_stop_id=trip_stop_id,
        rejection_reason=reason,
    )
    return HandoverRedemptionResult(success=False, reason=reason, token_id=row.id)
