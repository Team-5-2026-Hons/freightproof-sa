"""Construct the API engine with the same timeout policy in production and tests."""

from sqlalchemy import event
from sqlalchemy.engine import Dialect, ExceptionContext
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool, ConnectionPoolEntry, PoolProxiedConnection

from app.core.config import Settings
from app.db.errors import DatabaseUnavailableError, database_unavailable


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
    try:
        return dialect.connect(*cargs, **cparams)
    except Exception as exc:
        failure = database_unavailable(exc, "connect")
        if failure is not None:
            raise failure from exc
        raise


def _handle_error(context: ExceptionContext) -> DatabaseUnavailableError | None:
    if context.is_pre_ping:
        return None
    failure = database_unavailable(
        context.original_exception, "command", disconnected=context.is_disconnect,
    )
    if failure is not None:
        context.is_disconnect = True  # type: ignore[misc]
        context.invalidate_pool_on_disconnect = False  # type: ignore[misc]
    return failure


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
    return engine
