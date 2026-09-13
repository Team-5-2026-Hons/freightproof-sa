"""Receiver QR handover (FP-155) — issuing and redeeming capability tokens.

FP-236 built the token primitive; FP-237/238/239/240 now sit on top of it in this same
module rather than reimplementing the redemption gate anywhere else. The rotating series
is rotate_capability_token, the scan-side claim is mark_token_opened, and the record of
what the receiver did is record_handover_confirmation.

Layering: orchestration -> db only, per CLAUDE.md. No caller-specific concerns
(HTTP status codes, rate limiting, session comparison) belong here.
"""

import hashlib
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

# 32 random bytes (256 bits) base64url-encoded — far beyond brute-force range for a
# token that lives at most HANDOVER_TOKEN_EXPIRY_MINUTES. Never derived from trip,
# stop, or timestamp data: the ticket is explicit that a sequential or derivable
# value defeats the whole mechanism.
_TOKEN_BYTES = 32


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def hash_presented_token(raw_token: str) -> str:
    """Public spelling of _hash_token, for callers that must look a token up by hash.

    The scan route needs this to render a page without redeeming anything, and reaching
    into a private name from an endpoint would make that dependency invisible. Hashing is
    not the sensitive operation here — redemption is, and that stays behind
    redeem_capability_token's conditional UPDATE where no caller can route around it.
    """
    return _hash_token(raw_token)


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


@dataclass(frozen=True)
class RotationResult:
    """Outcome of asking for the next QR in a phase event's series.

    `raw_token` is None exactly when `paused` is True. A paused series is not a failure
    — it is the normal, desirable state between a receiver scanning the code and
    finishing with it, and the caller should tell the driver so rather than treating it
    as an error or retrying into it.
    """

    raw_token: Optional[str]
    token: HandoverCapabilityToken
    paused: bool


async def find_open_token(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
) -> Optional[HandoverCapabilityToken]:
    """The token a receiver currently has open for this phase event, if any.

    Open means scanned-and-loaded but not yet confirmed, and not yet expired. At most
    one token can be in this state at a time, because rotation stops issuing while one
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

    Returns the raw session secret on the FIRST load and None on every load after it.
    That asymmetry is the whole anti-forwarding mechanism, so it is worth being explicit
    about: the conditional `WHERE opened_at IS NULL` means a second browser arriving with
    the same URL — because the receiver screenshotted it and sent it on — updates no row,
    gets no secret, receives no cookie, and cannot confirm. The first browser already
    holds the only copy that will ever exist.

    Two other consequences of the same UPDATE, both wanted:

      * A receiver refreshing their own page does not re-mint. They keep the cookie they
        already have; a re-mint would hand a fresh credential to anyone who reloaded.
      * A page left open on a bench cannot keep pushing its claim forward, because
        opened_at is written once and never moved.

    Deliberately NOT a redemption. It takes the token out of the rotation and binds it to
    one browser, but grants nothing: an opened token that is never confirmed still dies at
    its own expires_at, and only redeem_capability_token's conditional UPDATE can spend it.
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


def session_secret_matches(
    token: HandoverCapabilityToken, presented_secret: Optional[str],
) -> bool:
    """Whether a presented browser secret belongs to this token.

    Hashed and compared on the digest, never byte-wise on the secret itself — the same
    reasoning redeem_capability_token's docstring gives for the token: there is no
    partial-match timing channel if no partial match ever happens.

    A token with no session_secret_hash has never been opened, so nothing matches it.
    That case is reachable only by posting a confirm to a token whose page was never
    loaded, which is not a flow any real receiver performs.
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

    Expiry, not deletion. A retired token still has to be able to explain itself: a
    receiver who scans a photographed older frame produces a redemption ATTEMPT, and
    that attempt is evidence (the ticket's DoD). Deleting the row would leave that
    attempt pointing at nothing, which is the UNKNOWN case and means something entirely
    different — a token this system never issued.

    Expiring rather than flagging is also what keeps the public response honest for
    free: redeem_capability_token's existing UPDATE already refuses on
    `expires_at > now()` and classifies the refusal as EXPIRED, which the public routes
    render identically to every other failure.
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

    This is what makes the driver's rotating QR a SERIES sharing one grant rather than a
    growing pile of live tokens: at most one token per confirmation is redeemable at any
    instant. Without the retirement a ten-minute handover would leave thirty valid
    tokens behind it, and photographing the screen once would defeat the rotation
    entirely — which is the only thing the rotation exists to prevent.

    The pause is the other half of that, and without it the feature does not work at
    all. A receiver scans at T and then spends the better part of a minute typing their
    name and ID; two or three rotations happen while they do. If those rotations retired
    the token they are holding, every real handover would fail at the final swipe. So a
    token with opened_at set stops the series: nothing new is issued and nothing is
    retired until it is confirmed or dies of its own expiry. A photograph still goes
    stale within one interval, because a photograph never opens the page.

    `force` is the escape hatch for the one way the pause can strand a real handover: the
    receiver opens the link, then loses the browser session holding their binding cookie
    (a private tab closed, a different browser used for the second load), and can now
    neither confirm nor get a fresh code until the grant expires. The driver is standing
    right there, so the honest fix is to let them say "show a new code" — which retires
    the stranded token, binding and all, and starts the series again.
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

    Called only after redeem_capability_token has already returned success, so the
    single-use gate has been passed at the database. The sibling retirement here closes
    the window the rotation opens: the redeemed token is dead by its own redeemed_at,
    and every other frame the driver's screen ever showed is dead by this call.
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
        # Truncated rather than rejected: a user agent longer than the column is a
        # curiosity worth keeping the front of, not a reason to refuse a delivery
        # confirmation the receiver has already performed.
        receiver_user_agent=(receiver_user_agent or "")[:512] or None,
        bearer_token_present=bearer_token_present,
    )
    db.add(confirmation)
    await db.flush()

    await expire_sibling_tokens(db, phase_event_id=token.phase_event_id, keep_token_id=None)
    return confirmation


def build_scan_url(raw_token: str) -> str:
    """The URL encoded into the QR the driver's screen displays.

    Built here rather than in the endpoint so the driver app never composes a URL out of
    a base and a secret itself — the token is the whole secret, and the one place that
    concatenation happens is the one place to audit it.
    """
    return f"{settings.HANDOVER_RECEIVER_BASE_URL.rstrip('/')}/h/{raw_token}"
