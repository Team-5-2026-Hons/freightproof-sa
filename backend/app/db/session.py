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
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
)

# expire_on_commit=False prevents SQLAlchemy from expiring all attributes after
# commit, which would trigger lazy loads — illegal in an async context.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session per request.

    Usage:
        async def my_endpoint(db: AsyncSession = Depends(get_db)): ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
