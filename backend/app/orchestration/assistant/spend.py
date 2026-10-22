"""The assistant's share of the ONE monthly AI budget (spec D7).

There is one Gemini key and one bill, so there is one cap: both chats add to the same global
counter (`analytics_chat.budget.global_key`) and both are refused once it reaches
AI_CHAT_MONTHLY_BUDGET_USD. Each chat keeps its own per-organisation counter, so each can show what
it spent; the assistant's is ASSISTANT_ORG_PREFIX. `analytics_chat/budget.py` is reused, not edited.

Fails CLOSED like the Analytics chat's: if Redis can't be read, no model call is made, because this
is money. A failure while recording is logged at error and not raised: the money is already spent.
"""

import logging
import uuid
from datetime import datetime

from redis.exceptions import RedisError

from app.analytics.fleet.periods import today_sast
from app.core.config import settings
from app.core.rate_limit import get_redis
from app.orchestration.analytics_chat import budget
from app.schemas.assistant import AssistantSpend

logger = logging.getLogger(__name__)

ASSISTANT_ORG_PREFIX = f"{budget.SPEND_KEY_PREFIX}:assistant:org"


def assistant_key(organization_id: uuid.UUID, now: datetime | None = None) -> str:
    return f"{ASSISTANT_ORG_PREFIX}:{organization_id}:{today_sast(now).strftime('%Y-%m')}"


async def ensure_available(*, now: datetime | None = None) -> None:
    """Raise budget.BudgetSpentError unless both chats together are under the budget."""
    await budget.ensure_available(budget_usd=settings.AI_CHAT_MONTHLY_BUDGET_USD, now=now)


async def record(organization_id: uuid.UUID, micro_usd: int, *, now: datetime | None = None) -> None:
    keys = (budget.global_key(now), assistant_key(organization_id, now))
    try:
        pipeline = get_redis().pipeline(transaction=False)
        for key in keys:
            pipeline.incrby(key, micro_usd)
            pipeline.expire(key, budget.SPEND_KEY_TTL_SECONDS)
        await pipeline.execute()
    except RedisError as exc:
        logger.error("Assistant spend NOT recorded: org=%s micro_usd=%d: %s", organization_id, micro_usd, exc)


async def status(organization_id: uuid.UUID, *, now: datetime | None = None) -> AssistantSpend | None:
    """This organisation's assistant spend and both chats' total this month. None if Redis can't be read."""
    try:
        total_raw, own_raw = await get_redis().mget([budget.global_key(now), assistant_key(organization_id, now)])
    except RedisError as exc:
        logger.warning("Assistant spend unreadable: %s", exc)
        return None
    total = int(total_raw or 0)
    cap = round(settings.AI_CHAT_MONTHLY_BUDGET_USD * budget.MICRO_USD_PER_USD)
    return AssistantSpend(
        spent_usd=int(own_raw or 0) / budget.MICRO_USD_PER_USD,
        all_chats_spent_usd=total / budget.MICRO_USD_PER_USD,
        budget_usd=settings.AI_CHAT_MONTHLY_BUDGET_USD,
        available=total < cap,
    )
