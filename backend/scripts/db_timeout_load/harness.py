"""Real app/session wiring and finite concurrent HTTP waves for FP-299."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from time import perf_counter
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app import main as app_main
from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core import rate_limit
from app.core.config import settings
from app.db import session as session_module
from app.db.engine import create_db_engine
from app.db.session import DatabaseSession
from app.schemas.people import DriverRead, UserRead
from scripts.db_timeout_load.config import (
    FAULT_CONCURRENCY, HEALTHY, MAX_OVERFLOW, POOL_CAPACITY, POOL_SIZE, Budgets, database_target,
)
from scripts.db_timeout_load.metrics import (
    FailureLog, PoolMetrics, RequestSpec, Sample, measure, queue_pool, request_failures, summarize,
)
from scripts.db_timeout_load.proxy import TEARDOWN_SECONDS, FaultProxy
from scripts.db_timeout_load.world import World, use_schema

SETTLE_POLL_SECONDS = 0.01
POSTGRES_DEFAULT_PORT = 5432


@dataclass
class Harness:
    world: World
    engine: AsyncEngine
    proxy: FaultProxy
    client: AsyncClient
    pool: PoolMetrics
    budgets: Budgets
    baseline_tasks: set[asyncio.Task[object]]
    scenario: str = HEALTHY

    @property
    def request_watchdog(self) -> float:
        return self.budgets.request_watchdog(self.scenario)

    async def wave(self, specs: list[RequestSpec], concurrency: int, count: int) -> tuple[list[Sample], float]:
        samples: list[Sample] = []
        semaphore = asyncio.Semaphore(concurrency)

        async def send(index: int) -> None:
            async with semaphore:
                await measure(self.client, specs[index % len(specs)], samples, self.request_watchdog)

        started = perf_counter()
        async with asyncio.TaskGroup() as group:
            for index in range(count):
                group.create_task(send(index))
        return samples, perf_counter() - started

    async def recovery(self, fault_removed_at: float | None = None) -> tuple[dict[str, object], list[str]]:
        removed = fault_removed_at if fault_removed_at is not None else perf_counter()
        self.proxy.restore()
        self.scenario = HEALTHY
        samples, elapsed = await self.wave(self.world.reads(), FAULT_CONCURRENCY, FAULT_CONCURRENCY)
        recovery_seconds = perf_counter() - removed
        failures = request_failures(samples, FAULT_CONCURRENCY)
        if not all(s.valid_success for s in samples):
            failures.append("Healthy recovery wave did not fully succeed")
        mutation = await self.world.reset_notice()
        writes, duration = await self.wave([mutation], 1, 1)
        failures.extend(request_failures(writes, 1))
        persisted = await self.world.notice_persisted()
        if not all(s.valid_success for s in writes) or not persisted:
            failures.append("Recovery mutation was not successfully persisted")
        report = {
            "reads": summarize(samples, elapsed),
            "mutation": summarize(writes, duration),
            "mutation_persisted": persisted,
            "fault_removal_to_reads_seconds": round(recovery_seconds, 4),
        }
        return report, failures

    def task_counts(self) -> dict[str, int]:
        extra = asyncio.all_tasks() - self.baseline_tasks - self.proxy.tasks - self.proxy.pumps
        return {
            "unexpected_tasks": len(extra),
            "relay_tasks": len(self.proxy.tasks),
            "relay_pumps": len(self.proxy.pumps),
            "relay_writers": len(self.proxy.writers),
        }

    def settled(self, counts: dict[str, int]) -> bool:
        return counts["unexpected_tasks"] == 0 and counts["relay_tasks"] <= queue_pool(self.engine).size()

    async def settled_tasks(self) -> dict[str, int]:
        deadline = perf_counter() + TEARDOWN_SECONDS
        while True:
            counts = self.task_counts()
            if self.settled(counts) or perf_counter() >= deadline:
                return counts
            await asyncio.sleep(SETTLE_POLL_SECONDS)

    async def warm_pool(self) -> None:
        ready = asyncio.Barrier(POOL_CAPACITY)

        async def hold() -> None:
            async with self.engine.connect() as db:
                await db.execute(text("SELECT 1"))
                await ready.wait()

        async with asyncio.timeout(self.budgets.general_envelope):
            async with asyncio.TaskGroup() as group:
                for _ in range(POOL_CAPACITY):
                    group.create_task(hold())


async def close_redis_client() -> None:
    await rate_limit.get_redis().aclose()
    rate_limit.reset_client()


@asynccontextmanager
async def open_harness(world: World, database: str, budgets: Budgets) -> AsyncIterator[Harness]:
    target = database_target(database)
    proxy = FaultProxy(target.host or "localhost", target.port or POSTGRES_DEFAULT_PORT)

    async def user() -> UserRead:
        return world.user

    async def driver() -> DriverRead:
        return world.driver

    async with AsyncExitStack() as cleanup:
        port = await proxy.start()
        cleanup.push_async_callback(proxy.close)
        rate_limit.reset_client()
        cleanup.push_async_callback(close_redis_client)
        url = target.set(host="127.0.0.1", port=port).update_query_dict({"ssl": "disable"})
        config = settings.model_copy(update={
            "DATABASE_URL": url.render_as_string(hide_password=False),
            "DB_POOL_SIZE": POOL_SIZE,
            "DB_MAX_OVERFLOW": MAX_OVERFLOW,
            **budgets.settings(),
        })
        engine = create_db_engine(config)
        cleanup.push_async_callback(engine.dispose)
        cleanup.callback(proxy.restore)
        use_schema(engine, world.schema)
        pool = PoolMetrics(engine)
        pool.attach()
        for name, value in budgets.settings().items():
            cleanup.enter_context(patch.object(settings, name, value))
        cleanup.enter_context(patch.object(session_module, "AsyncSessionLocal", async_sessionmaker(
            engine, class_=DatabaseSession, expire_on_commit=False,
        )))
        cleanup.enter_context(patch.dict(app_main.app.dependency_overrides, {
            get_current_dispatcher: user, get_current_driver: driver,
        }))
        handler = FailureLog()
        app_logger = logging.getLogger(app_main.__name__)
        app_logger.addHandler(handler)
        cleanup.callback(app_logger.removeHandler, handler)
        transport = ASGITransport(app=app_main.app, raise_app_exceptions=False)  # type: ignore[arg-type]
        client = await cleanup.enter_async_context(AsyncClient(transport=transport, base_url="http://fp299.test"))
        yield Harness(world, engine, proxy, client, pool, budgets, baseline_tasks=asyncio.all_tasks())
