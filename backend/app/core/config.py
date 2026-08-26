# FreightProof SA — centralised application settings.
# All values are read from environment variables (or backend/.env in local dev).
# Never import os.environ directly in the app — always go through `settings`.

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # -------------------------------------------------------------------------
    # Database
    # asyncpg driver is required for SQLAlchemy's async engine.
    # Format: postgresql+asyncpg://user:password@host:port/dbname
    # -------------------------------------------------------------------------
    DATABASE_URL: str

    # Separate async PostgreSQL URL for integration tests.
    # Must point at a throwaway database — tests create and drop tables.
    # Leave empty to skip integration tests automatically.
    TEST_DATABASE_URL: str = ""

    # -------------------------------------------------------------------------
    # Redis
    # Used by Celery as both the broker and result backend, and directly
    # for any ephemeral caching (e.g. rate-limit counters).
    # -------------------------------------------------------------------------
    REDIS_URL: str

    # -------------------------------------------------------------------------
    # Supabase
    # Used in development only for storage and Auth helpers. In production,
    # DATABASE_URL points to the same Postgres instance Supabase manages.
    # -------------------------------------------------------------------------
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str

    # -------------------------------------------------------------------------
    # Hedera Hashgraph
    # HCS (Hedera Consensus Service) is used to anchor evidence hashes.
    # HEDERA_NETWORK should be "testnet" in dev and "mainnet" in production.
    # HEDERA_TOPIC_ID is created by the FP-001 spike; empty until that spike lands.
    # -------------------------------------------------------------------------
    HEDERA_ACCOUNT_ID: str
    HEDERA_PRIVATE_KEY: str
    HEDERA_NETWORK: str = "testnet"
    HEDERA_TOPIC_ID: str = ""

    # Hard ceiling on the submit_hash() SDK call (a real network round-trip with no
    # built-in timeout). Typical latency is ~4-6s; this bounds the worst case so a
    # stalled Hedera call fails fast instead of hanging the request indefinitely.
    HEDERA_SUBMIT_TIMEOUT_SECONDS: float = 15.0

    # -------------------------------------------------------------------------
    # Twilio — NOT YET IMPLEMENTED (no client code). Optional until the SMS
    # integration lands; required-ness should return with the feature.
    # -------------------------------------------------------------------------
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # -------------------------------------------------------------------------
    # SendGrid — NOT YET IMPLEMENTED (no client code). Same deal.
    # -------------------------------------------------------------------------
    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = ""

    # -------------------------------------------------------------------------
    # Supabase Auth
    # SERVICE_ROLE_KEY: grants full DB + Auth admin access; used server-side
    # only (e.g. creating auth users, setting app_metadata). Never sent to
    # the browser.
    # -------------------------------------------------------------------------
    SUPABASE_SERVICE_ROLE_KEY: str

    # Evidence images are fetched by the dispatcher's browser straight from Storage via a
    # short-lived signed URL. Kept deliberately short: for its lifetime the URL is a bearer
    # capability that carries no further auth check.
    EVIDENCE_SIGNED_URL_TTL_SECONDS: int = 300

    # -------------------------------------------------------------------------
    # Integration mock toggles
    # True = use local mock, False = call real external API.
    # Defaults to True so new dev environments work without partner credentials.
    # -------------------------------------------------------------------------
    IDVS_USE_MOCK: bool = True
    IDVS_API_KEY: str = ""
    IDVS_API_URL: str = ""
    PULSE_USE_MOCK: bool = True
    PULSE_API_KEY: str = ""
    PULSE_API_URL: str = ""
    PP_USE_MOCK: bool = True
    PP_API_KEY: str = ""        # Parcel Perfect login email / username
    PP_API_PASSWORD: str = ""   # Parcel Perfect login password (used in MD5 auth flow)
    PP_API_TOKEN: str = ""      # Pre-issued token (skips salt/MD5 flow when set)
    PP_API_URL: str = ""
    PP_POLL_INTERVAL_SECONDS: int = 60

    # Warehouse scan feed. True = MockScanFeed (Redis-backed, driven by the dev
    # trigger panel), False = a real WMS/PP-depot feed. Mirrors PP_USE_MOCK.
    # No real implementation exists yet: PP exposes no scan endpoint and we have
    # no depot account, so this stays True until one lands.
    SCAN_FEED_USE_MOCK: bool = True

    # -------------------------------------------------------------------------
    # Runtime config
    # -------------------------------------------------------------------------
    # Used by the (upcoming) H1/H4 gate geofence check — see feature/gps-warehouse-geofencing.
    GPS_TOLERANCE_METRES: int = 50
    DEMO_MODE: bool = False

    # Dev trigger panel. Registers a router that can fire scans, PP lifecycle changes and
    # exceptions. Defaults to False so the panel is absent unless deliberately switched
    # on. This is now the SOLE condition: it used to be paired with ENVIRONMENT !=
    # "production", but the deployed demo runs as production (to keep /docs unpublished)
    # and still needs the panel — see api/v1/endpoints/dev_triggers.dev_panel_enabled for
    # the full reasoning. Setting this True on an internet-reachable host publishes
    # endpoints that fabricate evidence events; they require a dispatcher token and refuse
    # unless the integrations are mocked, but nothing else stands behind them now. Turn it
    # off when the demo window closes.
    DEV_PANEL_ENABLED: bool = False

    # The operating day boundary used to decide whether a driver is activating a trip
    # before its scheduled date (orchestration/phase_service.py). "Same calendar day"
    # is meaningless without a timezone: a 06:00 SAST departure is 04:00 UTC, and a
    # 01:00 SAST departure is the PREVIOUS day in UTC, so comparing UTC dates would
    # reject a driver starting a legitimately-scheduled early-morning trip.
    #
    # A fixed offset rather than a zoneinfo key on purpose: South African Standard Time
    # is permanently UTC+2 and has never observed daylight saving, so an offset is exact
    # for every date this system will see — and it keeps a tz database out of the
    # container image. The moment FreightProof runs anywhere that DOES shift, this must
    # become a real IANA zone name resolved through zoneinfo, with tzdata added to
    # requirements.txt.
    OPERATIONS_UTC_OFFSET_HOURS: int = 2

    # -------------------------------------------------------------------------
    # Sessions
    # -------------------------------------------------------------------------
    # How long a session may sit idle before the API stops accepting it. Supabase
    # issues the tokens and refreshes them indefinitely, so without this a signed-in
    # handset or an unattended dispatcher laptop stays authenticated forever. Enforced
    # server-side in auth/sessions.py against a last-seen timestamp, and mirrored by a
    # client-side timer in both frontends so the user is actually signed out rather than
    # discovering it on their next request.
    SESSION_IDLE_TIMEOUT_MINUTES: int = 10

    # -------------------------------------------------------------------------
    # Rate limiting (core/rate_limit.py; budgets live in core/limits.py)
    # -------------------------------------------------------------------------
    # Off switch for local development and tests. Never set False in a deployed
    # environment — it removes the only volume control on endpoints that spend Hedera
    # and Parcel Perfect quota.
    RATE_LIMIT_ENABLED: bool = True

    # Set True ONLY when the app sits behind a reverse proxy or load balancer that
    # overwrites X-Forwarded-For. Left False, the socket peer address is used instead.
    # Trusting the header without such a proxy in front lets any caller forge a fresh
    # client IP per request and hand themselves an unlimited budget.
    RATE_LIMIT_TRUST_PROXY_HEADERS: bool = False

    # -------------------------------------------------------------------------
    # Application
    # ALLOWED_ORIGINS: restrict CORS in production to real domains only.
    # The defaults cover the local dev ports for dispatcher and driver-pwa.
    # -------------------------------------------------------------------------
    ENVIRONMENT: str = "development"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    # model_config replaces the deprecated class Config syntax.
    # In local dev, pydantic-settings reads from backend/.env automatically.
    # In Docker / production, values come from the container's environment and
    # env_file is effectively ignored (the file won't be present in the image).
    # extra="ignore" prevents validation errors if .env contains keys that are
    # no longer in this model (e.g. after a config field is removed or renamed).
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


# Single shared instance — import this wherever config values are needed.
settings = Settings()
