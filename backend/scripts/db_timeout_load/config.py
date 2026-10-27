"""Settings the runner needs before the app is imported: target guard, pool shape, budgets.

Nothing here imports app modules at load time, so the CLI can reject an unsafe target
before app.core.config builds its Settings from the environment.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
COMPOSE_DB_HOST = "test-db"
COMPOSE_REDIS_HOST = "test-redis"
DATABASE_NAME = "freightproof_test"
REDIS_DATABASE_PATH = "/0"

POOL_SIZE = 2
MAX_OVERFLOW = 1
POOL_CAPACITY = POOL_SIZE + MAX_OVERFLOW
FAULT_CONCURRENCY = 12

PROFILES = ("smoke", "ci", "evidence")
HEALTHY = "healthy"
FAULT_SCENARIOS = (
    "pool", "connect", "command", "half_open_command", "idle_ping",
    "cancel", "chat_short", "chat_long", "chat_database",
)
SCENARIO_NAMES = (HEALTHY, *FAULT_SCENARIOS)
CHAT_HOLD_SCENARIOS = frozenset({"chat_short", "chat_long"})
HEALTHY_CONCURRENCY_LEVELS = (1, 3, 6, FAULT_CONCURRENCY)
DEFAULT_HEALTHY_REQUESTS = 120
DEFAULT_REPETITIONS = 3

SHORT_PROVIDER_HOLD_FACTOR = 0.25
LONG_PROVIDER_HOLD_FACTOR = 1.25

SCHEDULER_ALLOWANCE_SECONDS = 5.0
WATCHDOG_MARGIN_SECONDS = 5.0

BUDGET_SETTINGS = {
    "connect": "DB_CONNECT_TIMEOUT_SECONDS",
    "pool": "DB_POOL_TIMEOUT_SECONDS",
    "command": "DB_COMMAND_TIMEOUT_SECONDS",
    "cleanup": "DB_CLEANUP_TIMEOUT_SECONDS",
}


def database_target(value: str) -> URL:
    try:
        url = make_url(value)
    except (ArgumentError, ValueError):
        raise ValueError("An explicit local TEST_DATABASE_URL is required") from None
    if (
        url.drivername != "postgresql+asyncpg"
        or url.host not in LOCAL_HOSTS | {COMPOSE_DB_HOST}
        or url.database != DATABASE_NAME
        or dict(url.query) not in ({}, {"ssl": "disable"})
    ):
        raise ValueError("Load tests require a local freightproof_test database without connection overrides")
    return url


def redis_target(value: str) -> str:
    try:
        url = urlsplit(value)
        valid = (
            url.scheme == "redis"
            and url.hostname in LOCAL_HOSTS | {COMPOSE_REDIS_HOST}
            and url.path == REDIS_DATABASE_PATH
            and not url.query
            and not url.fragment
            and url.username is None
            and url.password is None
            and url.port is not None
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Load tests require an explicit local Redis /0 URL")
    return value


def configure_environment(database: str, redis: str) -> None:
    database_target(database)
    redis_target(redis)
    if Path(".env").exists():
        raise ValueError("Run the load test in the isolated image, with no .env in its working directory")
    os.environ.update({
        "DATABASE_URL": database,
        "TEST_DATABASE_URL": database,
        "REDIS_URL": redis,
        "ENVIRONMENT": "development",
        "RATE_LIMIT_ENABLED": "false",
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_ANON_KEY": "test-anon-key",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        "HEDERA_ACCOUNT_ID": "0.0.0",
        "HEDERA_PRIVATE_KEY": "test-hedera-key",
        "IDVS_USE_MOCK": "true",
        "PULSE_USE_MOCK": "true",
        "PP_USE_MOCK": "true",
        "SCAN_FEED_USE_MOCK": "true",
        "AI_CHAT_ENABLED": "true",
        "AI_CHAT_PROVIDER": "gemini",
        "GEMINI_API_KEY": "test-key",
        "AI_CHAT_MODEL": "gemini-3.8-flash",
        "AI_CHAT_MONTHLY_BUDGET_USD": "20",
        "DRIVER_SUBSTITUTIONS_ENABLED": "true",
        "DEV_PANEL_ENABLED": "false",
        "DB_POOL_SIZE": str(POOL_SIZE),
        "DB_MAX_OVERFLOW": str(MAX_OVERFLOW),
    })


@dataclass(frozen=True)
class Budgets:
    connect: float
    pool: float
    command: float
    cleanup: float

    @property
    def general_envelope(self) -> float:
        return (
            self.pool + 2 * self.connect + 2 * self.command + 4 * self.cleanup
            + SCHEDULER_ALLOWANCE_SECONDS
        )

    def provider_delay(self, scenario: str) -> float:
        factor = LONG_PROVIDER_HOLD_FACTOR if scenario == "chat_long" else SHORT_PROVIDER_HOLD_FACTOR
        return self.pool * factor

    def envelope(self, scenario: str) -> float:
        if scenario == "pool":
            return self.pool + 2 * self.cleanup + SCHEDULER_ALLOWANCE_SECONDS
        if scenario == "connect":
            return self.pool + self.connect + 2 * self.cleanup + SCHEDULER_ALLOWANCE_SECONDS
        if scenario in CHAT_HOLD_SCENARIOS:
            return self.general_envelope + self.provider_delay(scenario)
        return self.general_envelope

    def request_watchdog(self, scenario: str) -> float:
        return self.envelope(scenario) + WATCHDOG_MARGIN_SECONDS

    def settings(self) -> dict[str, float]:
        return {setting: getattr(self, field) for field, setting in BUDGET_SETTINGS.items()}


SMOKE_BUDGETS = Budgets(connect=0.5, pool=0.5, command=1.0, cleanup=0.5)
CI_BUDGETS = Budgets(connect=2.0, pool=3.0, command=2.0, cleanup=1.0)


def budgets_for(profile: str) -> Budgets:
    if profile == "smoke":
        return SMOKE_BUDGETS
    if profile == "ci":
        return CI_BUDGETS
    if profile != "evidence":
        raise ValueError("Unknown load profile")
    from app.core.config import Settings

    return Budgets(**{
        field: float(Settings.model_fields[setting].default) for field, setting in BUDGET_SETTINGS.items()
    })
