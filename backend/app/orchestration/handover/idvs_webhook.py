"""The identity vendor's webhook: is a delivery authentic and fresh, and applying the decision it
carries to the verification it belongs to. The backstop for receivers who closed the tab before
their own return trip resolved the check.
"""

import hashlib
import hmac
import logging
from datetime import UTC, datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import ReceiverVerificationStatus
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.integrations.idvs import _parse_decision
from app.orchestration.handover.verdict import resolve_verdict

logger = logging.getLogger(__name__)


# The vendor's integration guidance names 300s. A valid HMAC alone doesn't prove
# recency, so without this a captured delivery could replay indefinitely. A
# protocol constant, not a config field: fixed by the vendor's contract, not by env.
WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 300


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
    # Bytes, not str: compare_digest raises TypeError on a non-ASCII str, which would turn
    # a forged header into a 500 instead of a refusal.
    return hmac.compare_digest(expected.encode("ascii"), presented_signature.encode("utf-8"))


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

    # FOR UPDATE, the lock the receiver's resolve holds: a webhook arriving mid-resolve waits,
    # then sees the row that resolve wrote and annotates it rather than overwriting the verdict.
    verification = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.provider_session_id == str(session_id)
            ).with_for_update()
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
