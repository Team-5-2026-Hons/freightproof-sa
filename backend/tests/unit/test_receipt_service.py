"""Orchestration for receipt reads and visibility-gated verification.

The endpoint tests patch these seams; these tests pin what the seams themselves do.
"""

import uuid
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import SubjectType, VerifyStatus
from app.orchestration import receipt_service
from app.orchestration.verification_service import VerifyOutcome, verify_visible_subject


def _db() -> AsyncSession:
    return cast(AsyncSession, MagicMock())


async def test_lookup_receipts_delegates_with_the_same_arguments() -> None:
    org_id, subject_id = uuid.uuid4(), uuid.uuid4()
    expected = [MagicMock()]

    with patch(
        "app.blockchain.anchor_service.lookup_receipts", new_callable=AsyncMock, return_value=expected,
    ) as inner:
        result = await receipt_service.lookup_receipts(
            _db(), organization_id=org_id, data_hash="ab" * 32, subject_id=subject_id,
        )

    assert result is expected
    inner.assert_awaited_once()
    assert inner.await_args_list[0].kwargs == {
        "organization_id": org_id, "data_hash": "ab" * 32, "hedera_tx_id": None, "subject_id": subject_id,
    }


async def test_lookup_receipts_still_rejects_an_ambiguous_key() -> None:
    with pytest.raises(ValueError):
        await receipt_service.lookup_receipts(_db(), organization_id=uuid.uuid4())


async def test_list_receipts_for_subject_delegates_with_the_same_arguments() -> None:
    org_id, subject_id = uuid.uuid4(), uuid.uuid4()
    expected = [MagicMock()]

    with patch(
        "app.blockchain.anchor_service.list_receipts_for_subject",
        new_callable=AsyncMock, return_value=expected,
    ) as inner:
        result = await receipt_service.list_receipts_for_subject(
            _db(), subject_type=SubjectType.VEHICLE, subject_id=subject_id, organization_id=org_id,
        )

    assert result is expected
    assert inner.await_args_list[0].kwargs == {
        "subject_type": SubjectType.VEHICLE, "subject_id": subject_id, "organization_id": org_id,
    }


async def test_verify_visible_subject_verifies_after_the_visibility_check() -> None:
    org_id, subject_id = uuid.uuid4(), uuid.uuid4()
    outcome = VerifyOutcome(status=VerifyStatus.NO_RECEIPT)
    calls: list[str] = []

    async def _visible(*args: object, **kwargs: object) -> None:
        calls.append("visible")

    async def _verify(*args: object, **kwargs: object) -> VerifyOutcome:
        calls.append("verify")
        return outcome

    with (
        patch("app.orchestration.verification_service.assert_subject_visible", _visible),
        patch("app.orchestration.verification_service.verify_subject", _verify),
    ):
        result = await verify_visible_subject(
            _db(), subject_type=SubjectType.DRIVER, subject_id=subject_id, organization_id=org_id,
        )

    assert result is outcome
    assert calls == ["visible", "verify"]


async def test_verify_visible_subject_does_not_verify_a_foreign_subject() -> None:
    subject_id = uuid.uuid4()

    with (
        patch(
            "app.orchestration.verification_service.assert_subject_visible",
            new_callable=AsyncMock, side_effect=SubjectNotVisibleError("driver", str(subject_id)),
        ),
        patch("app.orchestration.verification_service.verify_subject", new_callable=AsyncMock) as verify,
    ):
        with pytest.raises(SubjectNotVisibleError):
            await verify_visible_subject(
                _db(), subject_type=SubjectType.DRIVER, subject_id=subject_id,
                organization_id=uuid.uuid4(),
            )

    verify.assert_not_awaited()
