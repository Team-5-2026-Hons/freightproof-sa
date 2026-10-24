"""HTTP response conversion for receiver identity verification rows."""

from app.db.models.enums import (
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.schemas.handover import HandoverVerificationState


def _verification_state(v: ReceiverIdentityVerification) -> HandoverVerificationState:
    # Coerced through the enum constructor, not `.value` directly: these columns are
    # mapped_column(String(20)), and a freshly-loaded row hands back a bare str with no
    # .value. EnumClass(x) accepts either a member or its raw string, so this covers both.
    return HandoverVerificationState(
        status=ReceiverVerificationStatus(v.status).value,
        tier=ReceiverVerificationTier(v.tier).value,
        unverified_reason=(
            ReceiverVerificationUnverifiedReason(v.unverified_reason).value
            if v.unverified_reason else None
        ),
        identity_match=v.identity_match,
    )


