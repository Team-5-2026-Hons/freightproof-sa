"""Construct the API engine with the same timeout policy in production and tests."""

import asyncio
import logging
from collections.abc import Callable

from sqlalchemy import event
from sqlalchemy.engine import AdaptedConnection, Dialect, ExceptionContext
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool, ConnectionPoolEntry, PoolProxiedConnection

from app.core.config import Settings
from app.db.errors import DatabaseUnavailableError, database_unavailable

logger = logging.getLogger(__name__)


class AvailabilityPool(AsyncAdaptedQueuePool):
    """Cover checkout failures that SQLAlchemy's handle_error event does not receive.

    Queue exhaustion and raw asyncpg pre-ping timeouts can escape before a SQLAlchemy
    Connection exists. Wrapping this public pool method preserves lazy acquisition, so
    invalid credentials are still rejected before the request opens a DB connection.
    """

    def connect(self) -> PoolProxiedConnection:
        try:
            return super().connect()
        except Exception as exc:
            failure = database_unavailable(exc, "checkout")
            if failure is not None and failure is not exc:
                raise failure from exc
            raise


def _connect(
    dialect: Dialect, connection_record: ConnectionPoolEntry,
    cargs: list[object], cparams: dict[str, object],
) -> DBAPIConnection:
    # asyncpg can raise a builtin TimeoutError or OSError before SQLAlchemy's DBAPI
    # wrapping applies. This hook gives those errors an unambiguous DB origin.
    try:
        return dialect.connect(*cargs, **cparams)
    except Exception as exc:
        failure = database_unavailable(exc, "connect")
        if failure is not None:
            raise failure from exc
        raise


def _handle_error(context: ExceptionContext) -> DatabaseUnavailableError | None:
    # Let SQLAlchemy transparently replace an already-disconnected idle connection.
    # A failed replacement or stalled ping is classified by AvailabilityPool above.
    if context.is_pre_ping:
        return None
    failure = database_unavailable(
        context.original_exception, "command", disconnected=context.is_disconnect,
    )
    if failure is not None:
        # A timed-out command must never return a possibly still-busy socket to the
        # next request. Discard that connection, not every healthy connection.
        # SQLAlchemy documents these writable flags, but its abstract context type
        # declares empty __slots__; the runtime ExceptionContextImpl owns the slots.
        context.is_disconnect = True  # type: ignore[misc]
        context.invalidate_pool_on_disconnect = False  # type: ignore[misc]
    return failure


def _bounded_discard(
    cleanup_timeout: float,
) -> Callable[[DBAPIConnection, ConnectionPoolEntry, BaseException | None], None]:
    """Give a discarded connection one cleanup budget to close, then abort its socket.

    SQLAlchemy closes an invalidated asyncpg connection gracefully. After a command or
    pre-ping timeout, asyncpg 0.30-0.31 (still allowed by requirements.txt) first waits,
    with no limit, for the server to acknowledge the cancel on the old socket. A silently
    dropped (half-open) socket never answers, so the request and its pool slot would hang
    for good. asyncpg 0.32 bounds that wait itself; this keeps the guarantee across the
    supported range. Once the socket is closed or aborted, SQLAlchemy's close returns at once.
    """

    def discard(
        dbapi_connection: DBAPIConnection, connection_record: ConnectionPoolEntry,
        exception: BaseException | None,
    ) -> None:
        if not isinstance(dbapi_connection, AdaptedConnection):
            return
        try:
            dbapi_connection.run_async(lambda driver: asyncio.wait_for(driver.close(), cleanup_timeout))
        except Exception as close_error:
            # Timed out or failed: asyncpg has already aborted the socket in that case,
            # and terminate() is the no-wait fallback for anything that slipped past.
            logger.warning("Discarded database connection aborted error_type=%s", type(close_error).__name__)
            driver = dbapi_connection.driver_connection
            if not driver.is_closed():
                driver.terminate()

    return discard


def create_db_engine(config: Settings) -> AsyncEngine:
    engine = create_async_engine(
        config.DATABASE_URL,
        poolclass=AvailabilityPool,
        pool_pre_ping=True,
        pool_size=config.DB_POOL_SIZE,
        max_overflow=config.DB_MAX_OVERFLOW,
        pool_timeout=config.DB_POOL_TIMEOUT_SECONDS,
        connect_args={
            "timeout": config.DB_CONNECT_TIMEOUT_SECONDS,
            "command_timeout": config.DB_COMMAND_TIMEOUT_SECONDS,
        },
    )
    event.listen(engine.sync_engine, "do_connect", _connect)
    event.listen(engine.sync_engine, "handle_error", _handle_error, retval=True)
    event.listen(engine.sync_engine.pool, "invalidate", _bounded_discard(config.DB_CLEANUP_TIMEOUT_SECONDS))
    return engine
