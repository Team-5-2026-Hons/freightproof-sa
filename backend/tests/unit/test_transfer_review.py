"""The pure rules for when a completed driver transfer needs a review exception (FP-83)."""

import uuid

import pytest

from app.db.models.enums import IdvsStatus
from app.db.models.trips import DriverSubstitution
from app.orchestration.substitutions import transfer_review as tr


def _row(*, identity: IdvsStatus = IdvsStatus.VERIFIED, attested: bool = False, missing_reason: str | None = None) -> DriverSubstitution:
    return DriverSubstitution(
        incoming_identity_status=identity.value, identity_attested_by_user_id=uuid.uuid4() if attested else None,
        missing_confirmation_reason=missing_reason,
    )


def test_a_clean_transfer_has_no_reasons() -> None:
    assert tr.transfer_review_reasons(_row(), "within_limit") == []


@pytest.mark.parametrize("identity", [IdvsStatus.PENDING, IdvsStatus.FAILED])
def test_an_unverified_identity_is_a_reason(identity: IdvsStatus) -> None:
    assert tr.transfer_review_reasons(_row(identity=identity), "within_limit") == [tr.REASON_IDENTITY]


def test_a_dispatcher_attestation_over_a_pending_identity_says_so() -> None:
    reasons = tr.transfer_review_reasons(_row(identity=IdvsStatus.PENDING, attested=True), "within_limit")

    assert reasons == [tr.REASON_IDENTITY_ATTESTED]


def test_a_missing_confirmation_is_a_reason() -> None:
    assert tr.transfer_review_reasons(_row(missing_reason="Driver phone dead"), "within_limit") == [tr.REASON_CONFIRMATION]


def test_an_uncomparable_location_is_a_reason() -> None:
    assert tr.transfer_review_reasons(_row(), "unverified") == [tr.REASON_LOCATION]


def test_a_separated_capture_adds_nothing_because_its_own_finding_covers_it() -> None:
    assert tr.transfer_review_reasons(_row(), "separated") == []


def test_no_assessment_is_not_the_same_as_an_unverified_one() -> None:
    assert tr.transfer_review_reasons(_row(), None) == []


def test_every_reason_that_fires_is_listed_in_a_fixed_order() -> None:
    reasons = tr.transfer_review_reasons(_row(identity=IdvsStatus.PENDING, attested=True, missing_reason="x"), "unverified")

    assert reasons == [tr.REASON_IDENTITY_ATTESTED, tr.REASON_CONFIRMATION, tr.REASON_LOCATION]


def test_the_description_names_both_drivers_and_every_reason() -> None:
    text = tr.transfer_review_description("Ciaran Formby", "Timothy Gultig", [tr.REASON_IDENTITY_ATTESTED, tr.REASON_LOCATION])

    assert text == (
        "Driver transfer from Ciaran Formby to Timothy Gultig completed with: "
        "incoming identity not verified (attested by dispatcher); handover location not verified."
    )
