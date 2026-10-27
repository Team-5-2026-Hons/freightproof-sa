"""The Analytics chat's monthly spend cap, counted in Redis (FP-295 spec D10, §7.6).

After every model call its real cost is added, in whole micro-dollars, to two counters for
the SAST calendar month: one for all organisations together (it enforces the bill against
AI_CHAT_MONTHLY_BUDGET_USD) and one per organisation (shown in the panel).

Fails CLOSED: if Redis can't be read, no model call is made. That is the opposite of the
request rate limiter (core/rate_limit.py fails open) on purpose, because this one is money.

The cap is checked before each call, not reserved, so one question can overshoot it by at
most its own cost (about $0.03 on Sonnet 5.5). That is accepted.
"""

import logging
import uuid
from datetime import datetime

from redis.exceptions import RedisError

from app.analytics.fleet.periods import today_sast
from app.core.rate_limit import get_redis
from app.schemas.analytics_chat import SpendStatus

logger = logging.getLogger(__name__)

SPEND_KEY_PREFIX = "ai_chat_spend:v1"
SPEND_KEY_TTL_SECONDS = 40 * 24 * 60 * 60
MICRO_USD_PER_USD = 1_000_000


class BudgetSpentError(Exception):
    """No model call may be made: the monthly budget is used up, or it can't be checked."""


def _month(now: datetime | None) -> str:
    return today_sast(now).strftime("%Y-%m")


def global_key(now: datetime | None = None) -> str:
    return f"{SPEND_KEY_PREFIX}:all:{_month(now)}"


def org_key(organization_id: uuid.UUID, now: datetime | None = None) -> str:
    return f"{SPEND_KEY_PREFIX}:org:{organization_id}:{_month(now)}"


def _micro(usd: float) -> int:
    return round(usd * MICRO_USD_PER_USD)


async def ensure_available(*, budget_usd: float, now: datetime | None = None) -> None:
    """Raise BudgetSpentError unless this month's total is under the budget."""
    try:
        raw = await get_redis().get(global_key(now))
    except RedisError as exc:
        logger.error("Analytics chat budget unreadable, refusing the model call: %s", exc)
        raise BudgetSpentError("The AI budget can't be checked right now.") from exc
    if int(raw or 0) >= _micro(budget_usd):
        raise BudgetSpentError("The AI budget for this month is used up.")


async def record(organization_id: uuid.UUID, micro_usd: int, *, now: datetime | None = None) -> None:
    """Add one call's cost. A Redis failure is logged, not raised: the money is already spent,
    and the next ensure_available fails closed anyway while Redis stays down."""
    keys = (global_key(now), org_key(organization_id, now))
    try:
        pipeline = get_redis().pipeline(transaction=False)
        for key in keys:
            pipeline.incrby(key, micro_usd)
            pipeline.expire(key, SPEND_KEY_TTL_SECONDS)
        await pipeline.execute()
    except RedisError as exc:
        logger.error(
            "Analytics chat spend NOT recorded: org=%s micro_usd=%d: %s", organization_id, micro_usd, exc,
        )


async def status(
    organization_id: uuid.UUID, *, budget_usd: float, now: datetime | None = None,
) -> SpendStatus | None:
    """This organisation's spend this month and whether the chat can still answer. None if
    Redis can't be read."""
    try:
        total_raw, org_raw = await get_redis().mget([global_key(now), org_key(organization_id, now)])
    except RedisError as exc:
        logger.warning("Analytics chat spend unreadable: %s", exc)
        return None
    return SpendStatus(
        spent_usd=int(org_raw or 0) / MICRO_USD_PER_USD,
        budget_usd=budget_usd,
        available=int(total_raw or 0) < _micro(budget_usd),
    )
