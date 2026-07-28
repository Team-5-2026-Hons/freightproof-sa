"""DEVELOPER TOOL — delete every lifecycle row from the refactor database.

A trip is immutable evidence. FreightProof has no trip-deletion feature and must
never grow one: no endpoint, no orchestration path, no UI affordance. This script is
out-of-band maintenance for a disposable refactor database, in the same category as
seed_demo.py, and nothing under app/ may import from it. It exists because
trips.trip_reference is UNIQUE, so re-seeding demo trips during Stages 1-4 fails on
the second run without it.

Existing trips are old-shape and anchored over old payloads; parent §5.3 regenerates
them rather than migrating them. Reference data — organizations, precincts, users,
drivers, vehicles, templates, SLA configs — survives untouched, and the script
asserts that rather than hoping.

Ordered DELETE, not TRUNCATE ... CASCADE. TRUNCATE CASCADE empties whole referencing
TABLES, not matching rows: blockchain_receipts.trip_id -> trips, and
vehicle_events / driver_events -> blockchain_receipts, so truncating trips would
silently wipe the entire fleet audit trail. At demo volumes DELETE costs nothing.

--project-ref is required and is checked against DATABASE_URL's host before a
single row is touched. No pg_dump stands behind this script (decision 2026-07-28),
so the guard IS the safety net: the failure mode that matters is running it while
DATABASE_URL still points at the old fallback project, which is exactly the class
of misconfiguration Stage 0 found three instances of.

Usage:
    cd backend
    PYTHONPATH=. .venv/bin/python scripts/dev_reset_lifecycle.py --project-ref spjugofbopoyrmmpucjr --yes
"""

import argparse
import asyncio
from typing import Any, cast
from urllib.parse import urlsplit

from sqlalchemy import CursorResult, Result, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# FK-safe order: children before parents. phase_events precedes evidence_artifacts
# and blockchain_receipts because it points at both; exceptions and checkpoints
# precede merkle_batches for the same reason.
_DELETE_ORDER = [
    "merkle_batch_leaves",
    "trailer_gps_snapshots",
    "driver_substitutions",
    "exceptions",
    "checkpoints",
    "phase_events",
    "parcels",
    "consignments",
    "evidence_artifacts",
    "merkle_batches",
    "trip_trailers",
    "trip_stops",
]

# Trip-scoped receipts only. Vehicle/driver receipts carry trip_id IS NULL and are
# referenced by vehicle_events / driver_events, which are reference-side audit rows.
_RECEIPTS_DELETE = "DELETE FROM blockchain_receipts WHERE trip_id IS NOT NULL"

_REFERENCE_TABLES = [
    "organizations", "precincts", "users", "drivers", "vehicles",
    "trip_templates", "sla_configs", "vehicle_events", "driver_events",
]


async def _counts(db: AsyncSession, tables: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in tables:
        result = await db.execute(text(f"SELECT count(*) FROM {table}"))  # noqa: S608 — fixed literal list
        out[table] = int(result.scalar_one())
    return out


def _deleted(result: Result[Any]) -> int:
    """Row count of a DELETE, typed.

    AsyncSession.execute() is declared as returning Result, but a DML statement
    always yields a CursorResult — rowcount only exists on the latter, so the
    narrowing is what makes the printed audit line type-check.
    """
    return cast("CursorResult[Any]", result).rowcount or 0


async def reset() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with async_session() as db:
            before = await _counts(db, _REFERENCE_TABLES)

            for table in _DELETE_ORDER:
                result = await db.execute(text(f"DELETE FROM {table}"))  # noqa: S608
                print(f"  {table:<24} {_deleted(result)} deleted")
            result = await db.execute(text(_RECEIPTS_DELETE))
            print(f"  {'blockchain_receipts':<24} {_deleted(result)} deleted (trip-scoped only)")

            result = await db.execute(text("DELETE FROM trips"))
            print(f"  {'trips':<24} {_deleted(result)} deleted")

            after = await _counts(db, _REFERENCE_TABLES)
            drift = {t: (before[t], after[t]) for t in _REFERENCE_TABLES if before[t] != after[t]}
            if drift:
                # Roll back rather than report: a reset that ate reference data is
                # not a reset, and the dump is the only way back.
                await db.rollback()
                raise SystemExit(f"ABORTED — reference tables changed: {drift}")

            await db.commit()
            print("Lifecycle reset complete; reference data unchanged.")
    finally:
        await engine.dispose()


def _assert_target(project_ref: str) -> None:
    """Refuse to run unless DATABASE_URL names the expected Supabase project.

    Checks the host AND the username, because Supabase's connection poolers put the
    project ref in the username (`postgres.<ref>`) and give every project in a region
    the same host (`aws-0-<region>.pooler.supabase.com`). Host-only matching can never
    succeed against a pooler URL — and a guard that always refuses gets deleted by the
    next person in a hurry, which is exactly how the accident it prevents happens.

    Never echoes the URL or any part of it — a connection string carries the database
    password.
    """
    parts = urlsplit(settings.DATABASE_URL)
    if project_ref not in (parts.hostname or "") and project_ref not in (parts.username or ""):
        raise SystemExit(
            f"ABORTED — DATABASE_URL does not point at project '{project_ref}'. "
            "Run scripts/check_supabase_wiring.py to see (masked) where it actually points. "
            "Nothing was deleted."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete all lifecycle data. Irreversible.")
    parser.add_argument(
        "--project-ref",
        required=True,
        help="Supabase project ref that DATABASE_URL must name, e.g. spjugofbopoyrmmpucjr. "
             "Typing it is the point: it is what stops this running against the fallback project.",
    )
    parser.add_argument("--yes", action="store_true", help="Required. There is no undo.")
    args = parser.parse_args()
    if not args.yes:
        raise SystemExit("Refusing to run without --yes.")
    _assert_target(args.project_ref)
    asyncio.run(reset())


if __name__ == "__main__":
    main()
