"""Receiver identity verification — quota metering, the identity cross-check, and
the vendor session lifecycle.

Layering: orchestration -> integrations, db. No HTTP concerns belong here.
"""

import hashlib
import hmac
import logging
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.receiver_verification import IdvsQuotaLedger, ReceiverIdentityVerification
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.integrations.idvs import IdvsClient, IdvsDecisionStatus, IdvsError, IdvsSession, _parse_decision
from app.orchestration.exception_service import initial_review_status
from app.orchestration.handover_service import build_scan_url, extend_token_for_verification

logger = logging.getLogger(__name__)

PROVIDER_DIDIT = "didit"

# The vendor's integration guidance names 300s. A valid HMAC alone doesn't prove
# recency, so without this a captured delivery could replay indefinitely. A
# protocol constant, not a config field: fixed by the vendor's contract, not by env.
WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 300


def _strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _normalise_name(value: str) -> str:
    """Casefold, strip accents, collapse whitespace, drop punctuation.

    Punctuation goes because "NKOSI" vs "Nkosi," is not a mismatch, and treating it
    as one would manufacture fraud signals out of typing habits.
    """
    cleaned = "".join(
        char if char.isalnum() or char.isspace() else " "
        for char in _strip_diacritics(value)
    )
    return " ".join(cleaned.casefold().split())


def _normalise_id_number(value: str) -> str:
    """Keep alphanumerics only, so formatting/separator differences don't fail the compare."""
    return "".join(char for char in value if char.isalnum()).casefold()


def identity_matches(
    *,
    typed_name: str,
    typed_id_number: str,
    extracted_surname: Optional[str],
    extracted_id_number: Optional[str],
) -> Optional[bool]:
    """Whether the vendor's extracted identity agrees with what the receiver typed.

    Returns None — not False — when there's nothing to compare: "could not check"
    and "checked and disagreed" are different facts, same split as SEAL_UNVERIFIED
    vs SEAL_MISMATCH.

    Only the SURNAME is compared, for presence among the typed name's tokens.
    Given-name ordering/initials vary too much to carry a fraud signal; an absent
    surname does. Never blocks anything — a False result is evidence, not a gate.
    """
    if extracted_surname is None and extracted_id_number is None:
        return None

    if extracted_id_number is not None:
        if _normalise_id_number(typed_id_number) != _normalise_id_number(extracted_id_number):
            return False

    if extracted_surname is not None:
        surname = _normalise_name(extracted_surname)
        if not surname or surname not in _normalise_name(typed_name).split():
            return False

    return True


async def consume_quota_slot(db: AsyncSession, *, provider: str = PROVIDER_DIDIT) -> bool:
    """Claim one free-tier session for this month. True if one was available.

    The conditional UPDATE is the gate, not a read-then-write in Python: two
    handovers racing the database at the same instant could otherwise both pass
    the ceiling. The period key is UTC because the vendor's quota resets at
    00:00 UTC, not local time.
    """
    period = datetime.now(UTC).strftime("%Y-%m")

    # DO NOTHING, not DO UPDATE: the increment below is the only thing allowed to
    # move the counter.
    await db.execute(
        pg_insert(IdvsQuotaLedger)
        .values(period=period, provider=provider, sessions_used=0)
        .on_conflict_do_nothing(index_elements=["period", "provider"])
    )

    consumed = (
        await db.execute(
            update(IdvsQuotaLedger)
            .where(
                IdvsQuotaLedger.period == period,
                IdvsQuotaLedger.provider == provider,
                IdvsQuotaLedger.sessions_used < settings.IDVS_MONTHLY_SESSION_LIMIT,
            )
            .values(sessions_used=IdvsQuotaLedger.sessions_used + 1)
            .returning(IdvsQuotaLedger.sessions_used)
        )
    ).scalar_one_or_none()
    await db.flush()

    if consumed is None:
        logger.warning(
            "IDVS monthly quota exhausted for provider=%s period=%s — degrading tier",
            provider, period,
        )
        return False
    return True


@dataclass(frozen=True)
class Verdict:
    """What we concluded, derived from what the vendor said plus our own cross-check.

    Separate from IdvsDecision on purpose: that is the vendor's vocabulary, this is
    ours, and the mapping between them is a judgement this module owns.
    """

    status: ReceiverVerificationStatus
    tier: ReceiverVerificationTier
    unverified_reason: Optional[ReceiverVerificationUnverifiedReason] = None
    exception_type: Optional[ExceptionType] = None


def resolve_verdict(
    *, status: IdvsDecisionStatus, identity_match: Optional[bool],
) -> Verdict:
    """Map a vendor status and cross-check result onto our verdict and its exception.

    Two rules: (1) a GAP is not a MISMATCH — ABANDONED/EXPIRED are benign (lost
    signal, walked away) and raise RECEIVER_ID_UNVERIFIED, while DECLINED or a
    failed cross-check raise RECEIVER_ID_MISMATCH. (2) identity_match=None means
    nothing to compare, not disagreement — an APPROVED session with no extracted
    document data is still VERIFIED.

    A non-terminal status yields PENDING and no exception; the sweeper terminalises
    it later.
    """
    if not status.is_terminal:
        return Verdict(
            status=ReceiverVerificationStatus.PENDING,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.APPROVED:
        if identity_match is False:
            return Verdict(
                status=ReceiverVerificationStatus.FAILED,
                tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
                exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
            )
        return Verdict(
            status=ReceiverVerificationStatus.VERIFIED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.DECLINED:
        return Verdict(
            status=ReceiverVerificationStatus.FAILED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
            exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
        )

    # ABANDONED / EXPIRED — the gap case. Both map to ABANDONED: "they walked away"
    # and "the link aged out" are the same fact to the evidence record.
    return Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        unverified_reason=ReceiverVerificationUnverifiedReason.ABANDONED,
        exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
    )


async def raise_verification_exception(
    db: AsyncSession,
    *,
    trip: Trip,
    phase_event_id: uuid.UUID,
    trip_stop_id: Optional[uuid.UUID],
    verdict: Verdict,
) -> None:
    """Record a verification finding as a TripException, and tell the dispatcher.

    Severity follows the gap/mismatch split: MISMATCH is a fraud indicator with no
    benign reading (WARNING); an UNVERIFIED gap ("no ID on them") is ordinary
    (INFO). Never CRITICAL — reserved for findings that stop a trip, and
    verification never gates a delivery.

    Broad except: the receiver has already confirmed, and a paperwork failure
    must not unwind a delivery that happened.
    """
    if verdict.exception_type is None:
        return

    severity = (
        ExceptionSeverity.WARNING
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else ExceptionSeverity.INFO
    )
    description = (
        "The identity presented by the receiver did not match the verified document."
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else (
            "The receiver's identity could not be verified at handover "
            f"({verdict.unverified_reason.value if verdict.unverified_reason else 'unknown'})."
        )
    )

    try:
        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=phase_event_id,
            trip_stop_id=trip_stop_id,
            exception_type=verdict.exception_type,
            source=ExceptionSource.SYSTEM,
            severity=severity,
            review_status=initial_review_status(severity),
            description=description,
        ))
        await db.flush()

        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id,
                kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(severity),
            ),
        )
    except Exception:
        logger.exception(
            "Could not record a receiver verification exception for trip=%s phase_event=%s "
            "— the verification row still carries the finding",
            trip.id, phase_event_id,
        )


def hash_consent_text(consent_text: str) -> str:
    """SHA-256 of the exact wording shown to the receiver.

    The hash, never the text: an s27(1)(a) consent basis needs proof of WHAT was
    agreed to, without copying the paragraph into every row.
    """
    return hashlib.sha256(consent_text.encode("utf-8")).hexdigest()


async def record_consent(
    db: AsyncSession, *, token: HandoverCapabilityToken, consent_text: str,
) -> ReceiverIdentityVerification:
    """Create the verification row at the moment the receiver consents.

    Before any vendor call and before any confirmation exists — see the model's
    docstring for why that ordering is the design.
    """
    verification = ReceiverIdentityVerification(
        id=uuid.uuid4(),
        token_id=token.id,
        trip_id=token.trip_id,
        status=ReceiverVerificationStatus.PENDING,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        provider=PROVIDER_DIDIT,
        consent_given_at=datetime.now(UTC),
        consent_text_hash=hash_consent_text(consent_text),
    )
    db.add(verification)
    await db.flush()
    return verification


async def start_verification(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    raw_token: str,
    verification: ReceiverIdentityVerification,
    client: IdvsClient,
) -> Optional[IdvsSession]:
    """Claim quota, create a vendor session, and extend the token to cover it.

    Quota is claimed BEFORE the vendor call: checking afterwards would mean paying
    for a session already created. Returns None on every degradation path — a
    vendor outage, spent quota, or unreachable network all end with a confirmable
    delivery carrying an honest reason, not a failure.

    `raw_token` is needed because the vendor's hosted flow must be told where to
    send the receiver back to; the `token` ROW only stores an irreversible hash.

    Handing the vendor a live capability token is a considered trade: redemption
    also requires the HttpOnly binding cookie held only by the receiver's browser
    (FP-240), so a leaked callback URL yields at worst a rendered scan page, never
    a confirmed delivery — the bounded exposure, versus a return-page alternative
    that strands any receiver whose browser refuses storage.
    """
    if not await consume_quota_slot(db, provider=PROVIDER_DIDIT):
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.QUOTA_EXHAUSTED
        await db.flush()
        return None

    try:
        session = await client.create_session(
            reference=str(verification.id), callback_url=build_scan_url(raw_token),
        )
    except IdvsError:
        logger.exception("IDVS session creation failed for verification=%s", verification.id)
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.VENDOR_UNAVAILABLE
        await db.flush()
        return None

    # Persisted BEFORE the receiver is redirected: the client never names a
    # session, so it can never substitute somebody else's approved one.
    verification.provider_session_id = session.session_id
    await db.flush()

    # Best-effort: a token that can't be extended just degrades the tier.
    await extend_token_for_verification(db, token_id=token.id)

    return session


async def resolve_verification(
    db: AsyncSession,
    *,
    verification: ReceiverIdentityVerification,
    client: IdvsClient,
    typed_name: str,
    typed_id_number: str,
) -> Verdict:
    """Fetch the authoritative decision and write our verdict.

    THE security boundary of this feature: the session id comes from our own row,
    never the caller — our receiver route is unauthenticated by design, so trusting
    a client-supplied status would let anyone holding a live QR self-declare VERIFIED.

    A vendor that cannot be reached leaves the row PENDING rather than guessing;
    the sweeper terminalises it later.
    """
    if verification.provider_session_id is None:
        return Verdict(
            status=ReceiverVerificationStatus.UNVERIFIED,
            tier=verification.tier,
            unverified_reason=ReceiverVerificationUnverifiedReason.VENDOR_UNAVAILABLE,
            exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
        )

    try:
        decision = await client.get_decision(verification.provider_session_id)
    except IdvsError:
        logger.exception(
            "IDVS decision fetch failed for verification=%s — left PENDING for the sweeper",
            verification.id,
        )
        return Verdict(status=ReceiverVerificationStatus.PENDING, tier=verification.tier)

    match = identity_matches(
        typed_name=typed_name,
        typed_id_number=typed_id_number,
        extracted_surname=decision.extracted_surname,
        extracted_id_number=decision.extracted_id_number,
    )
    verdict = resolve_verdict(status=decision.status, identity_match=match)

    verification.identity_match = match
    verification.status = verdict.status
    verification.tier = verdict.tier
    verification.unverified_reason = verdict.unverified_reason
    verification.provider_decision_at = decision.decided_at
    await db.flush()

    return verdict


async def attach_confirmation(
    db: AsyncSession, *, token_id: uuid.UUID, handover_confirmation_id: uuid.UUID,
) -> None:
    """Link a verification to the confirmation the receiver went on to sign.

    Separate from record_consent since a receiver may verify and then walk away.
    A NULL handover_confirmation_id is not an error state — someone proved who
    they were and then didn't sign.
    """
    await db.execute(
        update(ReceiverIdentityVerification)
        .where(ReceiverIdentityVerification.token_id == token_id)
        .values(handover_confirmation_id=handover_confirmation_id)
    )
    await db.flush()


def verify_webhook_signature(raw_body: bytes, presented_signature: Optional[str]) -> bool:
    """Whether a webhook body really came from the vendor.

    FAILS CLOSED: an unset IDVS_WEBHOOK_SECRET refuses every delivery rather than
    accepting every delivery — a misconfigured deployment must lose webhooks, not
    accept forged ones.

    compare_digest, never `==`: a byte-wise comparison leaks how much of a forged
    signature was correct.
    """
    secret = settings.IDVS_WEBHOOK_SECRET
    if not secret or not presented_signature:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, presented_signature)


def webhook_timestamp_is_fresh(
    presented_timestamp: Optional[str],
    *,
    max_skew_seconds: int = WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
) -> bool:
    """Whether a webhook was dispatched recently enough to act on.

    FAILS CLOSED, like verify_webhook_signature: a missing/unparseable timestamp
    is refused rather than waved through. Absolute difference, not "older than" —
    a timestamp far in the FUTURE is just as suspicious as a stale one.
    """
    if not presented_timestamp:
        return False

    try:
        dispatched_at = int(presented_timestamp)
    except (TypeError, ValueError):
        logger.warning("IDVS webhook carried an unparseable timestamp: %r", presented_timestamp)
        return False

    skew = abs(int(datetime.now(UTC).timestamp()) - dispatched_at)
    if skew > max_skew_seconds:
        # Logged with the delta: a webhook rejected for freshness vs. a bad
        # signature need to be distinguishable at 2am.
        logger.warning(
            "Rejected an IDVS webhook %ss out of date (limit %ss) — replay, or check this "
            "server's clock", skew, max_skew_seconds,
        )
        return False
    return True


async def ingest_webhook_decision(
    db: AsyncSession, *, payload: dict[str, Any],
) -> None:
    """Apply a vendor-pushed decision to the verification it belongs to.

    The BACKSTOP, not the primary path: the receiver's own return trip resolves
    most verifications synchronously; this catches the ones where they closed the
    tab or lost signal first.

    Unknown session returns quietly (200s so the vendor stops retrying). Already-
    terminal verifications are annotated, never overwritten — a late arrival must
    not rewrite a closed trip, though the finding is still kept. This also makes
    the handler idempotent against Didit's retries, with no dedupe table needed.
    """
    session_id = payload.get("session_id")
    if not session_id:
        logger.warning("IDVS webhook carried no session_id; ignoring")
        return

    verification = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.provider_session_id == str(session_id)
            )
        )
    ).scalar_one_or_none()

    if verification is None:
        logger.info("IDVS webhook for unknown session=%s; ignoring", session_id)
        return

    decision = _parse_decision(payload, fallback_session_id=str(session_id))

    # `!=`, never `is not`: status is mapped_column(String(20)), so a freshly
    # loaded row is a bare str, not the enum member. Value comparison works
    # because these enums subclass str.
    if verification.status != ReceiverVerificationStatus.PENDING:
        verification.late_decision_status = decision.status.value
        verification.late_decision_at = datetime.now(UTC)
        await db.flush()
        logger.info(
            "Late IDVS decision for verification=%s recorded as annotation (status stands at %s)",
            # Coerced, not `.value` directly: a bare str has no `.value`.
            verification.id, ReceiverVerificationStatus(verification.status).value,
        )
        return

    verdict = resolve_verdict(status=decision.status, identity_match=verification.identity_match)
    verification.status = verdict.status
    verification.unverified_reason = verdict.unverified_reason
    verification.provider_decision_at = decision.decided_at
    await db.flush()


async def load_verification_for_token(
    db: AsyncSession, *, token_id: uuid.UUID,
) -> Optional[ReceiverIdentityVerification]:
    """The verification for one grant, or None if the receiver never consented."""
    return (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.token_id == token_id
            )
        )
    ).scalar_one_or_none()


async def sweep_abandoned_verifications(db: AsyncSession, *, older_than_seconds: int) -> int:
    """Terminalise PENDING verifications that no decision ever arrived for.

    A receiver who starts a check and closes the tab leaves a PENDING row that no
    webhook will ever resolve, and an evidence record can't stay "still waiting"
    forever. Returns how many rows were terminalised.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=older_than_seconds)
    stale = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.status == ReceiverVerificationStatus.PENDING,
                ReceiverIdentityVerification.created_at < cutoff,
            )
        )
    ).scalars().all()

    for verification in stale:
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.ABANDONED
    await db.flush()

    if stale:
        logger.info("Swept %d abandoned receiver verifications", len(stale))
    return len(stale)
