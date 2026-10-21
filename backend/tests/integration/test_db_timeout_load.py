"""FP-299: one standalone load run repeats four fault/recovery scenarios, three times each, on isolated PostgreSQL."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from scripts.db_timeout_load.config import (
    FAULT_CONCURRENCY, POOL_SIZE, WATCHDOG_MARGIN_SECONDS, database_target, redis_target,
)
from scripts.db_timeout_load.world import SCHEMA_PREFIX

# The cheapest faults that cover a failed checkout, a lock-bound command (whose statements
# PostgreSQL must cancel), a half-open socket mid-command and a failed pre-ping; the full
# matrix belongs to the documented evidence run.
EXPECTED_REASONS = {
    "pool": "pool_timeout", "command": "command_timeout",
    "half_open_command": "command_timeout", "idle_ping": "checkout_timeout",
}
REPETITIONS = 3
# One subprocess pays the app import and source hash once (a passing run takes about 30 s).
# The bound fails a hung run instead of stalling CI.
SUBPROCESS_TIMEOUT_SECONDS = 120
# Deliberately the local default, never a developer's .env value; CI sets REDIS_URL.
LOCAL_REDIS_URL = "redis://localhost:6379/0"
BACKEND_DIR = Path(__file__).resolve().parents[2]
LOAD_SCHEMAS = text("SELECT nspname FROM pg_namespace WHERE starts_with(nspname, :prefix) ORDER BY nspname")


async def load_schemas(engine: AsyncEngine) -> list[str]:
    async with engine.connect() as connection:
        return list((await connection.scalars(LOAD_SCHEMAS, {"prefix": SCHEMA_PREFIX})).all())


def run_load(output: Path, database: str, redis: str) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, "-m", "scripts.load_db_timeouts", "--profile", "smoke",
               "--repetitions", str(REPETITIONS), "--output", str(output), "--revision", "pytest-subprocess"]
    for scenario in EXPECTED_REASONS:
        command += ["--scenario", scenario]
    # A separate interpreter imports and configures the app itself, as a real run does,
    # instead of inheriting pytest's overrides.
    environment = {**os.environ, "TEST_DATABASE_URL": database, "REDIS_URL": redis, "PYTHONPATH": str(BACKEND_DIR)}
    try:
        return subprocess.run(command, env=environment, cwd=output.parent, text=True, capture_output=True,
                              timeout=SUBPROCESS_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        # repr: the stub types captured output as str or bytes, even with text=True.
        pytest.fail(f"Load run exceeded {SUBPROCESS_TIMEOUT_SECONDS} s\n{exc.stdout!r}\n{exc.stderr!r}")


async def test_standalone_load_records_failure_recovery_and_removes_its_schema(tmp_path: Path) -> None:
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL required")
    database = settings.TEST_DATABASE_URL
    redis = os.environ.get("REDIS_URL", LOCAL_REDIS_URL)
    database_target(database)
    redis_target(redis)
    engine = create_async_engine(database, poolclass=NullPool)
    output = tmp_path / "load.json"
    try:
        before = await load_schemas(engine)

        result = await asyncio.to_thread(run_load, output, database, redis)

        assert output.exists(), (result.returncode, result.stdout, result.stderr)
        report = json.loads(output.read_text())
        assert result.returncode == 0, ([cycle["failures"] for cycle in report.get("results", [])], result.stderr)
        assert report["passed"] is True
        assert [cycle["scenario"] for cycle in report["results"]] == [
            scenario for scenario in EXPECTED_REASONS for _ in range(REPETITIONS)
        ]
        for cycle in report["results"]:
            assert cycle["load"]["database_reasons"].get(EXPECTED_REASONS[cycle["scenario"]], 0) > 0, cycle["scenario"]
            assert cycle["load"]["attempts"] == FAULT_CONCURRENCY
            assert cycle["watchdog_seconds"] == cycle["envelope_seconds"] + WATCHDOG_MARGIN_SECONDS
            assert cycle["recovery"]["reads"]["statuses"] == {"200": FAULT_CONCURRENCY}
            assert cycle["recovery"]["mutation"]["statuses"] == {"200": 1}
            assert cycle["recovery"]["mutation_persisted"] is True
            assert cycle["pool_before_recovery"]["final_checked_out"] == 0
            assert cycle["pool_cumulative"]["final_checked_out"] == 0
            assert cycle["settled_tasks"]["unexpected_tasks"] == 0
            assert cycle["settled_tasks"]["relay_tasks"] <= POOL_SIZE
        assert await load_schemas(engine) == before
        assert "postgresql+asyncpg://" not in output.read_text()
    finally:
        await engine.dispose()
