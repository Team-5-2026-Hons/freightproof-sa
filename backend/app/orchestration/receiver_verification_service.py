"""Receiver identity verification — quota metering and the identity cross-check.

Stage 1 scope: the two pieces of logic that are pure enough to test without HTTP. The
session lifecycle, tier resolution and exception raising arrive in Stage 2.

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
from app.orchestration.handover_service import extend_token_for_verification

logger = logging.getLogger(__name__)

PROVIDER_DIDIT = "didit"


def _strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _normalise_name(value: str) -> str:
    """Casefold, strip accents, collapse whitespace, drop punctuation.

    Punctuation goes because a document reads "NKOSI" where a receiver types "Nkosi," —
    a comma is not a mismatch, and treating it as one would manufacture fraud signals out
    of typing habits.
    """
    cleaned = "".join(
        char if char.isalnum() or char.isspace() else " "
        for char in _strip_diacritics(value)
    )
    return " ".join(cleaned.casefold().split())


def _normalise_id_number(value: str) -> str:
    """Keep alphanumerics only.

    Passports and company registration numbers legitimately carry letters, and documents
    print separators an ID book does not. Comparing the raw strings would fail on
    formatting alone.
    """
    return "".join(char for char in value if char.isalnum()).casefold()


def identity_matches(
    *,
    typed_name: str,
    typed_id_number: str,
    extracted_surname: Optional[str],
    extracted_id_number: Optional[str],
) -> Optional[bool]:
    """Whether the vendor's extracted identity agrees with what the receiver typed.

    Returns None — not False — when there is nothing to compare. The distinction is the
    whole point: "we could not check" and "we checked and it disagreed" are different
    facts, and the exception types they feed are deliberately kept apart for exactly the
    reason SEAL_UNVERIFIED and SEAL_MISMATCH are.

    Only the SURNAME is compared, and only for presence among the typed name's tokens.
    Given-name ordering, initials and middle names vary far too much between a printed
    document and a one-handed entry on a warehouse floor to carry a fraud signal; a
    surname that is absent entirely does.

    This never blocks anything. A False result is recorded as evidence and surfaced to a
    dispatcher — the delivery still confirms.
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

    The conditional UPDATE is the gate, not a read-then-write in Python: two handovers
    starting at the same instant race the database, exactly as redeem_capability_token
    makes two simultaneous scans do. A read-then-write here would let both pass the
    ceiling and silently bill.

    The period key is UTC because the vendor's quota resets at 00:00 UTC — 02:00 SAST.
    Keying on local time would roll the counter two hours late and bill for the gap.
    """
    period = datetime.now(UTC).strftime("%Y-%m")

    # Ensure the row exists without disturbing a concurrent creator. DO NOTHING rather
    # than DO UPDATE: the increment below is the only thing allowed to move the counter.
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

    Separate from IdvsDecision on purpose: that is the vendor's vocabulary, this is ours,
    and the mapping between them is a judgement this module owns rather than something a
    parser should be making.
    """

    status: ReceiverVerificationStatus
    tier: ReceiverVerificationTier
    unverified_reason: Optional[ReceiverVerificationUnverifiedReason] = None
    exception_type: Optional[ExceptionType] = None


def resolve_verdict(
    *, status: IdvsDecisionStatus, identity_match: Optional[bool],
) -> Verdict:
    """Map a vendor status and cross-check result onto our verdict and its exception.

    Two rules do all the work here, and both are the spec's:

    1. A GAP is not a MISMATCH. ABANDONED and EXPIRED mean no check completed, which has
       benign readings (lost signal, walked away) and raises RECEIVER_ID_UNVERIFIED.
       DECLINED and a failed cross-check mean a check completed and disagreed, which does
       not, and raises RECEIVER_ID_MISMATCH. Conflating them would put false positives in
       front of a dispatcher triaging a real investigation — the reasoning enums.py
       already records for SEAL_UNVERIFIED versus SEAL_MISMATCH.

    2. identity_match None means there was nothing to compare, NOT that it disagreed.
       An APPROVED session with no extracted document data is still VERIFIED; treating
       absence of evidence as evidence of fraud would manufacture mismatches out of a
       vendor's field coverage.

    A non-terminal status yields PENDING and no exception. Nothing is raised for a check
    still in flight — the sweeper terminalises it later, and only then is there a fact.
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

    # ABANDONED / EXPIRED — the gap case.
    return Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        # Both ABANDONED and EXPIRED map here. The enum has no EXPIRED member on
        # purpose: from the evidence record's point of view "they walked away" and "the
        # link aged out" are the same fact — no check completed — and inventing two
        # reasons would imply a distinction a dispatcher cannot act on differently.
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

    Severity follows the gap/mismatch split rather than being uniform. A MISMATCH is a
    fraud indicator with no benign reading and gets WARNING; an UNVERIFIED gap gets INFO,
    because "the receiver had no ID on them" is an ordinary Tuesday on a warehouse floor
    and does not belong in the same lane as a disagreeing document. Putting a class of
    finding with real false-positive modes into the alarm lane is how a dispatcher learns
    to ignore the alarm lane — the reasoning phase_service.py records for GPS_MISMATCH.

    Never CRITICAL. This codebase reserves that for findings that stop a trip — a seal
    mismatch, a panic button — and an identity check cannot, by the spec's own rule that
    verification never gates a delivery.

    Broad except, logged with a traceback: the receiver has already confirmed, and a
    failure to file paperwork about it must not unwind a delivery that happened.
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

        # FP-147's invariant: a system-detected exception that tells no one leaves the
        # dispatcher's screen showing a trip that no longer matches the record.
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

    The hash, never the text. An s27(1)(a) consent basis is only as good as proof of WHAT
    was agreed to, and hashing makes that provable without copying the paragraph into
    every row — which also makes the wording versioned content rather than a UI string
    somebody edits freely.
    """
    return hashlib.sha256(consent_text.encode("utf-8")).hexdigest()


async def record_consent(
    db: AsyncSession, *, token: HandoverCapabilityToken, consent_text: str,
) -> ReceiverIdentityVerification:
    """Create the verification row at the moment the receiver consents.

    Before any vendor call and before any confirmation exists. The row starts PENDING with
    a token_id and no handover_confirmation_id — see the model's docstring for why that
    ordering is the design rather than an oversight.
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
    verification: ReceiverIdentityVerification,
    client: IdvsClient,
) -> Optional[IdvsSession]:
    """Claim quota, create a vendor session, and extend the token to cover it.

    Quota is claimed BEFORE the vendor call, never after. The whole point of the hard stop
    is that session 501 is never created — checking afterwards would mean paying for the
    thing we decided not to buy.

    Returns None on every degradation path. The caller sends the receiver down the tier
    ladder instead of failing: a vendor outage, a spent quota and an unreachable network
    all end with a confirmable delivery carrying an honest reason.
    """
    if not await consume_quota_slot(db, provider=PROVIDER_DIDIT):
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.QUOTA_EXHAUSTED
        await db.flush()
        return None

    try:
        session = await client.create_session(reference=str(verification.id))
    except IdvsError:
        logger.exception("IDVS session creation failed for verification=%s", verification.id)
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.VENDOR_UNAVAILABLE
        await db.flush()
        return None

    # Persisted BEFORE the receiver is redirected. This is the security rule in spec §7.1:
    # the client never names a session, so it can never substitute somebody else's
    # approved one — we only ever fetch a decision for the id we stored ourselves.
    verification.provider_session_id = session.session_id
    await db.flush()

    # Best-effort. A token that cannot be extended still works; it just gives the receiver
    # less time, which degrades the tier rather than failing the handover.
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

    THE security boundary of this feature. The session id comes from our own row, never
    from the caller — spec §7.1, and the exact failure Didit's own team patched in their
    WordPress plugin, where a browser could post {status: "Approved"} and be believed.
    Our receiver route is unauthenticated by design, so trusting a client-supplied status
    would let anyone holding a live QR self-declare VERIFIED.

    A vendor that cannot be reached leaves the row PENDING rather than guessing. The
    sweeper terminalises it later; inventing a verdict here would put a fact in the
    evidence record that nobody established.
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

    Separate from record_consent because the two happen at different moments and a
    receiver may verify and then walk away. A verification with a NULL
    handover_confirmation_id is not an error state — it is the honest record of someone
    who proved who they were and then did not sign.
    """
    await db.execute(
        update(ReceiverIdentityVerification)
        .where(ReceiverIdentityVerification.token_id == token_id)
        .values(handover_confirmation_id=handover_confirmation_id)
    )
    await db.flush()


def verify_webhook_signature(raw_body: bytes, presented_signature: Optional[str]) -> bool:
    """Whether a webhook body really came from the vendor.

    FAILS CLOSED. An unset IDVS_WEBHOOK_SECRET refuses every delivery rather than accepting
    every delivery — a misconfigured deployment must lose webhooks, not accept forged ones.
    This is the only thing standing between a real decision and an attacker's, on a public
    unauthenticated route.

    compare_digest, never `==`: a byte-wise comparison leaks how much of a forged signature
    was correct, which is enough to construct one a byte at a time.
    """
    secret = settings.IDVS_WEBHOOK_SECRET
    if not secret or not presented_signature:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, presented_signature)


async def ingest_webhook_decision(
    db: AsyncSession, *, payload: dict[str, Any],
) -> None:
    """Apply a vendor-pushed decision to the verification it belongs to.

    The BACKSTOP, not the primary path. The receiver's own return trip resolves most
    verifications synchronously; this catches the ones where they closed the tab or lost
    signal before the page could poll.

    Three rules, all from the spec:

      * Unknown session — return quietly. The route 200s so the vendor stops retrying into
        a wall, and a session we never created is not something we can act on.
      * Already terminal — annotate, never overwrite. A late arrival must not rewrite a
        trip that has closed; that would break the invariant the whole ordering exists to
        protect. The finding is still kept, because this codebase records inconvenient
        facts rather than discarding them.
      * Idempotent — Didit retries up to five times. A second delivery of the same decision
        must change nothing, which falls out of the two rules above rather than needing a
        dedupe table.
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

    # `!=`, never `is not`. These columns are mapped_column(String(20)), not a
    # SQLAlchemy Enum, so a row loaded in a fresh session comes back as a bare str
    # rather than the enum member. Identity comparison would therefore be True for
    # EVERY webhook in production — where the request always has its own session —
    # and the backstop would annotate every decision as late instead of resolving
    # any. Value comparison works because these enums subclass str.
    if verification.status != ReceiverVerificationStatus.PENDING:
        verification.late_decision_status = decision.status.value
        verification.late_decision_at = datetime.now(UTC)
        await db.flush()
        logger.info(
            "Late IDVS decision for verification=%s recorded as annotation (status stands at %s)",
            # Coerced, not `.value` directly: status is a String column, so a row
            # loaded in a fresh session is a bare str and `.value` would raise
            # AttributeError — turning this log line into a 500 on the webhook.
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

    The enforcement arm of the spec's invariant: no trip may end with a verification in
    flight. A receiver who starts a check and closes the tab leaves a PENDING row that no
    webhook will ever resolve, and an evidence record whose state is "we are still waiting"
    a week later is not a record at all.

    Returns how many rows were terminalised, so the task can log a number rather than a
    shrug.
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
