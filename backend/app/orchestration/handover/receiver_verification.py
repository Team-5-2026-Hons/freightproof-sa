"""Receiver identity verification: the vendor session lifecycle. Start a session once consent is
recorded, resolve the authoritative decision into our verdict, link the verdict to the confirmation
the receiver signs, and sweep sessions nobody finished.

The parts it builds on live beside it: consent (the row), quota (the monthly gate), identity_match
(the cross-check), verdict (the mapping and its exception) and idvs_webhook (the vendor's push).

Layering: orchestration -> integrations, db. No HTTP concerns belong here.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.integrations.idvs import PROVIDER_DIDIT, IdvsClient, IdvsError, IdvsSession, get_idvs_client
from app.orchestration.handover.capability import build_scan_url, extend_token_for_verification
from app.orchestration.handover.identity_match import identity_matches
from app.orchestration.handover.quota import consume_quota_slot
from app.orchestration.handover.verdict import Verdict, resolve_verdict

logger = logging.getLogger(__name__)


async def start_verification(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    raw_token: str,
    verification: ReceiverIdentityVerification,
    client: IdvsClient | None = None,
) -> Optional[IdvsSession]:
    """Claim quota, create a vendor session, and extend the token to cover it.

    Quota is claimed BEFORE the vendor call: checking afterwards would mean paying
    for a session already created. Returns None on every degradation path — a
    vendor outage, spent quota, or unreachable network all end with a confirmable
    delivery carrying an honest reason, not a failure.

    Starts a session at most once per verification. A row that is no longer PENDING
    (declined, no document, quota or vendor failure already recorded, resolved) or that
    already has a session returns None untouched, with no quota claimed and no vendor
    call: a retried request would otherwise overwrite provider_session_id, orphaning the
    first session's webhook decision and spending a second free-tier slot. So would a row
    with no consent_given_at — biometric processing needs recorded consent. The caller
    must hold the row lock (load_verification_for_token(lock=True)) so two simultaneous
    requests cannot both pass this check. An abandoned session is left to the sweeper.
    Storing the session URL so a retry could resume the same session would be a later
    improvement, but it needs a column.

    `raw_token` is needed because the vendor's hosted flow must be told where to
    send the receiver back to; the `token` ROW only stores an irreversible hash.

    Handing the vendor a live capability token is a considered trade: redemption
    also requires the HttpOnly binding cookie held only by the receiver's browser
    (FP-240), so a leaked callback URL yields at worst a rendered scan page, never
    a confirmed delivery — the bounded exposure, versus a return-page alternative
    that strands any receiver whose browser refuses storage.

    `client` is for tests and callers that already hold one; by default the configured
    mock-or-live client is used, so the endpoint never touches the integration layer.
    """
    # `!=`, never `is not`: status loads as a bare str (see ingest_webhook_decision).
    if (
        verification.consent_given_at is None
        or verification.status != ReceiverVerificationStatus.PENDING
        or verification.provider_session_id is not None
    ):
        logger.info(
            "Not starting an IDVS session for verification=%s (status=%s, session already=%s)",
            verification.id, verification.status, verification.provider_session_id is not None,
        )
        return None

    if client is None:
        client = get_idvs_client()
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
    typed_name: str,
    typed_id_number: str,
    client: IdvsClient | None = None,
) -> Verdict:
    """Fetch the authoritative decision and write our verdict.

    THE security boundary of this feature: the session id comes from our own row,
    never the caller — our receiver route is unauthenticated by design, so trusting
    a client-supplied status would let anyone holding a live QR self-declare VERIFIED.

    A vendor that cannot be reached leaves the row PENDING rather than guessing;
    the sweeper terminalises it later.

    `client` defaults to the configured mock-or-live client (see start_verification).
    """
    if client is None:
        client = get_idvs_client()
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


async def load_verification_for_token(
    db: AsyncSession, *, token_id: uuid.UUID, lock: bool = False,
) -> Optional[ReceiverIdentityVerification]:
    """The verification for one grant, or None if the receiver never consented.

    `lock=True` takes SELECT ... FOR UPDATE, held until the caller commits. Used by
    /verify so a second simultaneous request waits for the first, then sees its
    provider_session_id instead of racing it (see start_verification).
    """
    statement = select(ReceiverIdentityVerification).where(
        ReceiverIdentityVerification.token_id == token_id
    )
    if lock:
        statement = statement.with_for_update()
    return (await db.execute(statement)).scalar_one_or_none()


async def sweep_abandoned_verifications(db: AsyncSession, *, older_than_seconds: int) -> int:
    """Terminalise PENDING verifications that no decision ever arrived for.

    A receiver who starts a check and closes the tab leaves a PENDING row that no
    webhook will ever resolve, and an evidence record can't stay "still waiting"
    forever. Returns how many rows were terminalised.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=older_than_seconds)
    # FOR UPDATE: a row a resolve or webhook is writing is waited for, then re-checked against the
    # PENDING condition (PostgreSQL re-evaluates it after the lock), so a verdict recorded in the
    # meantime is skipped instead of being overwritten with ABANDONED.
    stale = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.status == ReceiverVerificationStatus.PENDING,
                ReceiverIdentityVerification.created_at < cutoff,
            ).with_for_update()
        )
    ).scalars().all()

    for verification in stale:
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.ABANDONED
    await db.flush()

    if stale:
        logger.info("Swept %d abandoned receiver verifications", len(stale))
    return len(stale)
