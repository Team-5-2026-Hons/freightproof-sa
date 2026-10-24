"""The identity vendor's free-tier session quota, metered per calendar month."""

import logging
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.receiver_verification import IdvsQuotaLedger
from app.integrations.idvs import PROVIDER_DIDIT

logger = logging.getLogger(__name__)


async def consume_quota_slot(db: AsyncSession, *, provider: str = PROVIDER_DIDIT) -> bool:
    """Claim one free-tier session for this month. True if one was available.

    The conditional UPDATE is the gate, not a read-then-write in Python: two
    handovers racing the database at the same instant could otherwise both pass
    the ceiling. The period key is UTC because the vendor's quota resets at
    00:00 UTC, not local time.
    """
    period = datetime.now(UTC).strftime("%Y-%m")

    # DO NOTHING, not DO UPDATE: the increment below is the only thing allowed to
    # move the counter.
    await db.execute(
        pg_insert(IdvsQuotaLedger)
        .values(period=period, provider=provider, sessions_used=0)
        .on_conflict_do_nothing(index_elements=["period", "provider"])
    )

    consumed = (
        await db.execute(
            update(IdvsQuotaLedger)
            .where(
                IdvsQuotaLedger.period == period,
                IdvsQuotaLedger.provider == provider,
                IdvsQuotaLedger.sessions_used < settings.IDVS_MONTHLY_SESSION_LIMIT,
            )
            .values(sessions_used=IdvsQuotaLedger.sessions_used + 1)
            .returning(IdvsQuotaLedger.sessions_used)
        )
    ).scalar_one_or_none()
    await db.flush()

    if consumed is None:
        logger.warning(
            "IDVS monthly quota exhausted for provider=%s period=%s — degrading tier",
            provider, period,
        )
        return False
    return True
