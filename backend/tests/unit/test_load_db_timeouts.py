"""FP-299 must report failures honestly and reject non-disposable targets before app setup."""

import asyncio
import json
import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient, MockTransport, Request, Response
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db.errors import DATABASE_UNAVAILABLE_DETAIL
from scripts import load_db_timeouts
from scripts.db_timeout_load.config import (
    FAULT_SCENARIOS, POOL_SIZE, SCHEDULER_ALLOWANCE_SECONDS, SMOKE_BUDGETS, WATCHDOG_MARGIN_SECONDS, Budgets,
    budgets_for, configure_environment, database_target, redis_target,
)
from scripts.db_timeout_load.metrics import (
    DATABASE_UNAVAILABLE_LOG_PREFIX, FailureLog, RequestSpec, Sample, distribution, measure, request_failures,
    successful_payload, summarize,
)
from scripts.db_timeout_load.scenarios import SCENARIOS
from scripts.db_timeout_load.world import use_schema

LOCAL_DATABASE = "postgresql+asyncpg://postgres:test@localhost:5433/freightproof_test"
LOCAL_REDIS = "redis://localhost:6379/0"
DATABASE_503 = {"detail": DATABASE_UNAVAILABLE_DETAIL}


async def measured(transport: MockTransport, spec: RequestSpec, watchdog: float = 1) -> Sample:
    samples: list[Sample] = []
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await measure(client, spec, samples, watchdog)
    return samples[0]


@pytest.mark.parametrize("value", [
    "", "not-a-url", "postgresql+asyncpg://postgres:private@db.example.com/freightproof_test",
    "postgresql+asyncpg://postgres:private@localhost/postgres",
    LOCAL_DATABASE + "?host=db.example.com", LOCAL_DATABASE + "?database=postgres",
    LOCAL_DATABASE + "?server_settings=unsafe", "sqlite:///freightproof_test",
])
def test_target_guard_rejects_missing_remote_and_redirected_databases(value: str) -> None:
    with pytest.raises(ValueError) as error:
        database_target(value)

    assert "private" not in str(error.value)
    assert "db.example.com" not in str(error.value)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]", "test-db"])
def test_target_guard_accepts_only_explicit_local_test_database(host: str) -> None:
    url = database_target(f"postgresql+asyncpg://postgres:test@{host}:5432/freightproof_test?ssl=disable")

    assert url.database == "freightproof_test"


@pytest.mark.parametrize("value", ["", "redis://shared.example.com:6379/0", "redis://localhost:6379/1",
                                   "redis://localhost:6379/0?host=shared", "redis://user:private@localhost:6379/0"])
def test_redis_guard_rejects_other_targets(value: str) -> None:
    with pytest.raises(ValueError) as error:
        redis_target(value)

    assert "private" not in str(error.value)


def test_environment_guard_rejects_working_directory_with_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").touch()

    with pytest.raises(ValueError, match="isolated image"):
        configure_environment(LOCAL_DATABASE, LOCAL_REDIS)


def test_configure_environment_overrides_inherited_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    inherited = {"DATABASE_URL": "postgresql+asyncpg://shared:secret@db.example.com/shared"}

    with patch.dict(os.environ, inherited):
        configure_environment(LOCAL_DATABASE, LOCAL_REDIS)
        environment = dict(os.environ)

    assert environment["DATABASE_URL"] == LOCAL_DATABASE
    assert environment["REDIS_URL"] == LOCAL_REDIS
    assert environment["RATE_LIMIT_ENABLED"] == "false"
    assert environment["PULSE_USE_MOCK"] == "true"
    assert environment["DB_POOL_SIZE"] == str(POOL_SIZE)


def test_envelopes_match_the_predeclared_formulas() -> None:
    budgets = Budgets(connect=1, pool=2, command=3, cleanup=4)
    general = 2 + 2 * 1 + 2 * 3 + 4 * 4 + SCHEDULER_ALLOWANCE_SECONDS

    envelopes = {scenario: budgets.envelope(scenario) for scenario in ("pool", "connect", "command", "chat_short", "chat_long")}

    assert envelopes == {
        "pool": 2 + 2 * 4 + SCHEDULER_ALLOWANCE_SECONDS,
        "connect": 2 + 1 + 2 * 4 + SCHEDULER_ALLOWANCE_SECONDS,
        "command": general,
        "chat_short": general + 0.25 * 2,
        "chat_long": general + 1.25 * 2,
    }
    assert budgets.request_watchdog("pool") == envelopes["pool"] + WATCHDOG_MARGIN_SECONDS


def test_evidence_profile_measures_code_defaults_and_unknown_profiles_are_rejected() -> None:
    evidence = budgets_for("evidence")

    assert evidence.settings() == {name: float(Settings.model_fields[name].default) for name in evidence.settings()}
    assert budgets_for("smoke") == SMOKE_BUDGETS
    with pytest.raises(ValueError, match="Unknown load profile"):
        budgets_for("production")


def test_scenario_names_match_the_registered_scenarios() -> None:
    assert list(SCENARIOS) == list(FAULT_SCENARIOS)


@pytest.mark.parametrize("schema", ["public", "fp299_", "fp299_x;drop schema public"])
def test_load_schema_guard_rejects_other_schemas(schema: str) -> None:
    engine = create_async_engine(LOCAL_DATABASE)

    with pytest.raises(ValueError, match="Invalid load-test schema"):
        use_schema(engine, schema)


@pytest.mark.parametrize(("response", "expected", "valid"), [
    ({"id": "a", "extra": 1}, {"id": "a"}, True),
    ({"id": "b"}, {"id": "a"}, False),
    ([{"id": "b"}, {"id": "a"}], [{"id": "a"}], True),
    ([{"id": "b"}], [{"id": "a"}], False),
    ({"id": "a"}, [{"id": "a"}], False),
    ([], None, True),
])
def test_successful_payload_requires_the_seeded_records(response: object, expected: object, valid: bool) -> None:
    assert successful_payload(response, expected) is valid


def test_summarize_counts_every_attempt_by_status_and_reason() -> None:
    samples = [Sample("read", elapsed_ms=1, outcome="http", status=200, valid_success=True),
               Sample("read", elapsed_ms=20_000, outcome="http", status=503, database_failure=True,
                      reason="pool_timeout", operation="checkout"),
               Sample("read", elapsed_ms=100, outcome="http", status=500)]

    result = summarize(samples, 21)

    assert result["attempts"] == 3
    assert result["statuses"] == {"200": 1, "503": 1, "500": 1}
    assert result["database_reasons"] == {"pool_timeout": 1}
    assert result["latency_ms"] == {
        "200": distribution([1]), "500": distribution([100]), "pool_timeout": distribution([20_000]),
    }


def test_distribution_uses_nearest_rank_percentiles() -> None:
    result = distribution([6, 1, 5, 2, 4, 3])

    assert result == {"count": 6, "min": 1, "max": 6, "p50": 3, "p95": 6, "p99": 6}
    assert distribution([]) == {"count": 0}


def test_request_failures_rejects_unexpected_statuses() -> None:
    samples = [Sample("read", outcome="http", status=200, valid_success=True),
               Sample("read", outcome="http", status=500)]

    failures = request_failures(samples, 2)

    assert failures == ["Unexpected read outcome: http/500/None"]


async def test_successful_read_must_return_the_expected_record() -> None:
    transport = MockTransport(lambda request: Response(200, json=[{"id": "other"}]))

    sample = await measured(transport, RequestSpec("read", "/read", expected=[{"id": "seeded"}]))

    assert sample.status == 200
    assert not sample.valid_success
    assert request_failures([sample], 1) == ["Unexpected read outcome: http/200/None"]


async def test_non_json_response_is_an_error_not_a_success() -> None:
    transport = MockTransport(lambda request: Response(200, text="<html>proxy error</html>"))

    sample = await measured(transport, RequestSpec("read", "/read"))

    assert sample.outcome == "error"
    assert sample.error_type == "JSONDecodeError"


async def test_watchdog_is_a_failure_not_a_database_timeout() -> None:
    async def stalled(request: Request) -> Response:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    sample = await measured(MockTransport(stalled), RequestSpec("read", "/read"), watchdog=0.01)

    assert sample.outcome == "watchdog"
    assert sample.reason is None
    assert request_failures([sample], 1) == ["Unexpected read outcome: watchdog/None/TimeoutError"]


async def test_explicit_cancellation_is_preserved_and_accounted_for() -> None:
    started = asyncio.Event()

    async def stalled(request: Request) -> Response:
        started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    samples: list[Sample] = []
    async with AsyncClient(transport=MockTransport(stalled), base_url="http://test") as client:
        task = asyncio.create_task(measure(client, RequestSpec("read", "/read"), samples, 1))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert samples[0].outcome == "cancelled"
    assert request_failures(samples, 1, cancellations=1) == []
    assert request_failures(samples, 1) == ["Unexpected cancellation count"]


async def test_transport_timeout_is_not_mislabelled_as_watchdog() -> None:
    def failed(request: Request) -> Response:
        raise TimeoutError("transport failed before the watchdog")

    sample = await measured(MockTransport(failed), RequestSpec("read", "/read"))

    assert sample.outcome == "error"
    assert sample.error_type == "TimeoutError"
    assert request_failures([sample], 1) == ["Unexpected read outcome: error/None/TimeoutError"]


async def test_other_503s_do_not_count_as_database_timeout_evidence() -> None:
    transport = MockTransport(lambda request: Response(503, json={"detail": "The chat is switched off."}))

    sample = await measured(transport, RequestSpec("chat", "/chat"))

    assert not sample.database_failure
    assert request_failures([sample], 1) == ["Unexpected chat outcome: http/503/None"]


async def test_database_503_without_its_logged_reason_is_a_failure() -> None:
    transport = MockTransport(lambda request: Response(503, json=DATABASE_503))

    sample = await measured(transport, RequestSpec("read", "/read"))

    assert sample.database_failure
    assert sample.reason is None
    assert request_failures([sample], 1) == ["Unexpected read outcome: http/503/None"]


async def test_database_503_with_its_correlated_logged_reason_is_accepted() -> None:
    logger = logging.getLogger("fp299-unit")
    handler = FailureLog()
    logger.addHandler(handler)

    def unavailable(request: Request) -> Response:
        logger.warning(DATABASE_UNAVAILABLE_LOG_PREFIX + "%s operation=%s", "pool_timeout", "checkout")
        return Response(503, json=DATABASE_503)

    try:
        sample = await measured(MockTransport(unavailable), RequestSpec("read", "/read"))
    finally:
        logger.removeHandler(handler)

    assert sample.reason == "pool_timeout"
    assert sample.operation == "checkout"
    assert request_failures([sample], 1) == []
    assert request_failures([sample], 2) == ["Request accounting mismatch"]


def test_cli_rejects_an_unknown_scenario_before_configuring_anything(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = tmp_path / "report.json"
    configured: list[str] = []
    monkeypatch.setattr("sys.argv", ["load_db_timeouts", "--scenario", "pol", "--output", str(output)])
    monkeypatch.setattr(load_db_timeouts, "configure_environment", lambda database, redis: configured.append(database))

    with pytest.raises(SystemExit) as exit_info:
        load_db_timeouts.main()

    assert exit_info.value.code == 2
    assert configured == []
    assert not output.exists()


@pytest.mark.parametrize("raises", [False, True])
def test_cli_writes_failure_artifact_and_exits_nonzero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, raises: bool,
) -> None:
    output = tmp_path / "failed.json"
    monkeypatch.setattr("sys.argv", ["load_db_timeouts", "--output", str(output)])
    monkeypatch.setattr(load_db_timeouts, "configure_environment", lambda database, redis: None)
    monkeypatch.setattr(load_db_timeouts, "metadata", lambda args: {"revision": "test"})

    async def failed(args: object, report: dict[str, object]) -> bool:
        report["results"] = [{"failures": ["watchdog"]}]
        if raises:
            raise RuntimeError("harness setup failed")
        return False

    monkeypatch.setattr(load_db_timeouts, "execute", failed)

    exit_code = load_db_timeouts.main()

    report = json.loads(output.read_text())
    assert exit_code == 1
    assert report["passed"] is False
    assert report.get("runner_error_type") == ("RuntimeError" if raises else None)
    assert report["results"][0]["failures"] == ["watchdog"]
    assert "finished_at" in report
    assert not output.with_name(output.name + ".partial").exists()
