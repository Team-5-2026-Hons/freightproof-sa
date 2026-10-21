"""Complete request accounting and sanitized measurements; no response/SQL payload logging."""

import asyncio
import logging
import math
from collections import Counter, defaultdict
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from http import HTTPStatus
from time import perf_counter
from typing import Literal

from httpx import AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import ConnectionPoolEntry, QueuePool

from app.db.errors import DATABASE_UNAVAILABLE_DETAIL

Outcome = Literal["http", "cancelled", "watchdog", "error"]

MS_PER_SECOND = 1000
# Must match the first words of app.main.database_unavailable_handler's warning, whose
# first two arguments are the failure reason and operation.
DATABASE_UNAVAILABLE_LOG_PREFIX = "Database unavailable reason="
PERCENTILES = (("p50", 0.50), ("p95", 0.95), ("p99", 0.99))


@dataclass
class Sample:
    route: str
    elapsed_ms: float = 0.0
    outcome: Outcome = "error"
    status: int | None = None
    database_failure: bool = False
    valid_success: bool = False
    reason: str | None = None
    operation: str | None = None
    error_type: str | None = None


CURRENT_SAMPLE: ContextVar[Sample | None] = ContextVar("fp299_sample", default=None)


class FailureLog(logging.Handler):
    """Copy the 503 handler's structured reason and operation onto the request's sample.

    measure() stores the sample in CURRENT_SAMPLE. HTTPX's ASGITransport runs the app in
    the caller's task, so the app's exception handler, and the log record it emits, see
    that same context. This reads the handler's existing log line instead of changing app
    code, and it relies on the reason and operation being its first two arguments.
    """

    def emit(self, record: logging.LogRecord) -> None:
        sample = CURRENT_SAMPLE.get()
        if sample is None or not str(record.msg).startswith(DATABASE_UNAVAILABLE_LOG_PREFIX):
            return
        if isinstance(record.args, tuple) and len(record.args) >= 2:
            sample.reason = str(record.args[0])
            sample.operation = str(record.args[1])


@dataclass(frozen=True)
class RequestSpec:
    label: str
    path: str
    method: str = "GET"
    body: dict[str, object] | None = None
    expected: object = None


def successful_payload(response: object, expected: object) -> bool:
    # A dict must contain the expected key/value pairs; a list must contain an item
    # matching each expected item. This proves the seeded records came back.
    if expected is None:
        return isinstance(response, (dict, list))
    if isinstance(expected, dict) and isinstance(response, dict):
        return all(response.get(key) == value for key, value in expected.items())
    if isinstance(expected, list) and isinstance(response, list):
        return all(any(successful_payload(item, wanted) for item in response) for wanted in expected)
    return response == expected


def is_database_failure(status: int, body: object) -> bool:
    return status == HTTPStatus.SERVICE_UNAVAILABLE and body == {"detail": DATABASE_UNAVAILABLE_DETAIL}


async def measure(client: AsyncClient, spec: RequestSpec, samples: list[Sample], watchdog: float) -> None:
    sample = Sample(route=spec.label)
    token = CURRENT_SAMPLE.set(sample)
    started = perf_counter()
    deadline = asyncio.timeout(watchdog)
    try:
        async with deadline:
            response = await client.request(spec.method, spec.path, json=spec.body)
            sample.status = response.status_code
            sample.outcome = "http"
            body = response.json()
            sample.database_failure = is_database_failure(sample.status, body)
            sample.valid_success = sample.status == HTTPStatus.OK and successful_payload(body, spec.expected)
    except TimeoutError:
        # Only our own watchdog counts as "watchdog"; a TimeoutError from inside the
        # request is an unexpected error, never a database-timeout success.
        sample.outcome = "watchdog" if deadline.expired() else "error"
        sample.error_type = "TimeoutError"
    except asyncio.CancelledError:
        sample.outcome = "cancelled"
        raise
    except Exception as exc:
        sample.outcome = "error"
        sample.error_type = type(exc).__name__
    finally:
        sample.elapsed_ms = (perf_counter() - started) * MS_PER_SECOND
        samples.append(sample)
        CURRENT_SAMPLE.reset(token)


def distribution(values: list[float]) -> dict[str, float | int]:
    # Nearest-rank percentiles: the value at position ceil(p * n) of the sorted samples.
    if not values:
        return {"count": 0}
    ordered = sorted(values)
    result: dict[str, float | int] = {
        "count": len(ordered),
        "min": round(ordered[0], 3),
        "max": round(ordered[-1], 3),
    }
    for label, fraction in PERCENTILES:
        result[label] = round(ordered[math.ceil(fraction * len(ordered)) - 1], 3)
    return result


def summarize(samples: list[Sample], elapsed: float) -> dict[str, object]:
    groups: dict[str, list[float]] = defaultdict(list)
    for sample in samples:
        category = sample.reason or (str(sample.status) if sample.outcome == "http" else sample.outcome)
        groups[category].append(sample.elapsed_ms)
    completed = sum(s.outcome == "http" for s in samples)
    return {
        "attempts": len(samples),
        "completed_http": completed,
        "duration_seconds": round(elapsed, 4),
        "completed_http_per_second": round(completed / elapsed, 3) if elapsed else 0,
        "statuses": dict(Counter(str(s.status) for s in samples if s.status is not None)),
        "outcomes": dict(Counter(s.outcome for s in samples)),
        "valid_successes": sum(s.valid_success for s in samples),
        "database_503s": sum(s.database_failure for s in samples),
        "database_reasons": dict(Counter(s.reason for s in samples if s.reason)),
        "database_operations": dict(Counter(s.operation for s in samples if s.operation)),
        "latency_ms": {key: distribution(values) for key, values in sorted(groups.items())},
        "samples": [asdict(sample) for sample in samples],
    }


def request_failures(samples: list[Sample], expected: int, *, cancellations: int = 0) -> list[str]:
    # Every attempt must be accounted for. Apart from deliberate cancellations, each one
    # must be a valid success or the exact database 503 with its logged reason/operation.
    failures = []
    if len(samples) != expected:
        failures.append("Request accounting mismatch")
    if sum(s.outcome == "cancelled" for s in samples) != cancellations:
        failures.append("Unexpected cancellation count")
    for sample in samples:
        if sample.outcome == "cancelled":
            continue
        correlated_failure = sample.database_failure and sample.reason and sample.operation
        if sample.outcome != "http" or not (sample.valid_success or correlated_failure):
            failures.append(f"Unexpected {sample.route} outcome: {sample.outcome}/{sample.status}/{sample.error_type}")
    return failures


def queue_pool(engine: AsyncEngine) -> QueuePool:
    # create_db_engine always builds a QueuePool subclass; the check gives mypy, and a
    # reader, the checked-out/size methods that the generic Pool type lacks.
    pool = engine.pool
    if not isinstance(pool, QueuePool):
        raise TypeError("The load harness expects the API engine's queue pool")
    return pool


@dataclass
class PoolMetrics:
    engine: AsyncEngine
    peak: int = 0
    checkouts: int = 0
    checkins: int = 0
    invalidations: int = 0
    held: dict[int, tuple[float, str]] = field(default_factory=dict)
    holds_ms: list[float] = field(default_factory=list)
    checkouts_by_route: Counter[str] = field(default_factory=Counter)
    holds_by_route: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))

    def attach(self) -> None:
        # The engine is disposed with its harness, so these listeners never outlive it.
        event.listen(self.engine.sync_engine, "checkout", self.checkout)
        event.listen(self.engine.sync_engine, "checkin", self.checkin)
        event.listen(self.engine.sync_engine, "invalidate", self.invalidate)

    def checkout(self, connection: object, record: ConnectionPoolEntry, proxy: object) -> None:
        self.checkouts += 1
        sample = CURRENT_SAMPLE.get()
        # Connections opened by the harness itself, not by an HTTP request.
        route = sample.route if sample is not None else "administrative"
        self.checkouts_by_route[route] += 1
        self.held[id(record)] = (perf_counter(), route)
        self.peak = max(self.peak, queue_pool(self.engine).checkedout())

    def checkin(self, connection: object, record: ConnectionPoolEntry) -> None:
        self.checkins += 1
        held = self.held.pop(id(record), None)
        if held is not None:
            started, route = held
            elapsed = (perf_counter() - started) * MS_PER_SECOND
            self.holds_ms.append(elapsed)
            self.holds_by_route[route].append(elapsed)

    def invalidate(self, connection: object, record: ConnectionPoolEntry, error: BaseException | None) -> None:
        self.invalidations += 1

    def snapshot(self) -> dict[str, object]:
        return {
            "peak_checked_out": self.peak,
            "final_checked_out": queue_pool(self.engine).checkedout(),
            "checkouts": self.checkouts,
            "checkins": self.checkins,
            "invalidations": self.invalidations,
            "connection_hold_ms": distribution(self.holds_ms),
            "checkouts_by_route": dict(self.checkouts_by_route),
            "connection_hold_ms_by_route": {route: distribution(values) for route, values in self.holds_by_route.items()},
        }
