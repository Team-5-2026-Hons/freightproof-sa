"""DEVELOPER TOOL — query count and wall time per hot read endpoint (Batch E, stage E1).

Runs the dispatcher dashboard's and trip pages' GET requests in-process (httpx ASGITransport, no
server, no network hop to the API) against the database in backend/.env, and prints one line per
endpoint: how many SQL statements it ran, how long it took, and how long of that was waiting on
the database. The database is ~185 ms per round trip from Cape Town, so statement count x 185 ms
is roughly what a user waits; this shows both.

SAFE TO RUN? It is read-only by construction, three ways:
  1. Every session it opens starts its transactions `READ ONLY` (asyncpg `BEGIN ... READ ONLY`),
     so the database itself refuses a write.
  2. A guard refuses, before it is sent, any statement that is not a SELECT, a CTE read or a
     savepoint, and any statement containing FOR UPDATE / FOR SHARE (row locks on a shared DB).
  3. It only issues GET requests.
It refuses to run with ENVIRONMENT=production.

WHAT IT SKIPS: authentication. The real dispatcher/driver dependencies stamp session activity (a
write), so they are replaced with an identity read from the database: the demo dispatcher found by
email, and, for the driver endpoint, the driver currently holding the chosen trip. Those
dependencies cost 2 statements (dispatcher) or 4 (driver) per request in production; the last
column adds them so a line compares with tests/integration/test_query_budgets.py.

Nothing secret is read or printed: tokens are never created, the connection string is never
touched by this file (the app's settings load backend/.env themselves), and failures print an
exception class and an HTTP status, never a message.

USAGE (from backend/, as a module, so `app` is importable)
    .venv/bin/python -m scripts.profile_requests
    .venv/bin/python -m scripts.profile_requests --repeat 5 --detail
    .venv/bin/python -m scripts.profile_requests --trip-id <uuid>
"""

import argparse
import asyncio
import re
import statistics
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import event as sa_event
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.db.session as db_session_module
from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.config import settings
from app.db.models.people import Driver, User
from app.db.models.trips import DriverSubstitution, Trip
from app.db.session import DatabaseSession
from app.main import app
from app.orchestration.substitutions.access import current_driver_ids
from app.schemas.people import DriverRead, UserRead

# Mirrors scripts/seed_demo.py; repeated here so this tool does not import a seeding script.
DEFAULT_DISPATCHER_EMAIL = "demo-dispatcher@freightproof.co.za"

# What get_current_dispatcher / get_current_driver cost per request (measured by
# test_query_budgets.py, warm session). Added to the last column only.
DISPATCHER_AUTH_STATEMENTS = 2
DRIVER_AUTH_STATEMENTS = 4

# One unmeasured request first: it pays for the TLS handshake and a cold pool, which is not what
# a user waits on once the app is warm.
WARM_UP_REQUESTS = 1
DEFAULT_REPEATS = 3

# Statements this tool will let through. Anything else is a bug in the tool or the endpoint.
_ALLOWED_START = re.compile(r"^\s*(SELECT|WITH|SHOW|SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)\b", re.I)
_WRITES_OR_LOCKS = re.compile(r"\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|FOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE))\b", re.I)
_FIRST_FROM = re.compile(r'\bFROM\s+("?[\w.]+"?)', re.I)

_MS = 1000.0


class WriteRefused(RuntimeError):
    """A statement that could write or lock was about to be sent."""


@dataclass
class Probe:
    """Collects the statements of the request in flight. Requests run one at a time."""

    statements: list[str] = field(default_factory=list)
    database_seconds: float = 0.0
    _started: float = 0.0

    def reset(self) -> None:
        self.statements.clear()
        self.database_seconds = 0.0


@dataclass(frozen=True)
class Endpoint:
    label: str
    path: str
    auth_statements: int
    as_driver: bool = False


@dataclass
class Result:
    endpoint: Endpoint
    status: int | None
    statements: list[str]
    wall_ms: list[float]
    database_ms: list[float]
    error: str | None = None


def _install_guards(probe: Probe) -> None:
    """Read-only sessions for the app, plus the statement counter and the write guard."""
    read_only_engine = db_session_module.engine.execution_options(postgresql_readonly=True)
    # get_db() looks AsyncSessionLocal up in this module on every request, so replacing the name
    # is enough: every request now opens `BEGIN ... READ ONLY` transactions.
    db_session_module.AsyncSessionLocal = async_sessionmaker(
        bind=read_only_engine, class_=DatabaseSession, expire_on_commit=False,
    )

    # SQLAlchemy passes (conn, cursor, statement, parameters, context, executemany); only the
    # statement is used.
    @sa_event.listens_for(read_only_engine.sync_engine, "before_cursor_execute")
    def _before(*args: Any) -> None:
        statement: str = args[2]
        if not _ALLOWED_START.match(statement) or _WRITES_OR_LOCKS.search(statement):
            # Class name only: a statement can embed values, and this tool prints nothing from the DB.
            raise WriteRefused("a non-read statement was about to be sent")
        probe.statements.append(statement)
        probe._started = time.perf_counter()

    @sa_event.listens_for(read_only_engine.sync_engine, "after_cursor_execute")
    def _after(*_args: Any) -> None:
        probe.database_seconds += time.perf_counter() - probe._started


async def _lookup_identity(email: str) -> UserRead:
    async with db_session_module.AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise SystemExit("No dispatcher with that email in this database. Seed the demo data or pass --email.")
    return UserRead.model_validate(user)


async def _current_driver(trip_id: uuid.UUID) -> DriverRead:
    """The driver who holds custody of the trip now, so the driver endpoint is allowed to answer."""
    async with db_session_module.AsyncSessionLocal() as db:
        holders = await current_driver_ids(db, trip_ids=[trip_id])
        driver = await db.get(Driver, holders[trip_id])
    return DriverRead.model_validate(driver)


async def _richest_trip(organization_id: uuid.UUID) -> uuid.UUID | None:
    """The organisation's newest trip that has had a driver handover; else its newest trip."""
    async with db_session_module.AsyncSessionLocal() as db:
        with_handover = (await db.execute(
            select(Trip.id).join(DriverSubstitution, DriverSubstitution.trip_id == Trip.id)
            .where(Trip.operator_organization_id == organization_id)
            .order_by(Trip.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        if with_handover is not None:
            return with_handover
        return (await db.execute(
            select(Trip.id).where(Trip.operator_organization_id == organization_id)
            .order_by(Trip.created_at.desc()).limit(1)
        )).scalar_one_or_none()


async def _incident_id(client: httpx.AsyncClient, trip_id: uuid.UUID) -> str | None:
    """The newest incident, preferring one on the profiled trip."""
    response = await client.get("/api/v1/incidents")
    if response.status_code != 200:
        return None
    incidents = response.json()
    on_trip = [i for i in incidents if i.get("trip_id") == str(trip_id)]
    chosen = (on_trip or incidents or [None])[0]
    return None if chosen is None else chosen["incident_id"]


def _endpoints(trip_id: uuid.UUID, incident_id: str | None) -> list[Endpoint]:
    d = DISPATCHER_AUTH_STATEMENTS
    endpoints = [
        Endpoint("dashboard  GET /trips", "/api/v1/trips", d),
        Endpoint("dashboard  GET /precincts", "/api/v1/precincts", d),
        Endpoint("dashboard  GET /exceptions/review-queue", "/api/v1/exceptions/review-queue", d),
        Endpoint("dashboard  GET /incidents", "/api/v1/incidents", d),
        Endpoint("dashboard  GET /auth/me", "/api/v1/auth/me", d),
        Endpoint("trip page  GET /trips/{id}", f"/api/v1/trips/{trip_id}", d),
    ]
    if incident_id is not None:
        endpoints += [
            Endpoint("incident   GET /incidents/{id}", f"/api/v1/incidents/{incident_id}", d),
            Endpoint("incident   GET /incidents/{id}/evidence", f"/api/v1/incidents/{incident_id}/evidence", d),
        ]
    endpoints.append(Endpoint(
        "driver app GET /trips/me/{id}", f"/api/v1/trips/me/{trip_id}", DRIVER_AUTH_STATEMENTS, as_driver=True,
    ))
    return endpoints


async def _measure(client: httpx.AsyncClient, probe: Probe, endpoint: Endpoint, repeats: int) -> Result:
    result = Result(endpoint, None, [], [], [])
    try:
        for _ in range(WARM_UP_REQUESTS):
            await client.get(endpoint.path)
        for _ in range(repeats):
            probe.reset()
            started = time.perf_counter()
            response = await client.get(endpoint.path)
            result.wall_ms.append((time.perf_counter() - started) * _MS)
            result.database_ms.append(probe.database_seconds * _MS)
            result.status = response.status_code
            result.statements = list(probe.statements)
    except Exception as exc:  # noqa: BLE001 — the tool must report and carry on to the next endpoint
        # Class name only (see module docstring); WriteRefused is the one that matters.
        result.error = type(exc).__name__
    return result


def _group_by_table(statements: list[str]) -> list[tuple[str, int]]:
    groups: dict[str, int] = defaultdict(int)
    for statement in statements:
        match = _FIRST_FROM.search(statement)
        groups[match.group(1).strip('"') if match else statement.strip().split(None, 1)[0].upper()] += 1
    return sorted(groups.items(), key=lambda item: (-item[1], item[0]))


def _print(results: list[Result], *, detail: bool) -> None:
    header = f"{'endpoint':46s} {'status':>6s} {'stmts':>6s} {'+auth':>6s} {'wall ms':>8s} {'db ms':>8s}"
    print(header)
    print("-" * len(header))
    for r in results:
        if r.error is not None or not r.wall_ms:
            print(f"{r.endpoint.label:46s} {'ERR':>6s}   {r.error or 'no response'}")
            continue
        count = len(r.statements)
        print(
            f"{r.endpoint.label:46s} {r.status!s:>6s} {count:6d} {count + r.endpoint.auth_statements:6d} "
            f"{statistics.median(r.wall_ms):8.0f} {statistics.median(r.database_ms):8.0f}"
        )
    print("\nwall/db ms are medians. 'stmts' excludes authentication; '+auth' adds what it costs in production.")
    if detail:
        for r in results:
            if r.statements:
                print(f"\n{r.endpoint.label}")
                for table, n in _group_by_table(r.statements):
                    print(f"  {n:3d}  {table}")


async def _run(email: str, trip_id: uuid.UUID | None, repeats: int, detail: bool) -> int:
    probe = Probe()
    _install_guards(probe)
    # The per-IP limiter needs Redis and a request count is not a traffic model.
    settings.RATE_LIMIT_ENABLED = False

    dispatcher = await _lookup_identity(email)
    chosen_trip = trip_id or await _richest_trip(dispatcher.organization_id)
    if chosen_trip is None:
        raise SystemExit("This organisation has no trips to profile.")
    driver = await _current_driver(chosen_trip)

    app.dependency_overrides[get_current_dispatcher] = lambda: dispatcher
    app.dependency_overrides[get_current_driver] = lambda: driver
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://profile") as client:
            incident_id = await _incident_id(client, chosen_trip)
            results: list[Result] = []
            for endpoint in _endpoints(chosen_trip, incident_id):
                results.append(await _measure(client, probe, endpoint, repeats))
    finally:
        app.dependency_overrides.pop(get_current_dispatcher, None)
        app.dependency_overrides.pop(get_current_driver, None)
        await db_session_module.engine.dispose()

    print(f"profiled trip {chosen_trip}  ({'with' if incident_id else 'without'} an incident)\n")
    _print(results, detail=detail)
    return 1 if any(r.error or r.status != 200 for r in results) else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Per-endpoint query count and wall time (read-only).")
    parser.add_argument("--email", default=DEFAULT_DISPATCHER_EMAIL, help="dispatcher to act as")
    parser.add_argument("--trip-id", type=uuid.UUID, default=None, help="trip to profile (default: newest with a handover)")
    parser.add_argument("--repeat", type=int, default=DEFAULT_REPEATS, help="timed requests per endpoint")
    parser.add_argument("--detail", action="store_true", help="also list statements per table for each endpoint")
    args = parser.parse_args()
    if settings.ENVIRONMENT == "production":
        raise SystemExit("Refusing to run with ENVIRONMENT=production.")
    sys.exit(asyncio.run(_run(args.email, args.trip_id, args.repeat, args.detail)))


if __name__ == "__main__":
    main()
