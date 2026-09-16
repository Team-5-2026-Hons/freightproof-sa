"""Unit tests for the derived CORS origin list (Settings.cors_allowed_origins).

This property exists because ALLOWED_ORIGINS is env-overridable and pydantic REPLACES the
default list wholesale — so any origin written into that default is one an .env can
silently delete. It has cost the project two real outages:

  * a .env override dropping the receiver app's origin, which broke the first two-phone
    test of the handover feature, and
  * backend/.env.example itself shipping a list without the driver app's native origins,
    so following the documented setup broke the driver app's every API call.

Both failures present as a browser-side CORS refusal, which surfaces as the handover's
deliberately generic 404 — near-undebuggable. These tests pin the invariant that no
configuration can omit an origin that is not a deployment's choice to make.
"""

from app.core.config import Settings

_REQUIRED_FIELDS = {
    "DATABASE_URL": "postgresql+asyncpg://user:pw@db.example.com:5432/postgres",
    "REDIS_URL": "redis://redis.example.com:6379",
    "SUPABASE_URL": "https://project.supabase.co",
    "SUPABASE_ANON_KEY": "anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
    "HEDERA_ACCOUNT_ID": "0.0.12345",
    "HEDERA_PRIVATE_KEY": "private-key",
}

# The driver app's native origins. Fixed by the platforms, not chosen by us.
_IOS_ORIGIN = "capacitor://localhost"
_ANDROID_ORIGIN = "https://localhost"


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **{**_REQUIRED_FIELDS, **overrides})  # type: ignore[arg-type]


def test_the_native_origins_survive_an_env_override() -> None:
    # Exactly the shape backend/.env.example used to ship: browser origins only.
    settings = _settings(
        ALLOWED_ORIGINS=["http://localhost:3000", "http://localhost:3001"],
    )

    origins = settings.cors_allowed_origins

    assert _IOS_ORIGIN in origins
    assert _ANDROID_ORIGIN in origins


def test_the_native_origins_survive_a_locked_down_production_list() -> None:
    # The natural thing to do post-merge: lock CORS to the real dispatcher domain.
    settings = _settings(ALLOWED_ORIGINS=["https://www.freightproof.co.za"])

    origins = settings.cors_allowed_origins

    assert _IOS_ORIGIN in origins
    assert _ANDROID_ORIGIN in origins
    assert "https://www.freightproof.co.za" in origins


def test_the_receiver_origin_is_folded_in() -> None:
    settings = _settings(
        ALLOWED_ORIGINS=["https://www.freightproof.co.za"],
        HANDOVER_RECEIVER_BASE_URL="https://receiver.freightproof.co.za",
    )

    origins = settings.cors_allowed_origins

    assert "https://receiver.freightproof.co.za" in origins


def test_a_trailing_slash_on_the_receiver_url_does_not_produce_a_mismatched_origin() -> None:
    # An Origin header never carries a trailing slash, so one here would never match.
    settings = _settings(
        HANDOVER_RECEIVER_BASE_URL="https://receiver.freightproof.co.za/",
    )

    origins = settings.cors_allowed_origins

    assert "https://receiver.freightproof.co.za" in origins
    assert "https://receiver.freightproof.co.za/" not in origins


def test_an_origin_listed_explicitly_is_not_duplicated() -> None:
    settings = _settings(
        ALLOWED_ORIGINS=["https://www.freightproof.co.za", _IOS_ORIGIN],
        HANDOVER_RECEIVER_BASE_URL="https://www.freightproof.co.za",
    )

    origins = settings.cors_allowed_origins

    assert origins.count(_IOS_ORIGIN) == 1
    assert origins.count("https://www.freightproof.co.za") == 1


def test_an_empty_receiver_url_adds_no_empty_origin() -> None:
    # An empty string in the allow-list would be a wildcard-shaped footgun, not a no-op.
    settings = _settings(HANDOVER_RECEIVER_BASE_URL="")

    origins = settings.cors_allowed_origins

    assert "" not in origins


def test_the_configured_browser_origins_are_preserved_in_order() -> None:
    settings = _settings(ALLOWED_ORIGINS=["https://a.example.com", "https://b.example.com"])

    origins = settings.cors_allowed_origins

    assert origins[:2] == ["https://a.example.com", "https://b.example.com"]
