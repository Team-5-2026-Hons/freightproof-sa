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
# Service names inside infrastructure/docker/docker-compose.load.yml (and CI's aliases).
COMPOSE_DB_HOST = "test-db"
COMPOSE_REDIS_HOST = "test-redis"
DATABASE_NAME = "freightproof_test"
REDIS_DATABASE_PATH = "/0"

# The production default from app/core/config.py (2 retained + 1 overflow). Pinned rather
# than read from Settings, which cannot be imported until configure_environment has run;
# the report records whether it still matches the code default.
POOL_SIZE = 2
MAX_OVERFLOW = 1
POOL_CAPACITY = POOL_SIZE + MAX_OVERFLOW
# Four times the pool's capacity, so every fault wave has requests queued behind it.
FAULT_CONCURRENCY = 12

PROFILES = ("smoke", "ci", "evidence")
HEALTHY = "healthy"
FAULT_SCENARIOS = (
    "pool", "connect", "command", "half_open_command", "idle_ping",
    "cancel", "chat_short", "chat_long", "chat_database",
)
SCENARIO_NAMES = (HEALTHY, *FAULT_SCENARIOS)
CHAT_HOLD_SCENARIOS = frozenset({"chat_short", "chat_long"})
# A bounded sweep from one request at a time up to the fault-wave size.
HEALTHY_CONCURRENCY_LEVELS = (1, 3, 6, FAULT_CONCURRENCY)
DEFAULT_HEALTHY_REQUESTS = 120
DEFAULT_REPETITIONS = 3

# The chat provider waits for a fraction of the pool-wait budget while its request holds a
# connection: the short hold stays below the budget (reads must still succeed), the long
# hold exceeds it (queued reads must hit pool_timeout).
SHORT_PROVIDER_HOLD_FACTOR = 0.25
LONG_PROVIDER_HOLD_FACTOR = 1.25

# S in the testing doc: scheduling plus the fixture's ordinary local queries.
SCHEDULER_ALLOWANCE_SECONDS = 5.0
# How far past its envelope a request may run before the independent watchdog fires.
WATCHDOG_MARGIN_SECONDS = 5.0

# Budgets field -> the app setting it overrides.
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
        # Never include the rejected input: it might contain a real password.
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
    # Override inherited integration settings before app.core.config instantiates Settings.
    # Every external integration is mocked or given a placeholder, so no run can reach
    # Supabase, Hedera, a partner API or a real AI provider.
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
        # Upper bound for a request whose fault hits SQL: pool wait, ping and reconnect, one
        # stalled command, then rollback, close and discard (four cleanup budgets), plus the
        # scheduling allowance. The allowance also covers SQLAlchemy's fixed 2 s close of a
        # discarded connection when the smoke cleanup budget is shorter. Setup waits use this
        # bound too. It fits the small fixture; it is never the API's request deadline.
        return (
            self.pool + 2 * self.connect + 2 * self.command + 4 * self.cleanup
            + SCHEDULER_ALLOWANCE_SECONDS
        )

    def provider_delay(self, scenario: str) -> float:
        factor = LONG_PROVIDER_HOLD_FACTOR if scenario == "chat_long" else SHORT_PROVIDER_HOLD_FACTOR
        return self.pool * factor

    def envelope(self, scenario: str) -> float:
        # Declared before any fault is injected. A failed checkout runs no application SQL,
        # so pool and connect faults get tighter bounds than the general one.
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


# Short fault-test budgets so the whole matrix runs in about a minute. Not deployment values.
SMOKE_BUDGETS = Budgets(connect=0.5, pool=0.5, command=1.0, cleanup=0.5)
# Shared CI hosts need room for twelve healthy reads through three pool slots. Keep
# the same budgets during faults AND recovery, and still require bounded failures:
# no recovery retries, timeout overrides mid-cycle, or accepted recovery 503s.
CI_BUDGETS = Budgets(connect=2.0, pool=3.0, command=2.0, cleanup=1.0)


def budgets_for(profile: str) -> Budgets:
    if profile == "smoke":
        return SMOKE_BUDGETS
    if profile == "ci":
        return CI_BUDGETS
    if profile != "evidence":
        raise ValueError("Unknown load profile")
    # Read code defaults, rather than accidentally measuring a developer's overrides.
    from app.core.config import Settings

    return Budgets(**{
        field: float(Settings.model_fields[setting].default) for field, setting in BUDGET_SETTINGS.items()
    })
