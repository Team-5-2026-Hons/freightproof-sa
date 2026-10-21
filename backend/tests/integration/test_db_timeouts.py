"""FP-275: real asyncpg timeouts and API responses; no load-test traffic (FP-299)."""

import asyncio
import logging
import socket
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from types import ModuleType, SimpleNamespace
from typing import NoReturn
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, async_sessionmaker

from app import main as main_module
from app.api.v1.endpoints import audit_packs, handover, phases, trip_admin, trips
from app.auth.dependencies import get_current_dispatcher, get_current_driver, require_admin_dispatcher
from app.core.config import settings
from app.core.exceptions import ConsignmentAlreadyAssignedError
from app.db import session as session_module
from app.db.engine import AvailabilityPool, create_db_engine
from app.db.errors import DATABASE_UNAVAILABLE_DETAIL, DatabaseUnavailableError
from app.db.models.enums import PhaseType
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.db.session import DatabaseSession
from app.orchestration.phases.findings import _raise_position_disagreement_if_unrecorded
from app.orchestration.trips.creation import _sync_cargo_entry
from app.schemas.people import UserRead

SHORT_TIMEOUT = 0.15
ROLLBACK_TIMEOUT = 0.05
WATCHDOG = 3.0
TEST_USER = UserRead(
    id=uuid4(), organization_id=uuid4(), email="timeouts@example.test", full_name="Timeout test",
    is_active=True, created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
)
# The driver endpoints under test read only current_driver.id.
TEST_DRIVER = SimpleNamespace(id=uuid4())


async def select_one(db: DatabaseSession, **kwargs: object) -> list[object]:
    """Stand-in for list_trips: one real query through the request's session."""
    await db.execute(text("SELECT 1"))
    return []


async def active_statements(connection: AsyncConnection, marker: str) -> int:
    """Count server backends still executing a statement tagged with marker."""
    # PostgreSQL snapshots activity once per transaction; clear it so each poll is current.
    await connection.execute(text("SELECT pg_stat_clear_snapshot()"))
    count = await connection.scalar(text(
        "SELECT count(*) FROM pg_stat_activity"
        " WHERE state = 'active' AND pid <> pg_backend_pid() AND query LIKE :pattern"
    ), {"pattern": f"%{marker}%"})
    return int(count or 0)


@asynccontextmanager
async def stalled_database() -> AsyncGenerator[int, None]:
    """Accept TCP but never answer PostgreSQL's handshake. No unreachable-IP guessing."""
    connections: set[asyncio.StreamWriter] = set()

    def accept(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        connections.add(writer)

    server = await asyncio.start_server(accept, "127.0.0.1", 0)
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        for writer in connections:
            writer.close()
        # Python 3.13 waits for accepted transports too, so close them before waiting
        # on the listener. A fixture teardown hang must also fail rather than stall CI.
        async with asyncio.timeout(WATCHDOG):
            await asyncio.gather(*(writer.wait_closed() for writer in connections))
            await server.wait_closed()


@dataclass
class _Relay:
    silent: bool = False


class SilencingProxy:
    """TCP relay to the test database whose open connections can go silent.

    Models a NAT dropping an idle mapping without a reset: the socket stays open, but
    nothing arrives. New connections (such as asyncpg's cancel request) still get through.
    """

    def __init__(self, host: str, port: int) -> None:
        self._target = (host, port)
        self._relays: list[_Relay] = []
        self._writers: set[asyncio.StreamWriter] = set()

    def silence_open_connections(self) -> None:
        for relay in self._relays:
            relay.silent = True

    async def _pump(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, relay: _Relay) -> None:
        try:
            while data := await reader.read(65536):
                if not relay.silent:
                    writer.write(data)
                    await writer.drain()
        except OSError:
            pass  # The other side reset; closing below ends the relay either way.
        finally:
            writer.close()

    async def accept(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        server_reader, server_writer = await asyncio.open_connection(*self._target)
        relay = _Relay()
        self._relays.append(relay)
        self._writers.update({client_writer, server_writer})
        await asyncio.gather(
            self._pump(client_reader, server_writer, relay), self._pump(server_reader, client_writer, relay),
        )

    async def close(self) -> None:
        for writer in self._writers:
            writer.close()
        async with asyncio.timeout(WATCHDOG):
            await asyncio.gather(*(writer.wait_closed() for writer in self._writers), return_exceptions=True)


def disposable_test_url() -> URL:
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL required for real PostgreSQL timeout checks")
    url = make_url(settings.TEST_DATABASE_URL)
    # These checks need no schema and never use DATABASE_URL as a fallback. Match
    # the existing disposable compose/CI database, not a shared Supabase project.
    if url.host not in {"localhost", "127.0.0.1", "::1", "test-db"} or url.database != "freightproof_test":
        pytest.fail("FP-275 tests require the local disposable freightproof_test database")
    return url


@pytest.fixture
async def proxied_engine() -> AsyncGenerator[tuple[AsyncEngine, SilencingProxy], None]:
    url = disposable_test_url()
    proxy = SilencingProxy(url.host or "localhost", url.port or 5432)
    server = await asyncio.start_server(proxy.accept, "127.0.0.1", 0)
    proxied_url = url.set(host="127.0.0.1", port=server.sockets[0].getsockname()[1])
    config = settings.model_copy(update={
        "DATABASE_URL": proxied_url.render_as_string(hide_password=False),
        "DB_POOL_SIZE": 1, "DB_MAX_OVERFLOW": 0, "DB_COMMAND_TIMEOUT_SECONDS": SHORT_TIMEOUT,
    })
    engine = create_db_engine(config)
    try:
        yield engine, proxy
    finally:
        await engine.dispose()
        server.close()
        await proxy.close()


@pytest.fixture
async def local_engine() -> AsyncGenerator[AsyncEngine, None]:
    url = disposable_test_url()
    config = settings.model_copy(update={
        "DATABASE_URL": url.render_as_string(hide_password=False), "DB_POOL_SIZE": 1, "DB_MAX_OVERFLOW": 0,
        "DB_POOL_TIMEOUT_SECONDS": SHORT_TIMEOUT, "DB_COMMAND_TIMEOUT_SECONDS": SHORT_TIMEOUT,
    })
    engine = create_db_engine(config)
    try:
        yield engine
    finally:
        await engine.dispose()


async def test_stalled_connect_times_out_through_real_asyncpg() -> None:
    async with stalled_database() as port:
        config = settings.model_copy(update={
            "DATABASE_URL": f"postgresql+asyncpg://test:test@127.0.0.1:{port}/test?ssl=disable",
            "DB_CONNECT_TIMEOUT_SECONDS": SHORT_TIMEOUT,
        })
        engine = create_db_engine(config)
        try:
            started = asyncio.get_running_loop().time()
            async with asyncio.timeout(WATCHDOG):
                with pytest.raises(DatabaseUnavailableError) as caught:
                    async with engine.connect():
                        pytest.fail("The handshake must not succeed")
            elapsed = asyncio.get_running_loop().time() - started

            assert caught.value.reason == "connect_timeout"
            assert SHORT_TIMEOUT * 0.8 <= elapsed < WATCHDOG
            assert isinstance(engine.pool, AvailabilityPool)
            assert engine.pool.checkedout() == 0
        finally:
            await engine.dispose()


async def test_pool_wait_times_out_then_recovers(local_engine: AsyncEngine) -> None:
    async with local_engine.connect() as held:
        await held.execute(text("SELECT 1"))
        started = asyncio.get_running_loop().time()

        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(DatabaseUnavailableError) as caught:
                async with local_engine.connect():
                    pytest.fail("The only connection is held")

        assert caught.value.reason == "pool_timeout"
        assert SHORT_TIMEOUT * 0.8 <= asyncio.get_running_loop().time() - started < WATCHDOG

    async with local_engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1
    assert isinstance(local_engine.pool, AvailabilityPool)
    assert local_engine.pool.checkedout() == 0


async def test_timeout_inside_optional_phase_work_returns_503_and_recovers(
    proxied_engine: tuple[AsyncEngine, SilencingProxy], api_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    engine, proxy = proxied_engine
    factory = async_sessionmaker(engine, class_=DatabaseSession, expire_on_commit=False)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", factory)
    caplog.set_level(logging.WARNING)

    async def complete(db: DatabaseSession, **kwargs: object) -> None:
        await db.execute(text("SELECT 1"))
        proxy.silence_open_connections()
        await _raise_position_disagreement_if_unrecorded(
            db, trip=Trip(id=uuid4()),
            event=PhaseEvent(id=uuid4(), pulsit_geofence_confirmed=False),
        )
        raise AssertionError("A database outage must not be swallowed as optional work")

    monkeypatch.setattr(phases, "complete_phase", complete)
    async with asyncio.timeout(WATCHDOG):
        response = await api_client.post(
            f"/api/v1/trips/{uuid4()}/phases/{uuid4()}/complete", json=PHASE_COMPLETE_BODY,
        )

    assert response.status_code == 503
    assert response.json() == {"detail": DATABASE_UNAVAILABLE_DETAIL}
    assert "reason=command_timeout operation=command" in caplog.text
    assert "route=/api/v1/trips/{trip_id}/phases/{phase_event_id}/complete" in caplog.text
    assert "PendingRollbackError" not in caplog.text
    assert isinstance(engine.pool, AvailabilityPool)
    assert engine.pool.checkedout() == 0
    async with engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1


async def test_service_conflict_survives_real_stalled_rollback(
    proxied_engine: tuple[AsyncEngine, SilencingProxy], monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    engine, proxy = proxied_engine
    monkeypatch.setattr(settings, "DB_CLEANUP_TIMEOUT_SECONDS", ROLLBACK_TIMEOUT)
    primary = ConsignmentAlreadyAssignedError("test-waybill", "existing-trip")

    async def rejected_sync() -> NoReturn:
        raise primary

    async with DatabaseSession(bind=engine) as session:
        await session.execute(text("SELECT 1"))
        proxy.silence_open_connections()
        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(ConsignmentAlreadyAssignedError) as caught:
                await _sync_cargo_entry(session, "test-waybill", rejected_sync())

    assert caught.value is primary
    assert "Database rollback failed error_type=DatabaseUnavailableError" in caplog.text
    assert isinstance(engine.pool, AvailabilityPool)
    assert engine.pool.checkedout() == 0
    async with engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1


async def test_slow_command_times_out_and_discards_connection(local_engine: AsyncEngine) -> None:
    loop = asyncio.get_running_loop()
    marker = f"fp275-cancel-{uuid4().hex}"
    async with local_engine.connect() as connection:
        started = loop.time()

        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(DatabaseUnavailableError) as caught:
                await connection.execute(text(f"SELECT pg_sleep(:seconds) /* {marker} */"), {"seconds": WATCHDOG * 2})

        assert caught.value.reason == "command_timeout"
        assert SHORT_TIMEOUT * 0.8 <= loop.time() - started < WATCHDOG
        assert connection.invalidated

    async with local_engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1
        # Freeing the client is not enough: PostgreSQL must cancel the statement too, or
        # its backend keeps running (and holding locks) after the 503 (FP-299).
        deadline = loop.time() + WATCHDOG
        while await active_statements(recovered, marker) and loop.time() < deadline:
            await asyncio.sleep(SHORT_TIMEOUT)
        assert await active_statements(recovered, marker) == 0
    assert isinstance(local_engine.pool, AvailabilityPool)
    assert local_engine.pool.checkedout() == 0


async def test_pre_ping_timeout_is_classified_and_releases_pool(
    local_engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with local_engine.connect() as connection:
        await connection.execute(text("SELECT 1"))

    def failed_ping(connection: object) -> bool:
        raise TimeoutError("pre-ping never answered")

    with monkeypatch.context() as patch:
        patch.setattr(local_engine.sync_engine.dialect, "do_ping", failed_ping)
        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(DatabaseUnavailableError) as caught:
                async with local_engine.connect():
                    pytest.fail("The ping must fail")
        assert caught.value.reason == "checkout_timeout"

    async with local_engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1


async def test_silent_connection_command_timeout_is_bounded(
    proxied_engine: tuple[AsyncEngine, SilencingProxy],
) -> None:
    # A half-open socket never acknowledges the cancel. asyncpg 0.32+ (the requirements.txt
    # floor) bounds that close; 0.30-0.31 waited for the acknowledgement forever.
    engine, proxy = proxied_engine
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
        proxy.silence_open_connections()

        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(DatabaseUnavailableError) as caught:
                await connection.execute(text("SELECT 1"))

    assert caught.value.reason == "command_timeout"
    assert isinstance(engine.pool, AvailabilityPool)
    assert engine.pool.checkedout() == 0
    async with engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1


async def test_silent_idle_connection_fails_pre_ping_within_budget(
    proxied_engine: tuple[AsyncEngine, SilencingProxy],
) -> None:
    engine, proxy = proxied_engine
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    proxy.silence_open_connections()

    async with asyncio.timeout(WATCHDOG):
        with pytest.raises(DatabaseUnavailableError) as caught:
            async with engine.connect():
                pytest.fail("A silent pooled connection must not pass its ping")

    assert caught.value.reason == "checkout_timeout"
    assert isinstance(engine.pool, AvailabilityPool)
    assert engine.pool.checkedout() == 0
    async with engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1


@pytest.fixture
async def api_client() -> AsyncGenerator[AsyncClient, None]:
    async def user() -> UserRead:
        return TEST_USER

    async def driver() -> SimpleNamespace:
        return TEST_DRIVER

    app = main_module.app
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_current_dispatcher] = user
    app.dependency_overrides[require_admin_dispatcher] = user
    app.dependency_overrides[get_current_driver] = driver
    try:
        transport = ASGITransport(app=app, raise_app_exceptions=False)  # type: ignore[arg-type]
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


async def test_real_api_pool_timeout_returns_503_and_recovers(
    local_engine: AsyncEngine, api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    factory = async_sessionmaker(local_engine, class_=DatabaseSession, expire_on_commit=False)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", factory)
    monkeypatch.setattr(trips, "list_trips", select_one)
    caplog.set_level(logging.WARNING)
    async with local_engine.connect():
        async with asyncio.timeout(WATCHDOG):
            response = await api_client.get("/api/v1/trips", headers={"Origin": "http://localhost:3000"})

    assert response.status_code == 503
    assert response.json() == {"detail": DATABASE_UNAVAILABLE_DETAIL}
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "reason=pool_timeout" in caplog.text
    assert "SELECT" not in response.text
    recovered = await api_client.get("/api/v1/trips")
    assert recovered.status_code == 200
    assert isinstance(local_engine.pool, AvailabilityPool)
    assert local_engine.pool.checkedout() == 0


async def test_partner_timeout_is_not_labelled_database_failure(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No query: the session remains lazy and its empty rollback/close needs no DB.
    monkeypatch.setattr(trips, "list_trips", AsyncMock(side_effect=TimeoutError("partner timeout")))

    response = await api_client.get("/api/v1/trips")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error."}


async def test_commit_failure_cannot_return_a_success_response(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = DatabaseSession()
    rollback, close = AsyncMock(), AsyncMock()
    monkeypatch.setattr(session, "commit", AsyncMock(side_effect=DatabaseUnavailableError("command_timeout", "command")))
    monkeypatch.setattr(session, "rollback", rollback)
    monkeypatch.setattr(session, "close", close)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(trips, "list_trips", AsyncMock(return_value=[]))

    response = await api_client.get("/api/v1/trips")

    assert response.status_code == 503
    rollback.assert_awaited_once()
    close.assert_awaited_once()


AUDIT_PACK_BODY = {
    "recipient_name": "Claims desk", "recipient_organization": "Insurer",
    "recipient_email": "claims@insurer.example", "purpose": "insurance_claim",
}
PHASE_COMPLETE_BODY = {"phase_type": PhaseType.IN_TRANSIT.value, "idempotency_key": "fp-275-availability"}


# Every route that maps SQLAlchemyError to a 500 must let an availability error reach
# the shared 503 handler instead. The trip case uses the manifest preview because it
# needs no body; create and create-from-manifest share the same _trip_http_error mapper.
@pytest.mark.parametrize(
    ("module", "service", "method", "path", "body"),
    [
        pytest.param(trip_admin, "cancel_trip", "POST", "/trips/{trip}/cancel", {"note": "Test cancellation"},
                     id="cancel"),
        pytest.param(trip_admin, "override_phase", "POST", "/trips/{trip}/phases/{phase}/override",
                     {"note": "Test override"}, id="override"),
        pytest.param(audit_packs, "build_audit_manifest", "GET", "/trips/{trip}/audit-trail/preview", None,
                     id="audit-preview"),
        pytest.param(audit_packs, "render_preview_pdf", "GET", "/trips/{trip}/audit-trail/preview.pdf", None,
                     id="audit-pdf"),
        pytest.param(audit_packs, "issue_audit_pack", "POST", "/trips/{trip}/audit-packs", AUDIT_PACK_BODY,
                     id="audit-issue"),
        pytest.param(phases, "complete_phase", "POST", "/trips/{trip}/phases/{phase}/complete", PHASE_COMPLETE_BODY,
                     id="phase-complete"),
        pytest.param(trips, "preview_pp_manifest", "GET", "/trips/pp-manifest-preview?manifest_number=1", None,
                     id="trip-mapper"),
    ],
)
async def test_error_mappers_pass_availability_errors_through(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
    module: ModuleType, service: str, method: str, path: str, body: dict[str, str] | None,
) -> None:
    monkeypatch.setattr(module, service, AsyncMock(side_effect=DatabaseUnavailableError("connection_unavailable", "connect")))
    url = "/api/v1" + path.format(trip=uuid4(), phase=uuid4())

    response = await api_client.request(method, url, json=body)

    assert response.status_code == 503
    assert response.json() == {"detail": DATABASE_UNAVAILABLE_DETAIL}


async def test_handover_commit_passes_availability_error_through(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(handover, "load_confirmation_target_for_write", AsyncMock(return_value=object()))
    monkeypatch.setattr(handover, "ensure_handover_open", AsyncMock())
    failure = DatabaseUnavailableError("command_timeout", "command")
    monkeypatch.setattr(handover, "rotate_next_token", AsyncMock(side_effect=failure))

    response = await api_client.post(f"/api/v1/trips/{uuid4()}/phases/{uuid4()}/handover/tokens")

    assert response.status_code == 503
    assert response.json() == {"detail": DATABASE_UNAVAILABLE_DETAIL}


async def test_handover_preserves_primary_sql_error_when_rollback_also_fails(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    session = DatabaseSession()
    monkeypatch.setattr(session, "rollback", AsyncMock(side_effect=DatabaseUnavailableError("cleanup_timeout", "rollback")))
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(handover, "load_confirmation_target_for_write", AsyncMock(return_value=object()))
    monkeypatch.setattr(handover, "ensure_handover_open", AsyncMock())
    monkeypatch.setattr(handover, "rotate_next_token", AsyncMock(side_effect=SQLAlchemyError("primary SQL failure")))

    response = await api_client.post(f"/api/v1/trips/{uuid4()}/phases/{uuid4()}/handover/tokens")

    assert response.status_code == 500
    assert response.json() == {"detail": "Could not issue a handover code."}
    assert "Failed to issue a handover token" in caplog.text
    assert "Database rollback failed error_type=DatabaseUnavailableError" in caplog.text


async def test_refused_connection_is_classified_and_returns_503(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    # Bind then release a port: nothing listens on it, so the connect is refused, the
    # common shape of "the database is down" as opposed to a stalled handshake.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    config = settings.model_copy(update={
        "DATABASE_URL": f"postgresql+asyncpg://test:test@127.0.0.1:{port}/test?ssl=disable",
    })
    engine = create_db_engine(config)
    monkeypatch.setattr(
        session_module, "AsyncSessionLocal",
        async_sessionmaker(engine, class_=DatabaseSession, expire_on_commit=False),
    )
    monkeypatch.setattr(trips, "list_trips", select_one)
    caplog.set_level(logging.WARNING)
    try:
        async with asyncio.timeout(WATCHDOG):
            with pytest.raises(DatabaseUnavailableError) as caught:
                async with engine.connect():
                    pytest.fail("Nothing listens on the port")
        async with asyncio.timeout(WATCHDOG):
            response = await api_client.get("/api/v1/trips")
    finally:
        await engine.dispose()

    assert (caught.value.reason, caught.value.operation) == ("connection_unavailable", "connect")
    assert response.status_code == 503
    assert response.json() == {"detail": DATABASE_UNAVAILABLE_DETAIL}
    assert "reason=connection_unavailable operation=connect" in caplog.text


async def test_request_cancellation_during_query_releases_connection(
    local_engine: AsyncEngine,
) -> None:
    factory = async_sessionmaker(local_engine, class_=DatabaseSession)
    running = asyncio.Event()

    async def query() -> None:
        async with factory() as session:
            await session.execute(text("SELECT 1"))
            running.set()
            await session.execute(text("SELECT pg_sleep(:seconds)"), {"seconds": WATCHDOG * 2})

    async with asyncio.timeout(WATCHDOG):
        task = asyncio.create_task(query())
        await running.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    async with local_engine.connect() as recovered:
        assert await recovered.scalar(text("SELECT 1")) == 1
    assert isinstance(local_engine.pool, AvailabilityPool)
    assert local_engine.pool.checkedout() == 0
