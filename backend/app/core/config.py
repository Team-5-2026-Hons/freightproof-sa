"""Application settings loaded from environment variables or backend/.env."""

from typing import Any, List

from pydantic import Field, field_validator
from pydantic_core import PydanticUseDefault
from pydantic_settings import BaseSettings, SettingsConfigDict


_NATIVE_APP_ORIGINS = ("capacitor://localhost", "https://localhost")


class Settings(BaseSettings):
    DATABASE_URL: str

    DB_POOL_SIZE: int = 2
    DB_MAX_OVERFLOW: int = 1

    DB_CONNECT_TIMEOUT_SECONDS: float = Field(default=10.0, gt=0, allow_inf_nan=False)
    DB_POOL_TIMEOUT_SECONDS: float = Field(default=20.0, gt=0, allow_inf_nan=False)
    DB_COMMAND_TIMEOUT_SECONDS: float = Field(default=30.0, gt=0, allow_inf_nan=False)
    DB_CLEANUP_TIMEOUT_SECONDS: float = Field(default=5.0, gt=0, allow_inf_nan=False)

    TEST_DATABASE_URL: str = ""

    REDIS_URL: str

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str

    HEDERA_ACCOUNT_ID: str
    HEDERA_PRIVATE_KEY: str
    HEDERA_NETWORK: str = "testnet"
    HEDERA_TOPIC_ID: str = ""

    HEDERA_SUBMIT_TIMEOUT_SECONDS: float = 15.0

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = ""
    SENDGRID_API_URL: str = "https://api.sendgrid.com"
    SENDGRID_TIMEOUT_SECONDS: float = 10.0

    SUPABASE_SERVICE_ROLE_KEY: str

    EVIDENCE_SIGNED_URL_TTL_SECONDS: int = 300

    IDVS_USE_MOCK: bool = True
    IDVS_API_KEY: str = ""
    IDVS_API_URL: str = ""
    PULSE_USE_MOCK: bool = True
    PULSE_API_KEY: str = ""
    PULSE_API_URL: str = ""
    PULSIT_CORROBORATION_MAX_SKEW_SECONDS: int = 300
    PP_USE_MOCK: bool = True
    PP_API_KEY: str = ""
    PP_API_PASSWORD: str = ""
    PP_API_TOKEN: str = ""
    PP_API_URL: str = ""
    PP_POLL_INTERVAL_SECONDS: int = 60

    SCAN_FEED_USE_MOCK: bool = True

    ORS_API_KEY: str = ""
    ORS_API_URL: str = "https://api.openrouteservice.org"
    ORS_TIMEOUT_SECONDS: float = 15.0
    ORS_SNAP_RADIUS_METRES: int = 2000
    TRIP_ROUTE_CACHE_TTL_SECONDS: int = 86400

    AI_CHAT_ENABLED: bool = False
    AI_CHAT_PROVIDER: str = "gemini"
    AI_CHAT_MODEL: str = "gemini-3.8-flash"
    GEMINI_API_KEY: str = ""
    GEMINI_API_URL: str = "https://generativelanguage.googleapis.com/v1beta"
    ANTHROPIC_API_KEY: str = ""
    AI_CHAT_MONTHLY_BUDGET_USD: float = 20.0
    ASSISTANT_ENABLED: bool = False

    GPS_TOLERANCE_METRES: int = 50

    DRIVER_TRUCK_MAX_SEPARATION_METRES: float = 100.0
    DRIVER_TRUCK_MAX_FIX_AGE_SECONDS: int = 60
    DRIVER_TRUCK_MAX_SKEW_SECONDS: int = 30
    DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES: float = 50.0

    TRAILER_HORSE_MAX_SEPARATION_METRES: float = 500.0

    DEMO_MODE: bool = False

    DRIVER_SUBSTITUTIONS_ENABLED: bool = False

    INCIDENT_DOCUMENTS_ENABLED: bool = False

    DEV_PANEL_ENABLED: bool = False

    OPERATIONS_UTC_OFFSET_HOURS: int = 2

    SESSION_IDLE_TIMEOUT_MINUTES: int = 60

    HANDOVER_TOKEN_EXPIRY_MINUTES: int = 10

    HANDOVER_ROTATION_SECONDS: int = 20

    HANDOVER_RECEIVER_BASE_URL: str = "http://localhost:3002"

    AUDIT_PACK_PORTAL_BASE_URL: str = "http://localhost:3003"

    IDVS_WORKFLOW_ID: str = ""

    IDVS_WEBHOOK_SECRET: str = ""

    IDVS_MONTHLY_SESSION_LIMIT: int = 500

    IDVS_SESSION_TIMEOUT_SECONDS: int = 10

    IDVS_DECISION_POLL_SECONDS: int = 90

    IDVS_TOKEN_EXTENSION_MINUTES: int = 10

    IDVS_ABANDON_AFTER_SECONDS: int = 1800
    IDVS_SWEEP_INTERVAL_SECONDS: int = 300

    RATE_LIMIT_ENABLED: bool = True

    RATE_LIMIT_TRUST_PROXY_HEADERS: bool = False

    CLIENT_IP_HEADER: str = "x-forwarded-for"

    FLY_APP_NAME: str = ""

    ENVIRONMENT: str = "development"

    APP_VERSION: str = "0.1.0"

    HEALTH_PROBE_TIMEOUT_SECONDS: float = 2.0
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    @field_validator(
        "DB_CONNECT_TIMEOUT_SECONDS", "DB_POOL_TIMEOUT_SECONDS",
        "DB_COMMAND_TIMEOUT_SECONDS", "DB_CLEANUP_TIMEOUT_SECONDS", mode="before",
    )
    @classmethod
    def _blank_database_timeout_uses_default(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            raise PydanticUseDefault()
        return value

    @field_validator("DRIVER_SUBSTITUTIONS_ENABLED", "INCIDENT_DOCUMENTS_ENABLED", mode="before")
    @classmethod
    def _blank_substitutions_flag_is_false(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return False
        return value

    @property
    def cors_allowed_origins(self) -> List[str]:
        """Return ALLOWED_ORIGINS plus the native app, receiver and audit-pack portal origins.

        Added here because an ALLOWED_ORIGINS env var replaces the whole default list.
        """
        origins = list(self.ALLOWED_ORIGINS)
        receiver_origin = self.HANDOVER_RECEIVER_BASE_URL.rstrip("/")
        portal_origin = self.AUDIT_PACK_PORTAL_BASE_URL.rstrip("/")

        for required in (*_NATIVE_APP_ORIGINS, receiver_origin, portal_origin):
            if required and required not in origins:
                origins.append(required)

        return origins

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
