import uuid
from unittest.mock import MagicMock

import pytest

from app.db.models.enums import VerifyStatus, SubjectType
from app.orchestration.verification_service import verify_subject


@pytest.mark.asyncio
async def test_verify_returns_no_receipt_when_none_exists(db_session):
    out = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=uuid.uuid4()
    )
    assert out.status == VerifyStatus.NO_RECEIPT
