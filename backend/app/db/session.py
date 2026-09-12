"""Async database session factory for FreightProof SA.

The engine connects to Supabase-hosted Postgres via the asyncpg driver.
Import `get_db` as a FastAPI dependency wherever a database session is needed.
Import `engine` in Alembic's env.py if a shared engine instance is ever required.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# pool_pre_ping=True reissues a cheap SELECT 1 before each checkout so stale
# connections to Supabase (which drops idle connections aggressively) are
# detected and recycled rather than surfaced as errors in request handlers.
#
# pool_size/max_overflow are explicit (not SQLAlchemy's default 5+10=15) because that
# default happens to equal Supabase's session-mode pooler ceiling of 15 clients for the
# whole project — one backend instance alone could exhaust every slot four devs share.
# See DB_POOL_SIZE/DB_MAX_OVERFLOW in core/config.py for the reasoning.
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
)

# expire_on_commit=False prevents SQLAlchemy from expiring all attributes after
# commit, which would trigger lazy loads — illegal in an async context.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_read_only_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for handlers that only read, and must stay bounded.

    Deliberately shares the engine and pool with get_db(): a session on a private
    connection could report a healthy database while every real request starved on an
    exhausted pool, which is the opposite of what a health check is for.

    What it does not do is commit. get_db() commits unconditionally on the way out, and
    that commit is unbounded — on a database that hangs rather than refuses, the COMMIT
    has to travel the same dead connection the handler already gave up on, so /health
    would inherit the very hang its per-probe timeouts exist to escape. A reader has
    nothing to commit, so the safest bound is not to issue the statement at all.

    Teardown is left to the context manager. Note that close() still returns the
    connection to the pool, which for a live transaction means a ROLLBACK on the wire —
    so a handler that gives up on a hung connection must call session.invalidate()
    before returning (see _probe_database in main.py). Invalidation drops the connection
    outright rather than talking to it, which is the only teardown a dead socket can
    honour; close() afterwards is then a local no-op.
    """
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
