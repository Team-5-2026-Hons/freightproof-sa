"""FP-299: prove the API's database timeouts fail requests in bounded time and recover.

What it does: runs healthy and fault/recovery request waves through the real FastAPI app,
engine and session lifecycle (in-process HTTP, real PostgreSQL through a local fault
relay), then writes every request's outcome and timing to a JSON report. Exit code 0
means every cycle passed; 1 means at least one failed, and the report keeps its samples.

Environment: only the disposable stack in infrastructure/docker/docker-compose.load.yml,
or an equivalent local freightproof_test database and Redis /0. The targets are validated
before the app is imported, and a .env in the working directory is refused, so it can
never reach DATABASE_URL or the shared Supabase project.

Safe to run more than once: each run creates and finally drops its own fp299_<uuid>
schema. It overwrites the --output file.

Usage (from backend/, as a module so `app` and `scripts` are importable):

    python -m scripts.load_db_timeouts --profile smoke --output /results/rerun-smoke.json

See docs/testing/fp-299-database-timeout-load.md for the full procedure.
"""

import argparse
import asyncio
import hashlib
import json
import logging
import os
import platform
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

from scripts.db_timeout_load.config import (
    DEFAULT_HEALTHY_REQUESTS, DEFAULT_REPETITIONS, PROFILES, SCENARIO_NAMES, configure_environment,
)

DESCRIPTION = "Run FP-299's database-timeout load scenarios and write a JSON report."
SOURCE_DIRECTORIES = ("app", "scripts", "migrations", "tests")
RECORDED_PACKAGES = ("sqlalchemy", "asyncpg", "fastapi", "httpx", "pydantic")
CGROUP_LIMITS = (
    ("memory_bytes", Path("/sys/fs/cgroup/memory.max")),
    ("cpu_quota_period", Path("/sys/fs/cgroup/cpu.max")),
)


def positive(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=DESCRIPTION)
    result.add_argument("--profile", choices=PROFILES, default="smoke")
    result.add_argument("--repetitions", type=positive, default=DEFAULT_REPETITIONS)
    result.add_argument("--requests", type=positive, default=DEFAULT_HEALTHY_REQUESTS,
                        help="healthy requests per concurrency level")
    result.add_argument("--scenario", action="append", choices=SCENARIO_NAMES,
                        help="run selected scenarios (repeatable); default: all")
    result.add_argument("--output", type=Path, required=True)
    result.add_argument("--revision", default="unknown", help="source base commit, recorded verbatim")
    result.add_argument("--dirty", action="store_true", help="source includes uncommitted implementation changes")
    return result


def source_digest() -> str:
    # Hash LF-normalised content, so the digest matches a clean checkout of the same commit
    # whatever its line endings (Windows autocrlf or the Linux image). The NUL after each
    # path and file keeps one file's end from running into the next one's name.
    digest = hashlib.sha256()
    root = Path(__file__).resolve().parents[1]
    for directory in SOURCE_DIRECTORIES:
        for path in sorted((root / directory).rglob("*.py")):
            digest.update(path.relative_to(root).as_posix().encode() + b"\0")
            digest.update(path.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return digest.hexdigest()


def metadata(args: argparse.Namespace) -> dict[str, object]:
    return {
        "revision": args.revision,
        "dirty": args.dirty,
        "source_sha256": source_digest(),
        "started_at": datetime.now(UTC).isoformat(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu_count": os.cpu_count(),
        "workers": 1,
        "packages": {name: version(name) for name in RECORDED_PACKAGES},
        "transport": "in-process ASGI; real PostgreSQL via local TCP relay",
        "auth": "synthetic identity override; real organization-scoped services",
        "rate_limiting": False,
        "provider": "scripted; real SQL and local Redis budget; zero simulated token cost",
        "percentiles": "nearest rank, separately by outcome, milliseconds; warm-up excluded",
        "profile": args.profile,
        "repetitions": args.repetitions,
        "container_limits": {
            name: path.read_text().strip() if path.exists() else "unavailable" for name, path in CGROUP_LIMITS
        },
    }


def save(path: Path, report: dict[str, object]) -> None:
    # Write a sibling file, then rename it over the target, so an interrupted run never
    # leaves a truncated report behind.
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, path)


async def execute(args: argparse.Namespace, report: dict[str, object]) -> bool:
    # Imported only now, after configure_environment: the runner imports the app, whose
    # Settings must only ever see the validated local targets.
    from scripts.db_timeout_load.runner import execute as run_scenarios

    return await run_scenarios(args, report, lambda: save(args.output, report))


def main() -> int:
    args = parser().parse_args()
    try:
        configure_environment(os.environ.get("TEST_DATABASE_URL", ""), os.environ.get("REDIS_URL", ""))
    except ValueError as exc:
        parser().error(str(exc))
    report = metadata(args)
    report["passed"] = False
    logging.basicConfig(level=logging.WARNING)
    try:
        report["passed"] = asyncio.run(execute(args, report))
    except Exception as exc:
        report["runner_error_type"] = type(exc).__name__
        logging.exception("Load runner failed; incomplete results are retained")
    finally:
        report["finished_at"] = datetime.now(UTC).isoformat()
        save(args.output, report)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
