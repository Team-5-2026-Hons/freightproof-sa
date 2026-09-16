"""Mapping a vendor decision + cross-check result onto our own verdict.

The distinction this file exists to protect: a GAP (no check completed) and a MISMATCH
(a check completed and disagreed) are different facts and raise different exceptions —
the same separation enums.py already draws between SEAL_UNVERIFIED and SEAL_MISMATCH."""

from app.db.models.enums import (
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.integrations.idvs import IdvsDecisionStatus
from app.orchestration.receiver_verification_service import resolve_verdict


def test_approved_and_matching_identity_is_verified():
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=True)

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.tier is ReceiverVerificationTier.DOCUMENT_AND_FACE
    assert v.exception_type is None


def test_approved_but_mismatched_identity_is_failed_and_raises_mismatch():
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=False)

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.exception_type is ExceptionType.RECEIVER_ID_MISMATCH


def test_declined_is_failed_and_raises_mismatch():
    v = resolve_verdict(status=IdvsDecisionStatus.DECLINED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.exception_type is ExceptionType.RECEIVER_ID_MISMATCH


def test_approved_with_nothing_to_compare_is_verified_not_failed():
    """identity_match is None when the vendor returned no document data. That is an
    absence of evidence, not evidence of mismatch."""
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.exception_type is None


def test_abandoned_is_unverified_and_raises_the_gap_exception():
    v = resolve_verdict(status=IdvsDecisionStatus.ABANDONED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.unverified_reason is ReceiverVerificationUnverifiedReason.ABANDONED
    assert v.exception_type is ExceptionType.RECEIVER_ID_UNVERIFIED


def test_expired_is_unverified_and_raises_the_gap_exception():
    v = resolve_verdict(status=IdvsDecisionStatus.EXPIRED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.exception_type is ExceptionType.RECEIVER_ID_UNVERIFIED


def test_a_non_terminal_status_stays_pending_and_raises_nothing_yet():
    v = resolve_verdict(status=IdvsDecisionStatus.IN_PROGRESS, identity_match=None)

    assert v.status is ReceiverVerificationStatus.PENDING
    assert v.exception_type is None
