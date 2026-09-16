"""Unit tests for production configuration preconditions (app/core/config_validation.py).

Each rule here stands in for a failure that produces no error of its own — see the
module's docstring. The tests assert the rule fires, and just as importantly that it does
NOT fire outside production, because a rule that blocks local development gets disabled
and then protects nothing.

Settings is constructed directly with explicit values rather than monkeypatched onto the
shared singleton: these tests are about what a given configuration means, and building one
per case keeps them independent of whatever the developer's own .env happens to say.
"""

import pytest

from app.core.config import Settings
from app.core.config_validation import (
    ProductionConfigError,
    collect_production_config_errors,
    enforce_production_config,
)

# Values that satisfy the required fields Settings has no defaults for. None is read by
# any rule under test — they exist only so Settings can be instantiated at all.
_REQUIRED_FIELDS = {
    "DATABASE_URL": "postgresql+asyncpg://user:pw@db.example.com:5432/postgres",
    "REDIS_URL": "redis://redis.example.com:6379",
    "SUPABASE_URL": "https://project.supabase.co",
    "SUPABASE_ANON_KEY": "anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
    "HEDERA_ACCOUNT_ID": "0.0.12345",
    "HEDERA_PRIVATE_KEY": "private-key",
}

# A production configuration with nothing wrong with it. Each test below breaks exactly
# one thing, so a failure names the rule that fired rather than a soup of them.
_VALID_PRODUCTION = {
    **_REQUIRED_FIELDS,
    "ENVIRONMENT": "production",
    "ALLOWED_ORIGINS": ["https://www.freightproof.co.za"],
    "HANDOVER_RECEIVER_BASE_URL": "https://receiver.freightproof.co.za",
    "IDVS_USE_MOCK": True,
    "RATE_LIMIT_TRUST_PROXY_HEADERS": True,
    "RATE_LIMIT_ENABLED": True,
}


def _settings(*, omit: str | None = None, **overrides: object) -> Settings:
    """Build Settings from explicit values, ignoring any .env on the developer's machine.

    `omit` drops a field entirely rather than setting it, which is not the same thing:
    the proxy-topology rule turns on whether a field was SET, so a test for it has to be
    able to leave one genuinely unset.

    The ignore is here, at the single construction point: BaseSettings types its __init__
    kwargs as its own configuration options, so mypy cannot see a **dict splat as this
    model's fields.
    """
    values = {**_VALID_PRODUCTION, **overrides}
    if omit is not None:
        values.pop(omit, None)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


# ── The happy path, and the non-production escape ────────────────────────────


def test_a_correct_production_config_raises_nothing() -> None:
    errors = collect_production_config_errors(_settings())

    assert errors == []


def test_development_is_never_blocked_by_a_production_rule() -> None:
    # Every value here violates a production rule. In development none of them apply.
    settings = _settings(
        ENVIRONMENT="development",
        ALLOWED_ORIGINS=["*"],
        HANDOVER_RECEIVER_BASE_URL="http://localhost:3002",
        IDVS_USE_MOCK=False,
        RATE_LIMIT_ENABLED=False,
    )

    errors = collect_production_config_errors(settings)

    assert errors == []


# ── Receiver app reachability ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "loopback_url",
    [
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "https://localhost:3002",
        "http://0.0.0.0:3002",
    ],
)
def test_a_loopback_receiver_url_is_rejected(loopback_url: str) -> None:
    errors = collect_production_config_errors(
        _settings(HANDOVER_RECEIVER_BASE_URL=loopback_url)
    )

    assert any("HANDOVER_RECEIVER_BASE_URL" in error for error in errors)


@pytest.mark.parametrize(
    "public_url",
    [
        "https://receiver.freightproof.co.za",
        # Contains the substring "//localhost" but is an ordinary public hostname. A
        # substring check refused this and would have blocked a legitimate deploy.
        "https://localhost.example.co.za",
    ],
)
def test_a_public_receiver_url_is_accepted(public_url: str) -> None:
    errors = collect_production_config_errors(
        _settings(HANDOVER_RECEIVER_BASE_URL=public_url)
    )

    assert errors == []


def test_an_ipv6_loopback_receiver_url_is_rejected() -> None:
    errors = collect_production_config_errors(
        _settings(HANDOVER_RECEIVER_BASE_URL="http://[::1]:3002")
    )

    assert any("HANDOVER_RECEIVER_BASE_URL" in error for error in errors)


def test_an_empty_receiver_url_is_rejected() -> None:
    errors = collect_production_config_errors(_settings(HANDOVER_RECEIVER_BASE_URL=""))

    assert any("HANDOVER_RECEIVER_BASE_URL" in error for error in errors)


def test_a_plain_http_receiver_url_is_rejected() -> None:
    # The binding cookie is set Secure outside development, so http can never hold it.
    errors = collect_production_config_errors(
        _settings(HANDOVER_RECEIVER_BASE_URL="http://receiver.freightproof.co.za")
    )

    assert any("https" in error for error in errors)


# ── CORS ─────────────────────────────────────────────────────────────────────


def test_a_wildcard_origin_is_rejected_in_production() -> None:
    errors = collect_production_config_errors(_settings(ALLOWED_ORIGINS=["*"]))

    assert any("ALLOWED_ORIGINS" in error for error in errors)


# ── Didit, when live ─────────────────────────────────────────────────────────


def test_live_didit_without_credentials_is_rejected() -> None:
    errors = collect_production_config_errors(
        _settings(IDVS_USE_MOCK=False, IDVS_WEBHOOK_SECRET="a-secret")
    )

    assert any("IDVS_API_URL" in error for error in errors)


def test_live_didit_without_a_webhook_secret_is_rejected() -> None:
    # The signature check fails closed, so an unset secret rejects every genuine delivery.
    errors = collect_production_config_errors(
        _settings(
            IDVS_USE_MOCK=False,
            IDVS_API_URL="https://verification.didit.me",
            IDVS_API_KEY="key",
            IDVS_WORKFLOW_ID="workflow",
            IDVS_WEBHOOK_SECRET="",
        )
    )

    assert any("IDVS_WEBHOOK_SECRET" in error for error in errors)


def test_mocked_didit_needs_no_credentials() -> None:
    errors = collect_production_config_errors(
        _settings(IDVS_USE_MOCK=True, IDVS_API_KEY="", IDVS_WEBHOOK_SECRET="")
    )

    assert errors == []


# ── Proxy topology ───────────────────────────────────────────────────────────


def test_an_unstated_proxy_topology_is_rejected() -> None:
    # Absent entirely, not set to False — the point of the rule is that inheriting the
    # default silently is different from deciding it.
    errors = collect_production_config_errors(
        _settings(omit="RATE_LIMIT_TRUST_PROXY_HEADERS")
    )

    assert any("RATE_LIMIT_TRUST_PROXY_HEADERS" in error for error in errors)


def test_a_deliberate_false_proxy_topology_is_accepted() -> None:
    # A production deployment genuinely not behind a proxy must be able to say so.
    errors = collect_production_config_errors(
        _settings(RATE_LIMIT_TRUST_PROXY_HEADERS=False)
    )

    assert errors == []


def test_disabled_rate_limiting_is_rejected_in_production() -> None:
    errors = collect_production_config_errors(_settings(RATE_LIMIT_ENABLED=False))

    assert any("RATE_LIMIT_ENABLED" in error for error in errors)


# ── Reporting ────────────────────────────────────────────────────────────────


def test_every_error_is_reported_together_not_one_per_restart() -> None:
    settings = _settings(
        ALLOWED_ORIGINS=["*"],
        HANDOVER_RECEIVER_BASE_URL="http://localhost:3002",
        RATE_LIMIT_ENABLED=False,
    )

    errors = collect_production_config_errors(settings)

    assert len(errors) == 3


def test_enforce_raises_with_every_error_in_the_message() -> None:
    settings = _settings(ALLOWED_ORIGINS=["*"], RATE_LIMIT_ENABLED=False)

    with pytest.raises(ProductionConfigError) as exc_info:
        enforce_production_config(settings)

    message = str(exc_info.value)
    assert "ALLOWED_ORIGINS" in message
    assert "RATE_LIMIT_ENABLED" in message


def test_enforce_is_silent_for_a_correct_config() -> None:
    enforce_production_config(_settings())
