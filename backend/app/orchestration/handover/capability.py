"""Receiver QR handover — issuing and redeeming capability tokens.

The rotating series is rotate_capability_token, the scan-side claim is
mark_token_opened, and the record of what the receiver did is
record_handover_confirmation.

Layering: orchestration -> db only. No caller-specific concerns (HTTP status
codes, rate limiting, session comparison) belong here.
"""

import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.db.models.enums import HandoverTokenRejectionReason
from app.db.models.handover import (
    HandoverCapabilityToken,
    HandoverConfirmation,
    HandoverTokenAttempt,
)

logger = logging.getLogger(__name__)

# 256 bits: far beyond brute-force range for a token living at most
# HANDOVER_TOKEN_EXPIRY_MINUTES. Never derived from trip/stop/timestamp data —
# a derivable value would defeat the whole mechanism.
_TOKEN_BYTES = 32


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def hash_presented_token(raw_token: str) -> str:
    """Public spelling of _hash_token, for the scan route to render a page without
    redeeming anything. Hashing isn't the sensitive operation — redemption is,
    and that stays behind redeem_capability_token's conditional UPDATE.
    """
    return _hash_token(raw_token)


@dataclass(frozen=True)
class HandoverRedemptionResult:
    """Outcome of one redemption attempt.

    `reason` is None exactly when `success` is True. A public-facing response must
    not surface `reason` verbatim — EXPIRED, UNKNOWN and ALREADY_REDEEMED must look
    identical to the caller so the scan page can't be used as an oracle; the true
    reason is what got written to HandoverTokenAttempt.
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

    The raw token is hashed once and matched via an indexed equality lookup, never
    compared byte-wise — no partial-match timing channel for a guesser to exploit.

    The actual redemption gate is the conditional UPDATE below (`WHERE redeemed_at
    IS NULL AND expires_at > now()`), not the SELECT preceding it: the SELECT only
    classifies wrong-trip/wrong-stop/unknown, which aren't racy; expiry and prior
    redemption ARE racy, and the UPDATE's WHERE clause is what two simultaneous
    callers actually race against.
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

    # Lost the race, or expired between the SELECT and the UPDATE. Re-read to
    # classify which for the attempt log — the caller-facing response won't
    # distinguish the two, but the record kept here must.
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


@dataclass(frozen=True)
class RotationResult:
    """Outcome of asking for the next QR in a phase event's series.

    `raw_token` is None exactly when `paused` is True. A paused series is the
    normal, desirable state between a receiver scanning the code and finishing
    with it — the caller should tell the driver so, not treat it as an error.
    """

    raw_token: Optional[str]
    token: HandoverCapabilityToken
    paused: bool


async def find_open_token(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
) -> Optional[HandoverCapabilityToken]:
    """The token a receiver currently has open for this phase event, if any.

    Open means scanned-and-loaded but not yet confirmed, and not yet expired. At
    most one token can be in this state, since rotation stops issuing while one
    exists — see rotate_capability_token.
    """
    now = datetime.now(UTC)
    return (
        await db.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.phase_event_id == phase_event_id,
                HandoverCapabilityToken.opened_at.is_not(None),
                HandoverCapabilityToken.redeemed_at.is_(None),
                HandoverCapabilityToken.expires_at > now,
            )
        )
    ).scalars().first()


async def mark_token_opened(db: AsyncSession, *, token_id: uuid.UUID) -> Optional[str]:
    """Claim a token for the browser opening it, and mint that browser's secret.

    Returns the raw session secret on the FIRST load and None on every load after
    it — the whole anti-forwarding mechanism. The conditional `WHERE opened_at IS
    NULL` means a second browser arriving with a screenshotted URL updates no row,
    gets no secret, and cannot confirm. It also means a receiver refreshing their
    own page keeps their existing cookie rather than re-minting one.

    Deliberately NOT a redemption: it binds the token to one browser but grants
    nothing — an opened-but-unconfirmed token still dies at its own expires_at,
    and only redeem_capability_token's conditional UPDATE can spend it.
    """
    raw_secret = secrets.token_urlsafe(_TOKEN_BYTES)
    claimed = (
        await db.execute(
            update(HandoverCapabilityToken)
            .where(
                HandoverCapabilityToken.id == token_id,
                HandoverCapabilityToken.opened_at.is_(None),
            )
            .values(opened_at=datetime.now(UTC), session_secret_hash=_hash_token(raw_secret))
            .returning(HandoverCapabilityToken.id)
        )
    ).scalar_one_or_none()
    await db.flush()

    return raw_secret if claimed is not None else None


async def extend_token_for_verification(
    db: AsyncSession, *, token_id: uuid.UUID,
) -> bool:
    """Push a token's expiry out once, to cover an identity-verification round trip.

    HANDOVER_TOKEN_EXPIRY_MINUTES is sized for a receiver who types a name and
    swipes; a document scan plus a live face check can outlast it and strand the
    delivery behind a generic 404. ONE shot, enforced by the database: the
    conditional `WHERE verification_extended_at IS NULL` makes a second request a
    no-op, the same single-claim idiom mark_token_opened uses on opened_at.
    Refuses a redeemed token, since extending a spent grant would resurrect a
    credential that should be dead.

    Returns True if this call performed the extension, never raises — the caller
    degrades the evidence tier on False rather than failing the handover.
    """
    now = datetime.now(UTC)
    extended = (
        await db.execute(
            update(HandoverCapabilityToken)
            .where(
                HandoverCapabilityToken.id == token_id,
                HandoverCapabilityToken.verification_extended_at.is_(None),
                HandoverCapabilityToken.redeemed_at.is_(None),
            )
            .values(
                verification_extended_at=now,
                expires_at=HandoverCapabilityToken.expires_at
                + timedelta(minutes=settings.IDVS_TOKEN_EXTENSION_MINUTES),
            )
            .returning(HandoverCapabilityToken.id)
        )
    ).scalar_one_or_none()
    await db.flush()

    if extended is None:
        logger.info("Token extension refused for token=%s (already extended, redeemed or unknown)", token_id)
        return False
    return True


def session_secret_matches(
    token: HandoverCapabilityToken, presented_secret: Optional[str],
) -> bool:
    """Whether a presented browser secret belongs to this token.

    Hashed and compared on the digest, never byte-wise, for the same no-partial-
    match reasoning as redeem_capability_token. A token with no
    session_secret_hash has never been opened, so nothing matches it.
    """
    if token.session_secret_hash is None or not presented_secret:
        return False
    return secrets.compare_digest(token.session_secret_hash, _hash_token(presented_secret))


async def expire_sibling_tokens(
    db: AsyncSession,
    *,
    phase_event_id: uuid.UUID,
    keep_token_id: Optional[uuid.UUID] = None,
) -> None:
    """Retire every unredeemed token in a phase event's series except `keep_token_id`.

    Expiry, not deletion: a receiver who scans a photographed older frame produces
    a redemption ATTEMPT that must point at a real row, not the UNKNOWN case (a
    token never issued). Expiring also keeps the public response honest for free —
    redeem_capability_token's UPDATE already refuses on `expires_at > now()` and
    classifies it as EXPIRED, identical to every other failure.
    """
    now = datetime.now(UTC)
    conditions = [
        HandoverCapabilityToken.phase_event_id == phase_event_id,
        HandoverCapabilityToken.redeemed_at.is_(None),
        HandoverCapabilityToken.expires_at > now,
    ]
    if keep_token_id is not None:
        conditions.append(HandoverCapabilityToken.id != keep_token_id)

    await db.execute(update(HandoverCapabilityToken).where(*conditions).values(expires_at=now))
    await db.flush()


async def rotate_capability_token(
    db: AsyncSession,
    *,
    phase_event_id: uuid.UUID,
    trip_id: uuid.UUID,
    trip_stop_id: uuid.UUID,
    force: bool = False,
) -> RotationResult:
    """Issue the next token in a phase event's series, retiring the one before it.

    Makes the driver's rotating QR a SERIES sharing one grant rather than a
    growing pile of live tokens: at most one is redeemable at any instant, so
    photographing the screen once can't defeat the rotation.

    The pause is the other half: once a token's opened_at is set (a receiver is
    mid-scan, typing name/ID), rotation stops issuing and retiring until it's
    confirmed or dies of its own expiry — otherwise a real handover would fail at
    the final swipe while rotations ran underneath it. A photograph still goes
    stale within one interval, since a photograph never opens the page.

    `force` is the escape hatch when the pause strands a real handover — the
    receiver loses their binding-cookie session mid-verification and can neither
    confirm nor get a fresh code. The driver can say "show a new code", which
    retires the stranded token and restarts the series.
    """
    open_token = await find_open_token(db, phase_event_id=phase_event_id)
    if open_token is not None and not force:
        return RotationResult(raw_token=None, token=open_token, paused=True)

    raw_token, token = await issue_capability_token(
        db, phase_event_id=phase_event_id, trip_id=trip_id, trip_stop_id=trip_stop_id,
    )
    await expire_sibling_tokens(db, phase_event_id=phase_event_id, keep_token_id=token.id)
    return RotationResult(raw_token=raw_token, token=token, paused=False)


async def load_handover_confirmation(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
) -> Optional[HandoverConfirmation]:
    """The confirmation for a phase event, or None while the receiver has not scanned."""
    return (
        await db.execute(
            select(HandoverConfirmation).where(
                HandoverConfirmation.phase_event_id == phase_event_id
            )
        )
    ).scalar_one_or_none()


async def record_handover_confirmation(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    signature_artifact_id: uuid.UUID,
    receiver_lat: Optional[Decimal],
    receiver_lng: Optional[Decimal],
    receiver_accuracy_m: Optional[Decimal],
    receiver_ip: Optional[str],
    receiver_user_agent: Optional[str],
    bearer_token_present: bool,
) -> HandoverConfirmation:
    """Write the confirmation row and retire the rest of the series.

    Called only after redeem_capability_token has already returned success. The
    sibling retirement here closes the window rotation opens: the redeemed token
    is dead by its own redeemed_at, every other frame dead by this call.
    """
    confirmation = HandoverConfirmation(
        id=uuid.uuid4(),
        token_id=token.id,
        phase_event_id=token.phase_event_id,
        trip_id=token.trip_id,
        signature_artifact_id=signature_artifact_id,
        receiver_lat=receiver_lat,
        receiver_lng=receiver_lng,
        receiver_accuracy_m=receiver_accuracy_m,
        receiver_ip=receiver_ip,
        # Truncated rather than rejected: an oversized user agent isn't a reason
        # to refuse a delivery confirmation the receiver already performed.
        receiver_user_agent=(receiver_user_agent or "")[:512] or None,
        bearer_token_present=bearer_token_present,
    )
    db.add(confirmation)
    await db.flush()

    await expire_sibling_tokens(db, phase_event_id=token.phase_event_id, keep_token_id=None)
    return confirmation


def build_scan_url(raw_token: str) -> str:
    """The URL encoded into the QR the driver's screen displays.

    Built here, not in the endpoint, so the one place that concatenates a base
    URL with the secret token is the one place to audit it.
    """
    return f"{settings.HANDOVER_RECEIVER_BASE_URL.rstrip('/')}/h/{raw_token}"
