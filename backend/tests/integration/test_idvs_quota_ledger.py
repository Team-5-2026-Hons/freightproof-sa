"""The free-tier quota is a spending control, so it is tested against a real database.

The team's decision is a hard stop: at the ceiling we stop calling the vendor and degrade
the handover's evidence tier. Session 501 must never be billed.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.models.receiver_verification import IdvsQuotaLedger
from app.orchestration.receiver_verification_service import (
    PROVIDER_DIDIT,
    consume_quota_slot,
)


async def test_first_call_creates_the_period_row_and_consumes_one(db_session):
    granted = await consume_quota_slot(db_session)

    assert granted is True
    row = (
        await db_session.execute(
            select(IdvsQuotaLedger).where(IdvsQuotaLedger.provider == PROVIDER_DIDIT)
        )
    ).scalar_one()
    assert row.sessions_used == 1
    assert row.period == datetime.now(UTC).strftime("%Y-%m")


async def test_consumption_is_refused_at_the_ceiling(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 2)

    first = await consume_quota_slot(db_session)
    second = await consume_quota_slot(db_session)
    third = await consume_quota_slot(db_session)

    assert (first, second, third) == (True, True, False)


async def test_a_refused_claim_does_not_increment_the_counter(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 1)
    await consume_quota_slot(db_session)

    await consume_quota_slot(db_session)

    row = (
        await db_session.execute(
            select(IdvsQuotaLedger).where(IdvsQuotaLedger.provider == PROVIDER_DIDIT)
        )
    ).scalar_one()
    assert row.sessions_used == 1, "a refused claim must not spend a slot"


async def test_providers_are_metered_independently(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 1)

    await consume_quota_slot(db_session, provider=PROVIDER_DIDIT)
    other = await consume_quota_slot(db_session, provider="other-vendor")

    assert other is True, "one provider's ceiling must not close another's"
