"""HTTP response conversion for receiver identity verification rows."""

from app.db.models.enums import (
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.schemas.handover import HandoverVerificationState


def _verification_state(v: ReceiverIdentityVerification) -> HandoverVerificationState:
    return HandoverVerificationState(
        status=ReceiverVerificationStatus(v.status).value,
        tier=ReceiverVerificationTier(v.tier).value,
        unverified_reason=(
            ReceiverVerificationUnverifiedReason(v.unverified_reason).value
            if v.unverified_reason else None
        ),
        identity_match=v.identity_match,
    )

