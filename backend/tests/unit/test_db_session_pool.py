"""Unit tests for the async engine's connection pool sizing (app/db/session.py).

Supabase's session-mode pooler caps the whole project at 15 concurrent clients,
shared across every developer's local backend. SQLAlchemy's own defaults
(pool_size=5, max_overflow=10) happen to equal that ceiling exactly, so one
unconfigured backend instance could exhaust it alone. DB_POOL_SIZE/DB_MAX_OVERFLOW
in core/config.py exist to keep each instance's footprint well under that shared
limit — these tests guard the wiring and the safety margin, not the DB itself.
"""

from sqlalchemy.pool import QueuePool

from app.core.config import settings
from app.db.session import engine

# The pooler's project-wide ceiling (see the comment on DB_POOL_SIZE in config.py).
SUPABASE_SESSION_MODE_CLIENT_LIMIT = 15

# How many backend instances can realistically be pointed at the same dev project at
# once: one per developer on the team.
MAX_CONCURRENT_BACKEND_INSTANCES = 4


def test_engine_pool_size_matches_configured_setting() -> None:
    # engine.pool is typed as the abstract Pool base (no .size()); asserting the
    # concrete class narrows it for mypy and doubles as a check that create_async_engine
    # still hands out a QueuePool rather than something like NullPool.
    assert isinstance(engine.pool, QueuePool)
    assert engine.pool.size() == settings.DB_POOL_SIZE


def test_per_instance_ceiling_leaves_headroom_under_the_shared_pooler_limit() -> None:
    per_instance_ceiling = settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW

    assert per_instance_ceiling * MAX_CONCURRENT_BACKEND_INSTANCES <= SUPABASE_SESSION_MODE_CLIENT_LIMIT
