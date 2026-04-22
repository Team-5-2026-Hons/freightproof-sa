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


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (outputs SQL to stdout)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
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
