"""Controlled faults followed by recovery on the same API engine."""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from time import perf_counter
from unittest.mock import patch

from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db.models.trips import Trip
from app.orchestration.analytics_chat import service as chat_service
from scripts.db_timeout_load.chat import CHAT, ControlledProvider, ProviderGate
from scripts.db_timeout_load.config import FAULT_CONCURRENCY, POOL_CAPACITY
from scripts.db_timeout_load.harness import Harness
from scripts.db_timeout_load.metrics import MS_PER_SECOND, RequestSpec, Sample, measure, queue_pool

# Every representative read touches trips, so locking it, or silencing the socket just as
# a trips statement is sent, puts the fault on the request's first real SQL.
TRIPS_STATEMENT_MARKER = f"FROM {Trip.__tablename__}"
LOCK_TRIPS = text(f"LOCK TABLE {Trip.__tablename__} IN ACCESS EXCLUSIVE MODE")
# A pool timeout must not arrive well before its configured wait; 20% slack allows for
# event-loop timer granularity without accepting an unrelated early failure.
EARLY_POOL_FAILURE_FRACTION = 0.8
# Other backends of this database still waiting for a lock, i.e. on the blocker's table.
LOCK_WAITER_PIDS = text(
    "SELECT pid FROM pg_stat_activity"
    " WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()"
)
CLEAR_ACTIVITY_SNAPSHOT = text("SELECT pg_stat_clear_snapshot()")
# PostgreSQL acts on a cancel request asynchronously, so allow it a moment to land.
LOCK_WAITER_SETTLE_SECONDS = 2.0
LOCK_WAITER_POLL_SECONDS = 0.05


@dataclass
class Wave:
    samples: list[Sample]
    duration: float
    stimulus: dict[str, object] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    cancellations: int = 0
    # Requests beyond the FAULT_CONCURRENCY reads, e.g. the chat requests holding slots.
    extra_attempts: int = 0
    fault_removed_at: float | None = None


def expect_reason(wave: Wave, reason: str, *, every: bool = False) -> Wave:
    matching = [s for s in wave.samples if s.database_failure and s.reason == reason]
    if not matching or (every and len(matching) != len(wave.samples)):
        wave.failures.append(f"Required database failure not observed: {reason}")
    return wave


async def held_pool(harness: Harness, stack: AsyncExitStack) -> None:
    for _ in range(POOL_CAPACITY):
        connection = await stack.enter_async_context(harness.engine.connect())
        await connection.execute(text("SELECT 1"))


async def pool_exhaustion(harness: Harness) -> Wave:
    async with AsyncExitStack() as stack:
        await held_pool(harness, stack)
        samples, elapsed = await harness.wave(harness.world.reads(), FAULT_CONCURRENCY, FAULT_CONCURRENCY)
    wave = Wave(samples, elapsed, {"held_slots": POOL_CAPACITY}, fault_removed_at=perf_counter())
    expect_reason(wave, "pool_timeout", every=True)
    earliest_ms = harness.budgets.pool * MS_PER_SECOND * EARLY_POOL_FAILURE_FRACTION
    if any(s.elapsed_ms < earliest_ms for s in samples):
        wave.failures.append("Pool failure arrived well before the configured wait budget")
    return wave


async def connect_timeout(harness: Harness) -> Wave:
    # Force fresh connections without replacing the pool or restarting the application.
    async with AsyncExitStack() as stack:
        connections = [await stack.enter_async_context(harness.engine.connect()) for _ in range(POOL_CAPACITY)]
        for connection in connections:
            await connection.invalidate()
    harness.proxy.resume.clear()
    harness.proxy.stall_new = True
    before = harness.proxy.stalled
    try:
        samples, elapsed = await harness.wave(harness.world.reads(), FAULT_CONCURRENCY, FAULT_CONCURRENCY)
    finally:
        harness.proxy.restore()
    stimulus: dict[str, object] = {"stalled_handshakes": harness.proxy.stalled - before}
    return expect_reason(Wave(samples, elapsed, stimulus, fault_removed_at=perf_counter()), "connect_timeout")


async def lock_waiters(blocker: AsyncConnection) -> set[int]:
    # PostgreSQL snapshots activity once per transaction; clear it so each poll is current.
    await blocker.execute(CLEAR_ACTIVITY_SNAPSHOT)
    return set(await blocker.scalars(LOCK_WAITER_PIDS))


async def settled_lock_waiters(blocker: AsyncConnection) -> int:
    deadline = perf_counter() + LOCK_WAITER_SETTLE_SECONDS
    while (waiting := await lock_waiters(blocker)) and perf_counter() < deadline:
        await asyncio.sleep(LOCK_WAITER_POLL_SECONDS)
    return len(waiting)


async def lock_wave(harness: Harness, specs: list[RequestSpec]) -> Wave:
    async with harness.world.control.begin() as blocker:
        # This schema contains only this run's synthetic rows. Holding a real conflicting
        # lock exercises the API command timeout, rather than mocking an exception.
        await blocker.execute(LOCK_TRIPS)
        samples, elapsed = await harness.wave(specs, FAULT_CONCURRENCY, FAULT_CONCURRENCY)
        # Counted while the lock is still held: a statement still queued here after its
        # request returned 503 was abandoned by the API but never cancelled in PostgreSQL.
        left_waiting = await settled_lock_waiters(blocker)
    stimulus: dict[str, object] = {"table_lock_acquired": True, "statements_left_waiting": left_waiting}
    wave = Wave(samples, elapsed, stimulus, fault_removed_at=perf_counter())
    if left_waiting:
        wave.failures.append("Timed-out statements were left waiting in PostgreSQL")
    return expect_reason(wave, "command_timeout")


async def command_timeout(harness: Harness) -> Wave:
    return await lock_wave(harness, harness.world.reads()[:1])


async def idle_ping(harness: Harness) -> Wave:
    await harness.warm_pool()
    before = harness.proxy.silenced
    harness.proxy.silence()
    samples, elapsed = await harness.wave(harness.world.reads()[:1], FAULT_CONCURRENCY, FAULT_CONCURRENCY)
    stimulus: dict[str, object] = {"silenced_connections": harness.proxy.silenced - before}
    return expect_reason(Wave(samples, elapsed, stimulus), "checkout_timeout")


async def half_open_command(harness: Harness) -> Wave:
    await harness.warm_pool()
    triggered = False

    def silence_on_query(connection: Connection, cursor: object, statement: str, *unused: object) -> None:
        nonlocal triggered
        # After checkout and pre-ping, before the first application query reaches the wire.
        if not triggered and TRIPS_STATEMENT_MARKER in statement:
            triggered = True
            harness.proxy.silence()

    event.listen(harness.engine.sync_engine, "before_cursor_execute", silence_on_query)
    try:
        samples, elapsed = await harness.wave(harness.world.reads()[:1], FAULT_CONCURRENCY, FAULT_CONCURRENCY)
    finally:
        event.remove(harness.engine.sync_engine, "before_cursor_execute", silence_on_query)
    wave = Wave(samples, elapsed, {"silenced_after_checkout": triggered})
    return expect_reason(wave, "command_timeout")


async def cancel_under_contention(harness: Harness) -> Wave:
    samples: list[Sample] = []
    ready = asyncio.Event()
    query_count = 0

    def observed_query(connection: Connection, cursor: object, statement: str, *unused: object) -> None:
        nonlocal query_count
        if TRIPS_STATEMENT_MARKER in statement:
            query_count += 1
            if query_count >= POOL_CAPACITY:
                ready.set()

    event.listen(harness.engine.sync_engine, "before_cursor_execute", observed_query)
    tasks: list[asyncio.Task[None]] = []
    started = perf_counter()
    cancel_count = FAULT_CONCURRENCY // 2
    try:
        async with harness.world.control.begin() as blocker:
            await blocker.execute(LOCK_TRIPS)
            tasks = [asyncio.create_task(measure(harness.client, harness.world.reads()[0], samples,
                                                 harness.request_watchdog))
                     for _ in range(FAULT_CONCURRENCY)]
            # Cancel only once every pool slot has a request waiting on the lock in SQL.
            async with asyncio.timeout(harness.budgets.general_envelope):
                await ready.wait()
            reached_before_cancel = query_count
            for task in tasks[:cancel_count]:
                task.cancel()
        removed = perf_counter()
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        event.remove(harness.engine.sync_engine, "before_cursor_execute", observed_query)
    stimulus: dict[str, object] = {
        "queries_reached_before_cancel": reached_before_cancel,
        "trip_statements_total": query_count,
    }
    return Wave(samples, perf_counter() - started, stimulus, cancellations=cancel_count, fault_removed_at=removed)


async def chat_hold(harness: Harness, scenario: str) -> Wave:
    gate = ProviderGate(target=POOL_CAPACITY)
    samples: list[Sample] = []
    delay = harness.budgets.provider_delay(scenario)
    started = perf_counter()
    with patch.object(chat_service, "build_provider", lambda: ControlledProvider(gate)):
        tasks = [asyncio.create_task(measure(harness.client, CHAT, samples, harness.request_watchdog))
                 for _ in range(POOL_CAPACITY)]
        try:
            async with asyncio.timeout(harness.budgets.general_envelope):
                await gate.ready.wait()
            checked_out = queue_pool(harness.engine).checkedout()

            async def release() -> None:
                await asyncio.sleep(delay)
                gate.released_at = perf_counter()
                gate.release.set()

            async with asyncio.TaskGroup() as group:
                group.create_task(release())
                read_samples, _ = await harness.wave(harness.world.reads(), FAULT_CONCURRENCY, FAULT_CONCURRENCY)
            samples.extend(read_samples)
            await asyncio.gather(*tasks)
        finally:
            gate.release.set()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    stimulus: dict[str, object] = {
        "provider_delay_seconds": delay,
        "successful_tool_results": gate.reached,
        "checked_out_during_provider_wait": checked_out,
    }
    wave = Wave(samples, perf_counter() - started, stimulus, extra_attempts=POOL_CAPACITY,
                fault_removed_at=gate.released_at)
    chat_succeeded = all(s.valid_success for s in samples if s.route == CHAT.label)
    if checked_out != POOL_CAPACITY or not chat_succeeded:
        wave.failures.append("Chat did not hold the expected connections and complete successfully")
    if scenario == "chat_long":
        return expect_reason(wave, "pool_timeout")
    if not all(s.valid_success for s in samples):
        wave.failures.append("Short provider hold unexpectedly failed a request")
    return wave


async def chat_short(harness: Harness) -> Wave:
    return await chat_hold(harness, "chat_short")


async def chat_long(harness: Harness) -> Wave:
    return await chat_hold(harness, "chat_long")


async def chat_database_timeout(harness: Harness) -> Wave:
    # The provider asks for a real analytics tool; the lock makes that tool's SQL time out,
    # which must reach the shared database 503 handler, not a chat-specific error.
    with patch.object(chat_service, "build_provider", ControlledProvider):
        return await lock_wave(harness, [CHAT])


# Keys must match config.FAULT_SCENARIOS (pinned by a unit test).
SCENARIOS: dict[str, Callable[[Harness], Awaitable[Wave]]] = {
    "pool": pool_exhaustion,
    "connect": connect_timeout,
    "command": command_timeout,
    "half_open_command": half_open_command,
    "idle_ping": idle_ping,
    "cancel": cancel_under_contention,
    "chat_short": chat_short,
    "chat_long": chat_long,
    "chat_database": chat_database_timeout,
}
