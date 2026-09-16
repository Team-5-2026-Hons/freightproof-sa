"""Application settings loaded from environment variables or backend/.env."""

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


# Native driver app origins (iOS, Android); kept outside Settings so no .env can drop them.
_NATIVE_APP_ORIGINS = ("capacitor://localhost", "https://localhost")


class Settings(BaseSettings):
    # Must use the asyncpg driver: postgresql+asyncpg://...
    DATABASE_URL: str

    # Supabase's pooler caps the project at 15 clients; kept small so four devs fit.
    DB_POOL_SIZE: int = 2
    DB_MAX_OVERFLOW: int = 1

    # Empty skips integration tests.
    TEST_DATABASE_URL: str = ""

    REDIS_URL: str

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str

    HEDERA_ACCOUNT_ID: str
    HEDERA_PRIVATE_KEY: str
    HEDERA_NETWORK: str = "testnet"
    HEDERA_TOPIC_ID: str = ""

    # The Hedera SDK has no built-in timeout.
    HEDERA_SUBMIT_TIMEOUT_SECONDS: float = 15.0

    # Twilio and SendGrid are not implemented yet.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = ""

    # Full admin access: server-side only, never sent to a browser.
    SUPABASE_SERVICE_ROLE_KEY: str

    # Signed URLs are unauthenticated while valid, so keep them short-lived.
    EVIDENCE_SIGNED_URL_TTL_SECONDS: int = 300

    # Mocks default on so a new dev environment works without partner credentials.
    IDVS_USE_MOCK: bool = True
    IDVS_API_KEY: str = ""
    IDVS_API_URL: str = ""
    PULSE_USE_MOCK: bool = True
    PULSE_API_KEY: str = ""
    PULSE_API_URL: str = ""
    # Covers tracker refresh cadence but rejects a replayed offline handshake.
    PULSIT_CORROBORATION_MAX_SKEW_SECONDS: int = 300
    PP_USE_MOCK: bool = True
    PP_API_KEY: str = ""  # login username
    PP_API_PASSWORD: str = ""
    PP_API_TOKEN: str = ""  # skips the salt/MD5 login when set
    PP_API_URL: str = ""
    PP_POLL_INTERVAL_SECONDS: int = 60

    # No real scan feed exists yet, so this stays True.
    SCAN_FEED_USE_MOCK: bool = True

    GPS_TOLERANCE_METRES: int = 50

    # Driver-vs-truck proximity check (Task 4, trip-location-timeline story):
    # independent corroboration that the driver's OWN PHONE fix and the vehicle's
    # Pulsit tracker fix describe the same place at roughly the same time. This is
    # a different question from GPS_TOLERANCE_METRES above (is the TRUCK inside its
    # precinct?) — a truck can be correctly inside its geofence while the driver's
    # phone sits genuinely metres away. See orchestration/proximity_service.py.
    # Four independent settings rather than reusing GPS_TOLERANCE_METRES /
    # PULSIT_CORROBORATION_MAX_SKEW_SECONDS, so a future change to either of those
    # never silently drags this unrelated policy along with it.
    DRIVER_TRUCK_MAX_SEPARATION_METRES: float = 100.0
    DRIVER_TRUCK_MAX_FIX_AGE_SECONDS: int = 60
    DRIVER_TRUCK_MAX_SKEW_SECONDS: int = 30
    DRIVER_TRUCK_MAX_PHONE_ACCURACY_METRES: float = 50.0

    DEMO_MODE: bool = False

    # Sole gate for the dev panel: the demo deploy runs as production but still needs it.
    DEV_PANEL_ENABLED: bool = False

    # SAST has no DST, so a fixed offset is exact for the operating-day boundary.
    OPERATIONS_UTC_OFFSET_HOURS: int = 2

    # Enforced in auth/sessions.py; Supabase tokens otherwise refresh forever.
    SESSION_IDLE_TIMEOUT_MINUTES: int = 10

    # Token lifetime, separate from how often the QR on screen rotates.
    HANDOVER_TOKEN_EXPIRY_MINUTES: int = 10

    # Limits how long a photo of the QR stays usable.
    HANDOVER_ROTATION_SECONDS: int = 20

    # Encoded in the QR, so it must be reachable from mobile data when deployed.
    HANDOVER_RECEIVER_BASE_URL: str = "http://localhost:3002"

    # Server-side so a client can't downgrade the verification workflow.
    IDVS_WORKFLOW_ID: str = ""

    # The only protection against forged decisions on the public webhook.
    IDVS_WEBHOOK_SECRET: str = ""

    # Didit free-tier cap; past it handover drops to a lower evidence tier instead of billing.
    IDVS_MONTHLY_SESSION_LIMIT: int = 500

    # Short so a slow vendor degrades the tier instead of holding up the handover.
    IDVS_SESSION_TIMEOUT_SECONDS: int = 10

    IDVS_DECISION_POLL_SECONDS: int = 90

    # ID and selfie checks can outlast the handover token, so it is extended once.
    IDVS_TOKEN_EXTENSION_MINUTES: int = 10

    # Catches closed tabs and dead phones that the browser poll never reported.
    IDVS_ABANDON_AFTER_SECONDS: int = 1800
    IDVS_SWEEP_INTERVAL_SECONDS: int = 300

    # Never disable when deployed: it is the only cap on Hedera and PP spend.
    RATE_LIMIT_ENABLED: bool = True

    # Only enable behind a proxy that overwrites X-Forwarded-For, or IPs can be forged.
    RATE_LIMIT_TRUST_PROXY_HEADERS: bool = False

    ENVIRONMENT: str = "development"

    # Not VERSION, which build tools often set.
    APP_VERSION: str = "0.1.0"

    # Probes run concurrently, so this is roughly /health's worst-case latency.
    HEALTH_PROBE_TIMEOUT_SECONDS: float = 2.0
    # Native app origins are added separately in cors_allowed_origins.
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    @property
    def cors_allowed_origins(self) -> List[str]:
        """Return ALLOWED_ORIGINS plus the native app and receiver origins.

        Added here because an ALLOWED_ORIGINS env var replaces the whole default list.
        """
        origins = list(self.ALLOWED_ORIGINS)
        receiver_origin = self.HANDOVER_RECEIVER_BASE_URL.rstrip("/")

        for required in (*_NATIVE_APP_ORIGINS, receiver_origin):
            if required and required not in origins:
                origins.append(required)

        return origins

    # Ignore stale .env keys left behind by renamed fields.
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
