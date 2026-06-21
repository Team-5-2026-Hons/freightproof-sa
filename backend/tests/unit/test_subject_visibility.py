"""Unit tests for blockchain subject visibility — no HTTP layer."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import SubjectType


@pytest.mark.asyncio
async def test_visible_subject_does_not_raise() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = uuid.uuid4()
    db.execute.return_value = result
    await assert_subject_visible(
        db, subject_type=SubjectType.TRIP,
        subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
    )


@pytest.mark.asyncio
async def test_invisible_subject_raises() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result
    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db, subject_type=SubjectType.TRIP,
            subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_unknown_subject_type_raises() -> None:
    db = AsyncMock()
    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db, subject_type="nonexistent",  # type: ignore[arg-type]
            subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
        )
