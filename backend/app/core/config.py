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
    # Twilio
    # Used to send SMS OTP codes to drivers at trip start/end.
    # -------------------------------------------------------------------------
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_FROM_NUMBER: str

    # -------------------------------------------------------------------------
    # SendGrid
    # Used to email PDF evidence reports to dispatchers and clients.
    # -------------------------------------------------------------------------
    SENDGRID_API_KEY: str
    SENDGRID_FROM_EMAIL: str

    # -------------------------------------------------------------------------
    # Supabase Auth
    # JWT_SECRET: signs all tokens issued by Supabase Auth — used by FastAPI to
    # verify incoming Bearer tokens locally without a network round-trip.
    # Found in Supabase dashboard: Settings → API → JWT Secret.
    # SERVICE_ROLE_KEY: grants full DB + Auth admin access; used server-side
    # only (e.g. creating auth users, setting app_metadata). Never sent to
    # the browser.
    # -------------------------------------------------------------------------
    SUPABASE_JWT_SECRET: str
    SUPABASE_SERVICE_ROLE_KEY: str

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
    PP_API_KEY: str = ""       # Parcel Perfect login email / username
    PP_API_PASSWORD: str = ""  # Parcel Perfect login password (used in MD5 auth flow)
    PP_API_URL: str = ""
    PP_POLL_INTERVAL_SECONDS: int = 60

    # -------------------------------------------------------------------------
    # AWS / S3
    # af-south-1 keeps evidence data in South Africa per POPIA requirements.
    # -------------------------------------------------------------------------
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "af-south-1"
    S3_BUCKET_NAME: str = ""

    # -------------------------------------------------------------------------
    # Runtime config
    # GPS_TOLERANCE_METRES: max deviation from expected gate coordinates before
    # a handshake is flagged as location-mismatched.
    # -------------------------------------------------------------------------
    GPS_TOLERANCE_METRES: int = 50
    DEMO_MODE: bool = False

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
