"""What each model call costs, for the Analytics chat's monthly spend cap (FP-295 spec D10).

Prices are USD per million tokens, copied on 19 Oct 2026 from the providers' own pages:
Anthropic platform.claude.com/docs/en/about-claude/pricing (Claude; cache writes at the
5-minute price, the only cache the adapter asks for) and Google ai.google.dev/gemini-api/docs/pricing
(Gemini, paid Standard tier). Re-check them there when changing AI_CHAT_MODEL; never guess
one. A model that isn't listed has no price, so the chat stays off for it instead of spending
without counting (price_for raises).

Gemini on the free tier costs nothing, but the cap still counts what the same calls would cost
on the paid tier, so it keeps meaning something if billing is switched on. Google's page says
Gemini 3.x Flash prices double on 1 Jan 2027; the table already uses the doubled price so the
cap can only ever overcount, never undercount. Gemini has no cache-write charge (its implicit
caching bills reads only).
"""

import math
from dataclasses import dataclass
from decimal import Decimal

from app.integrations.ai_chat.provider import Usage


@dataclass(frozen=True)
class TokenPrices:
    """USD per million tokens."""

    input: Decimal
    cache_write: Decimal
    cache_read: Decimal
    output: Decimal


@dataclass(frozen=True)
class ModelPrice:
    standard: TokenPrices
    # Haiku 5.5 charges more for the WHOLE request once its prompt (input + cache reads +
    # cache writes) passes a size. None for models priced the same at any size.
    long_prompt: TokenPrices | None = None
    long_prompt_over_tokens: int | None = None


MODEL_PRICES: dict[str, ModelPrice] = {
    "claude-sonnet-5-5": ModelPrice(
        standard=TokenPrices(Decimal("2"), Decimal("2.50"), Decimal("0.10"), Decimal("10")),
    ),
    "claude-haiku-5-5": ModelPrice(
        standard=TokenPrices(Decimal("0.10"), Decimal("0.125"), Decimal("0.01"), Decimal("0.50")),
        long_prompt=TokenPrices(Decimal("0.50"), Decimal("0.625"), Decimal("0.05"), Decimal("2.50")),
        long_prompt_over_tokens=100_000,
    ),
    "gemini-3.8-flash": ModelPrice(
        standard=TokenPrices(Decimal("1.50"), Decimal("0"), Decimal("0.15"), Decimal("7.50")),
    ),
    "gemini-2.5-flash": ModelPrice(
        standard=TokenPrices(Decimal("0.30"), Decimal("0"), Decimal("0.03"), Decimal("2.50")),
    ),
    # Other free-tier models, so AI_CHAT_MODEL can be switched in .env alone when one model's
    # free allowance is used up (each model has its own). 3.6 Flash also doubles on 1 Jan 2027.
    "gemini-3.6-flash": ModelPrice(
        standard=TokenPrices(Decimal("1.50"), Decimal("0"), Decimal("0.15"), Decimal("7.50")),
    ),
    "gemini-3.5-flash-lite": ModelPrice(
        standard=TokenPrices(Decimal("0.30"), Decimal("0"), Decimal("0.03"), Decimal("2.50")),
    ),
    "gemini-3.1-flash-lite": ModelPrice(
        standard=TokenPrices(Decimal("0.25"), Decimal("0"), Decimal("0.025"), Decimal("1.50")),
    ),
    "gemini-2.5-flash-lite": ModelPrice(
        standard=TokenPrices(Decimal("0.10"), Decimal("0"), Decimal("0.01"), Decimal("0.40")),
    ),
}


class UnknownModelError(ValueError):
    """AI_CHAT_MODEL names a model with no price here."""


def price_for(model: str) -> ModelPrice:
    try:
        return MODEL_PRICES[model]
    except KeyError as exc:
        raise UnknownModelError(f"No price recorded for model {model!r}") from exc


def _prices_for(usage: Usage, price: ModelPrice) -> TokenPrices:
    prompt_tokens = usage.input_tokens + usage.cache_write_tokens + usage.cache_read_tokens
    if (
        price.long_prompt is not None
        and price.long_prompt_over_tokens is not None
        and prompt_tokens > price.long_prompt_over_tokens
    ):
        return price.long_prompt
    return price.standard


def cost_micro_usd(usage: Usage, price: ModelPrice) -> int:
    """The call's cost in millionths of a dollar, rounded up so the cap is never undercounted.

    Tokens × USD-per-million-tokens is already micro-dollars, so no scaling is needed.
    """
    prices = _prices_for(usage, price)
    total = (
        usage.input_tokens * prices.input
        + usage.cache_write_tokens * prices.cache_write
        + usage.cache_read_tokens * prices.cache_read
        + usage.output_tokens * prices.output
    )
    return math.ceil(total)
