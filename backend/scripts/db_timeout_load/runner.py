"""Run the selected scenarios and decide, per cycle, whether the evidence holds.

Imported only after the CLI has validated the targets and configured the environment,
because importing the harness imports the app and builds its Settings.
"""

import argparse
import os
from collections.abc import Callable

from sqlalchemy import text

from app.core.config import Settings
from scripts.db_timeout_load.config import (
    FAULT_CONCURRENCY, HEALTHY, HEALTHY_CONCURRENCY_LEVELS, MAX_OVERFLOW, POOL_SIZE, budgets_for,
)
from scripts.db_timeout_load.harness import Harness, open_harness
from scripts.db_timeout_load.metrics import MS_PER_SECOND, request_failures, summarize
from scripts.db_timeout_load.scenarios import SCENARIOS, Wave
from scripts.db_timeout_load.world import isolated_world

Report = dict[str, object]


async def healthy_wave(harness: Harness, concurrency: int, count: int) -> Wave:
    samples, elapsed = await harness.wave(harness.world.reads(), concurrency, count)
    wave = Wave(samples, elapsed)
    if not all(s.valid_success for s in samples):
        wave.failures.append("Healthy load produced an unexpected failure")
    return wave


async def run_cycle(harness: Harness, name: str, concurrency: int, count: int) -> Report:
    harness.scenario = name
    # Read both bounds now: recovery() switches the harness back to the healthy scenario.
    envelope = harness.budgets.envelope(name)
    watchdog = harness.request_watchdog
    relay_errors_before = len(harness.proxy.errors)
    if name == HEALTHY:
        wave = await healthy_wave(harness, concurrency, count)
        expected = count
    else:
        wave = await SCENARIOS[name](harness)
        expected = FAULT_CONCURRENCY + wave.extra_attempts
    failures = [*wave.failures, *request_failures(wave.samples, expected, cancellations=wave.cancellations)]
    if any(sample.elapsed_ms > envelope * MS_PER_SECOND for sample in wave.samples):
        failures.append("Request exceeded the predeclared scenario envelope")
    before_recovery = harness.pool.snapshot()
    recovery, recovery_failures = await harness.recovery(wave.fault_removed_at)
    failures.extend(recovery_failures)
    pool = harness.pool.snapshot()
    tasks = await harness.settled_tasks()
    if not harness.settled(tasks):
        failures.append("Tasks or fault-relay connections did not settle")
    # The pool can never report more than its capacity, so zero checked-out connections
    # plus settled relay sockets is the leak check; peak_checked_out is informational.
    if before_recovery["final_checked_out"] != 0 or pool["final_checked_out"] != 0:
        failures.append("Pool leaked checked-out connections")
    relay_errors = harness.proxy.errors[relay_errors_before:]
    if relay_errors:
        failures.append("Fault relay reported an unexpected upstream connection failure")
    return {
        "scenario": name,
        "concurrency": concurrency,
        "expected_attempts": expected,
        "envelope_seconds": envelope,
        "watchdog_seconds": watchdog,
        "stimulus": wave.stimulus,
        "load": summarize(wave.samples, wave.duration),
        "recovery": recovery,
        "pool_before_recovery": before_recovery,
        "pool_cumulative": pool,
        "settled_tasks": tasks,
        "relay_errors": relay_errors,
        "failures": failures,
    }


async def execute(args: argparse.Namespace, report: Report, save: Callable[[], None]) -> bool:
    selected = list(dict.fromkeys(args.scenario or [HEALTHY, *SCENARIOS]))
    budgets = budgets_for(args.profile)
    report["budgets_seconds"] = budgets.settings()
    report["setup_timeout_seconds"] = budgets.general_envelope
    report["pool"] = {
        "size": POOL_SIZE,
        "max_overflow": MAX_OVERFLOW,
        "matches_code_default": (
            Settings.model_fields["DB_POOL_SIZE"].default == POOL_SIZE
            and Settings.model_fields["DB_MAX_OVERFLOW"].default == MAX_OVERFLOW
        ),
    }
    results: list[Report] = []
    report["results"] = results
    warmups: Report = {}
    report["warmups"] = warmups
    database = os.environ["TEST_DATABASE_URL"]
    async with isolated_world(database) as world:
        async with world.control.connect() as db:
            report["postgresql"] = str(await db.scalar(text("SHOW server_version")))
        for name in selected:
            # A fresh engine and pool per scenario, kept alive through all its repetitions.
            async with open_harness(world, database, budgets) as harness:
                warm, duration = await harness.wave(world.reads(), 1, len(world.reads()))
                warmups[name] = summarize(warm, duration)
                if not all(s.valid_success for s in warm):
                    raise RuntimeError("Warm-up failed: synthetic routes must all succeed before fault injection")
                for repetition in range(1, args.repetitions + 1):
                    levels = HEALTHY_CONCURRENCY_LEVELS if name == HEALTHY else (FAULT_CONCURRENCY,)
                    for concurrency in levels:
                        # Recorded first, so a runner error names the cycle it interrupted.
                        report["in_progress"] = {"scenario": name, "repetition": repetition, "concurrency": concurrency}
                        result = await run_cycle(harness, name, concurrency, args.requests)
                        result["repetition"] = repetition
                        results.append(result)
                        del report["in_progress"]
                        status = "FAIL" if result["failures"] else "PASS"
                        print(f"{name} repetition={repetition} concurrency={concurrency}: {status}", flush=True)
                        # Persist partial evidence too: interruption must not erase failed waves.
                        save()
    return all(not result["failures"] for result in results)
