# Alembic migration environment for FreightProof SA.
# This file is executed by Alembic for every migration command.
# It wires the database URL from app config into Alembic's engine,
# and points target_metadata at the SQLAlchemy Base so Alembic can
# auto-generate schema diffs from model definitions.

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Load app settings so DATABASE_URL is resolved from the environment,
# not hardcoded into alembic.ini.
from app.core.config import settings

# Import Base so Alembic sees all registered models for autogenerate.
from app.db.models import Base

# Alembic Config object — provides access to values in alembic.ini.
config = context.config

# Inject the real DATABASE_URL so %(DATABASE_URL)s in alembic.ini resolves.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# Attach Python logging configuration from alembic.ini.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# target_metadata tells Alembic which models to compare against the DB
# when generating autogenerate migrations.
target_metadata = Base.metadata

# Foreign keys into Supabase's `auth` schema, installed by migration 0003 when users and
# drivers were switched onto Supabase Auth identities.
#
# They must be hidden from autogenerate. `auth.users` lives in a schema Supabase owns and
# that Base.metadata deliberately does not model, so every autogenerate run sees a foreign
# key pointing at a table it has never heard of and emits a drop_constraint for it. Applying
# one would sever every user and driver row from its auth identity — a relationship that
# cannot be rebuilt from the data that would remain.
#
# Excluded by name rather than by schema because the constraints live on OUR tables; it is
# only their target that is foreign. Naming them keeps the exclusion narrow: a genuinely
# stale FK on any other table still shows up.
_SUPABASE_AUTH_FOREIGN_KEYS = frozenset({
    "fk_users_auth_id",
    "fk_drivers_auth_id",
})


def include_object(
    object_: object, name: str | None, type_: str, reflected: bool, compare_to: object,
) -> bool:
    """Filter what autogenerate is allowed to consider.

    Deliberately narrow. This is a suppression mechanism, and a broad one would hide real
    drift — the failure mode it exists to prevent. Everything not named here is still
    compared, so a stale index or a dropped column is still reported.

    See docs/design-notes/2026-09-15-alembic-autogenerate-drift.md for the full picture.
    """
    if type_ == "foreign_key_constraint" and name in _SUPABASE_AUTH_FOREIGN_KEYS:
        return False
    return True


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (outputs SQL to stdout)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations inside a sync wrapper.

    asyncpg cannot run in a synchronous Alembic context, so we use
    async_engine_from_config and then hand off to the sync runner via
    run_sync — the standard pattern for async SQLAlchemy + Alembic.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Entry point for online (live connection) migrations."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
