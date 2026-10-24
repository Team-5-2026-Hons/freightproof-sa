"""API database sessions: bounded DB operations, cleanup, and transaction ownership."""

import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.db.cleanup import rollback_after_error
from app.db.engine import create_db_engine
from app.db.errors import DatabaseOperation, DatabaseUnavailableError

logger = logging.getLogger(__name__)


class DatabaseSession(AsyncSession):
    """Bound cleanup even when services explicitly roll back before returning.

    Driver command_timeout covers SQL round trips. A separate cleanup budget also
    covers rollback and close, including a failure during rollback itself. The
    invalidate() fallback needs no timeout here: SQLAlchemy closes a discarded
    connection within its own 2 s limit, which asyncpg 0.32+ enforces (see
    create_db_engine in db/engine.py).
    """

    async def _cleanup(
        self, action: Callable[[], Awaitable[None]], operation: DatabaseOperation,
    ) -> None:
        try:
            async with asyncio.timeout(settings.DB_CLEANUP_TIMEOUT_SECONDS):
                await action()
        except BaseException as exc:
            # Includes cancellation: returning a connection whose operation is still
            # in flight would poison the next request. Preserve the original failure.
            try:
                await self.invalidate()
            except Exception as discard_error:
                logger.warning("Database discard failed error_type=%s", type(discard_error).__name__)
            if isinstance(exc, TimeoutError):
                raise DatabaseUnavailableError("cleanup_timeout", operation) from exc
            raise

    async def rollback(self) -> None:
        await self._cleanup(super().rollback, "rollback")

    async def close(self) -> None:
        await self._cleanup(super().close, "close")


# pool_pre_ping=True detects and recycles stale connections before checkout, since
# Supabase drops idle connections aggressively.
#
# pool_size/max_overflow are explicit (not SQLAlchemy's default 5+10=15): that default
# equals Supabase's session-mode pooler ceiling of 15 for the whole project, so one
# instance alone could exhaust every slot four devs share. See DB_POOL_SIZE/DB_MAX_OVERFLOW
# in core/config.py.
engine = create_db_engine(settings)

# expire_on_commit=False avoids expiring attributes after commit, which would
# trigger lazy loads — illegal in an async context.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=DatabaseSession,
    expire_on_commit=False,
)


async def get_read_only_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for read-only handlers that must stay bounded (e.g. health
    checks). Shares get_db()'s pool rather than a private connection, so a healthy check
    can't mask an exhausted pool, and never commits. A handler giving up on a hung
    connection must call session.invalidate() before returning (see _probe_database
    in main.py) — close() alone issues a ROLLBACK on the wire, not a clean teardown."""
    session = AsyncSessionLocal()
    failed = False
    try:
        yield session
    except BaseException:
        failed = True
        raise
    finally:
        await _close_session(session, failed=failed)


async def _close_session(session: AsyncSession, *, failed: bool) -> None:
    try:
        await session.close()
    except Exception as cleanup_error:
        if not failed:
            raise
        logger.warning("Database close failed error_type=%s", type(cleanup_error).__name__)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session per request.

    Usage:
        async def my_endpoint(db: AsyncSession = Depends(get_db)): ...
    """
    session = AsyncSessionLocal()
    failed = False
    try:
        yield session
        await session.commit()
    except BaseException:
        failed = True
        await rollback_after_error(session)
        raise
    finally:
        # Explicit ownership avoids an additional, shielded __aexit__ close after an
        # already-bounded close. A cleanup failure must not replace a primary error.
        await _close_session(session, failed=failed)
