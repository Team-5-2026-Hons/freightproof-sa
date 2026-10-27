"""The price table behind the Analytics chat's spend cap. Every expected cost is worked out
by hand from the prices in pricing.py (USD per million tokens, 19 Oct 2026)."""

import pytest

from app.integrations.ai_chat.pricing import MODEL_PRICES, UnknownModelError, cost_micro_usd, price_for
from app.integrations.ai_chat.provider import Usage


def test_price_for_a_listed_model_returns_it() -> None:
    assert price_for("claude-sonnet-5-5") is MODEL_PRICES["claude-sonnet-5-5"]


def test_price_for_an_unlisted_model_raises() -> None:
    with pytest.raises(UnknownModelError):
        price_for("claude-imaginary-9")


def test_cost_sonnet_matches_a_hand_calculation() -> None:
    usage = Usage(input_tokens=3_000, output_tokens=700, cache_write_tokens=4_000, cache_read_tokens=5_000)

    cost = cost_micro_usd(usage, price_for("claude-sonnet-5-5"))

    assert cost == 23_500


def test_cost_rounds_up_to_a_whole_micro_dollar() -> None:
    usage = Usage(input_tokens=0, output_tokens=0, cache_write_tokens=0, cache_read_tokens=3)

    assert cost_micro_usd(usage, price_for("claude-sonnet-5-5")) == 1


def test_cost_haiku_short_prompt_uses_the_standard_prices() -> None:
    usage = Usage(input_tokens=60_000, output_tokens=1_000, cache_write_tokens=0, cache_read_tokens=40_000)

    assert cost_micro_usd(usage, price_for("claude-haiku-5-5")) == 6_000 + 400 + 500


def test_cost_haiku_long_prompt_uses_the_higher_prices_for_the_whole_request() -> None:
    usage = Usage(input_tokens=60_001, output_tokens=1_000, cache_write_tokens=0, cache_read_tokens=40_000)

    assert cost_micro_usd(usage, price_for("claude-haiku-5-5")) == 30_001 + 2_000 + 2_500


def test_cost_counts_cache_writes_toward_the_haiku_prompt_size() -> None:
    usage = Usage(input_tokens=50_000, output_tokens=0, cache_write_tokens=50_001, cache_read_tokens=0)

    assert cost_micro_usd(usage, price_for("claude-haiku-5-5")) == 56_251


def test_cost_gemini_counts_cached_reads_and_no_cache_writes() -> None:
    usage = Usage(input_tokens=4_000, output_tokens=500, cache_write_tokens=0, cache_read_tokens=2_000)

    assert cost_micro_usd(usage, price_for("gemini-3.8-flash")) == 6_000 + 300 + 3_750
