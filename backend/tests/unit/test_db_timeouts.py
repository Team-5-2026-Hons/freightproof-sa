"""FP-275: configuration, failure classification, and cancellation-safe cleanup."""

import asyncio
import socket
from collections.abc import AsyncGenerator
from importlib.metadata import version
from unittest.mock import AsyncMock

import pytest
from asyncpg.exceptions import (  # type: ignore[import-untyped]  # asyncpg ships no type stubs
    AdminShutdownError,
    CannotConnectNowError,
    ConnectionFailureError,
    InternalServerError,
    InvalidPasswordError,
    QueryCanceledError,
    TooManyConnectionsError,
)
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.db import session as session_module
from app.db.errors import (
    DatabaseFailureReason,
    DatabaseOperation,
    DatabaseUnavailableError,
    database_unavailable,
)
from app.db.session import DatabaseSession, get_db, get_read_only_db

TIMEOUT_FIELDS = (
    "DB_CONNECT_TIMEOUT_SECONDS", "DB_POOL_TIMEOUT_SECONDS",
    "DB_COMMAND_TIMEOUT_SECONDS", "DB_CLEANUP_TIMEOUT_SECONDS",
)
SHORT_TIMEOUT = 0.05
WATCHDOG = 2.0
MINIMUM_ASYNCPG = (0, 32)


def test_installed_asyncpg_bounds_discarded_connection_close() -> None:
    installed = tuple(int(part) for part in version("asyncpg").split(".")[:2])

    assert installed >= MINIMUM_ASYNCPG, "Reinstall backend/requirements.txt: asyncpg 0.32+ is required"


@pytest.mark.parametrize("field", TIMEOUT_FIELDS)
@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), "garbage"])
def test_timeout_rejects_invalid_value(field: str, value: object) -> None:
    values = settings.model_dump()
    values[field] = value

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize("field", TIMEOUT_FIELDS)
@pytest.mark.parametrize("value", ["", "  "])
def test_blank_timeout_uses_default(field: str, value: str) -> None:
    values = settings.model_dump()
    values[field] = value

    config = Settings(_env_file=None, **values)

    assert getattr(config, field) == Settings.model_fields[field].default


def test_database_failure_classification_is_narrow() -> None:
    pool = database_unavailable(PoolTimeoutError("sensitive detail"), "checkout")
    connect = database_unavailable(TimeoutError(), "connect")
    command = database_unavailable(TimeoutError(), "command")
    lost = database_unavailable(
        OperationalError("SQL", {"secret": "value"}, Exception(), connection_invalidated=True), "command",
    )

    assert pool is not None and pool.reason == "pool_timeout"
    assert connect is not None and connect.reason == "connect_timeout"
    assert command is not None and command.reason == "command_timeout"
    assert lost is not None and lost.reason == "connection_unavailable"
    assert database_unavailable(IntegrityError("SQL", {}, Exception()), "command") is None
    assert database_unavailable(OperationalError("SQL", {}, Exception()), "command") is None
    assert database_unavailable(asyncio.CancelledError(), "command") is None
    assert database_unavailable(asyncio.CancelledError(), "command", disconnected=True) is None
    assert str(pool) == "Database temporarily unavailable."


@pytest.mark.parametrize(
    ("error", "operation", "reason"),
    [
        (ConnectionRefusedError(), "connect", "connection_unavailable"),
        (socket.gaierror(), "connect", "connection_unavailable"),
        (ConnectionFailureError("connection failure"), "command", "connection_unavailable"),
        (AdminShutdownError("terminating connection"), "command", "connection_unavailable"),
        (CannotConnectNowError("the database system is starting up"), "connect", "connection_unavailable"),
        (TooManyConnectionsError("too many clients"), "connect", "server_capacity"),
        (InternalServerError("(EMAXCONNSESSION) max clients reached in session mode"), "connect", "server_capacity"),
        (InternalServerError("(ECHECKOUTTIMEOUT) unable to check out connection"), "connect", "server_capacity"),
    ],
)
def test_unreachable_or_full_database_is_classified(
    error: Exception, operation: DatabaseOperation, reason: DatabaseFailureReason,
) -> None:
    failure = database_unavailable(error, operation)

    assert failure is not None
    assert (failure.reason, failure.operation) == (reason, operation)


@pytest.mark.parametrize(
    ("error", "operation"),
    [
        (InternalServerError("(EMAXCONNSESSION) max clients reached in session mode"), "command"),
        (InternalServerError("unexpected internal error"), "connect"),
        (QueryCanceledError("canceling statement due to statement timeout"), "command"),
        (InvalidPasswordError("password authentication failed"), "connect"),
    ],
)
def test_other_server_errors_keep_their_own_handling(error: Exception, operation: DatabaseOperation) -> None:
    assert database_unavailable(error, operation) is None


@pytest.mark.parametrize("operation", ["rollback", "close"])
async def test_cleanup_timeout_discards_session(
    monkeypatch: pytest.MonkeyPatch, operation: str,
) -> None:
    monkeypatch.setattr(settings, "DB_CLEANUP_TIMEOUT_SECONDS", SHORT_TIMEOUT)
    cancelled = asyncio.Event()

    async def stall(self: AsyncSession) -> None:
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    discard = AsyncMock()
    monkeypatch.setattr(AsyncSession, operation, stall)
    monkeypatch.setattr(AsyncSession, "invalidate", discard)
    session = DatabaseSession()

    async with asyncio.timeout(WATCHDOG):
        with pytest.raises(DatabaseUnavailableError) as caught:
            await getattr(session, operation)()

    assert caught.value.reason == "cleanup_timeout"
    assert caught.value.operation == operation
    assert cancelled.is_set()
    discard.assert_awaited_once()


async def test_cleanup_cancellation_discards_then_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    entered = asyncio.Event()

    async def stall(self: AsyncSession) -> None:
        entered.set()
        await asyncio.Event().wait()

    discard = AsyncMock()
    monkeypatch.setattr(AsyncSession, "rollback", stall)
    monkeypatch.setattr(AsyncSession, "invalidate", discard)
    session = DatabaseSession()

    async with asyncio.timeout(WATCHDOG):
        task = asyncio.create_task(session.rollback())
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    discard.assert_awaited_once()


@pytest.mark.parametrize("primary", [HTTPException(409, "conflict"), asyncio.CancelledError()])
async def test_dependency_preserves_primary_failure_when_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch, primary: BaseException,
) -> None:
    session = DatabaseSession()
    rollback = AsyncMock(side_effect=RuntimeError("rollback failed"))
    close = AsyncMock(side_effect=RuntimeError("close failed"))
    commit = AsyncMock()
    monkeypatch.setattr(session, "rollback", rollback)
    monkeypatch.setattr(session, "close", close)
    monkeypatch.setattr(session, "commit", commit)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    dependency = get_db()
    await anext(dependency)

    with pytest.raises(type(primary)) as caught:
        await dependency.athrow(primary)

    assert caught.value is primary
    commit.assert_not_awaited()
    rollback.assert_awaited_once()
    close.assert_awaited_once()


async def test_dependency_commits_success_and_closes_once(monkeypatch: pytest.MonkeyPatch) -> None:
    session = DatabaseSession()
    commit, rollback, close = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(session, "commit", commit)
    monkeypatch.setattr(session, "rollback", rollback)
    monkeypatch.setattr(session, "close", close)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    dependency: AsyncGenerator[AsyncSession, None] = get_db()
    assert await anext(dependency) is session

    with pytest.raises(StopAsyncIteration):
        await anext(dependency)

    commit.assert_awaited_once()
    rollback.assert_not_awaited()
    close.assert_awaited_once()


async def test_dependency_rolls_back_without_committing_when_the_request_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WI-27 item 1, the failure half: a handler error must discard the request's writes.

    The test above covers the case where rollback itself fails; this is the ordinary path.
    """
    session = DatabaseSession()
    commit, rollback, close = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(session, "commit", commit)
    monkeypatch.setattr(session, "rollback", rollback)
    monkeypatch.setattr(session, "close", close)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    dependency: AsyncGenerator[AsyncSession, None] = get_db()
    await anext(dependency)
    failure = HTTPException(409, "conflict")

    with pytest.raises(HTTPException) as caught:
        await dependency.athrow(failure)

    assert caught.value is failure
    commit.assert_not_awaited()
    rollback.assert_awaited_once()
    close.assert_awaited_once()


def _read_only_session(monkeypatch: pytest.MonkeyPatch, close: AsyncMock) -> tuple[DatabaseSession, AsyncMock]:
    session = DatabaseSession()
    commit = AsyncMock()
    monkeypatch.setattr(session, "commit", commit)
    monkeypatch.setattr(session, "close", close)
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: session)
    return session, commit


async def test_read_only_dependency_closes_once_without_committing(monkeypatch: pytest.MonkeyPatch) -> None:
    close = AsyncMock()
    session, commit = _read_only_session(monkeypatch, close)
    dependency = get_read_only_db()
    assert await anext(dependency) is session

    with pytest.raises(StopAsyncIteration):
        await anext(dependency)

    commit.assert_not_awaited()
    close.assert_awaited_once()


async def test_read_only_dependency_preserves_primary_failure_when_close_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    close = AsyncMock(side_effect=RuntimeError("close failed"))
    _read_only_session(monkeypatch, close)
    dependency = get_read_only_db()
    await anext(dependency)
    primary = HTTPException(409, "conflict")

    with pytest.raises(HTTPException) as caught:
        await dependency.athrow(primary)

    assert caught.value is primary
    close.assert_awaited_once()


async def test_read_only_dependency_reports_close_failure_after_clean_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = DatabaseUnavailableError("cleanup_timeout", "close")
    close = AsyncMock(side_effect=failure)
    _read_only_session(monkeypatch, close)
    dependency = get_read_only_db()
    await anext(dependency)

    with pytest.raises(DatabaseUnavailableError) as caught:
        await anext(dependency)

    assert caught.value is failure
