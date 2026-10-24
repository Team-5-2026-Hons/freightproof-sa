"""The receiver's consent decision, recorded as the verification row before any vendor call: declined,
agreed without a document, or agreed with one.
"""

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.integrations.idvs import PROVIDER_DIDIT


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


async def record_consent_declined(
    db: AsyncSession, *, token: HandoverCapabilityToken,
) -> ReceiverIdentityVerification:
    """Create the verification row for a receiver who declined the identity check.

    The row still exists because the flow needs to know a decision was made, but it
    claims nothing: no consent timestamp or wording hash (nobody agreed to anything),
    and TYPED_ONLY rather than SELFIE_ONLY because neither a selfie nor a document was
    taken — the only identity evidence is what the receiver typed. UNVERIFIED with
    DECLINED_CONSENT lets a dispatcher tell "chose not to" from "had no ID" or "vendor
    was down".
    """
    verification = ReceiverIdentityVerification(
        id=uuid.uuid4(),
        token_id=token.id,
        trip_id=token.trip_id,
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.TYPED_ONLY,
        unverified_reason=ReceiverVerificationUnverifiedReason.DECLINED_CONSENT,
        provider=PROVIDER_DIDIT,
    )
    db.add(verification)
    await db.flush()
    return verification


async def record_consent_decision(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    consent_text: str,
    consented: bool,
    has_document: bool,
) -> ReceiverIdentityVerification:
    """Create the verification row for whichever decision the receiver made.

    One place for the three outcomes so the endpoint cannot blur them: declined (no
    consent stored), agreed with no document (consent stored, TYPED_ONLY), or agreed
    with a document (consent stored, ready for a vendor session).

    No document means TYPED_ONLY, not SELFIE_ONLY: the receiver page no longer takes a
    selfie (FP-316 removed it), and a tier must never claim evidence nobody stored.
    """
    if not consented:
        return await record_consent_declined(db, token=token)

    verification = await record_consent(db, token=token, consent_text=consent_text)
    if not has_document:
        verification.tier = ReceiverVerificationTier.TYPED_ONLY
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.NO_DOCUMENT
    return verification
