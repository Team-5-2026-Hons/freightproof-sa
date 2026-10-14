"""Async database session factory for FreightProof SA: connects to Supabase Postgres
via asyncpg. Import `get_db` as a FastAPI dependency, or `engine` from Alembic's env.py."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# pool_pre_ping=True detects and recycles stale connections before checkout, since
# Supabase drops idle connections aggressively.
#
# pool_size/max_overflow are explicit (not SQLAlchemy's default 5+10=15): that default
# equals Supabase's session-mode pooler ceiling of 15 for the whole project, so one
# instance alone could exhaust every slot four devs share. See DB_POOL_SIZE/DB_MAX_OVERFLOW
# in core/config.py.
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
)

# expire_on_commit=False avoids expiring attributes after commit, which would
# trigger lazy loads — illegal in an async context.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_read_only_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for read-only handlers that must stay bounded (e.g. health
    checks). Shares get_db()'s pool rather than a private connection, so a healthy check
    can't mask an exhausted pool, and never commits, since get_db()'s commit is unbounded
    and could hang on a dead connection. A handler giving up on a hung connection must
    call session.invalidate() before returning (see _probe_database in main.py) — close()
    alone issues a ROLLBACK on the wire, not a clean teardown."""
    async with AsyncSessionLocal() as session:
        yield session


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session per request.

    Usage:
        async def my_endpoint(db: AsyncSession = Depends(get_db)): ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
