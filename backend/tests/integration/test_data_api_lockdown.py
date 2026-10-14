"""Integration tests for the Data API lockdown migration (2026_09_23_ciaran_lock_down_data_api).

Row-level security and grants only exist in Postgres, so these live in tests/integration.
The test database is built with create_all() and has none of Supabase's roles or default
grants, so the `supabase_defaults` fixture recreates them first: the anon and
authenticated roles, full grants on every public table, and the default privileges that
open each new table to both. The migration's own UPGRADE_STATEMENTS then run against
that, so the SQL under test is exactly the SQL that ships. Everything happens inside the
test's rolled-back transaction; CREATE ROLE and ALTER DEFAULT PRIVILEGES roll back too.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_09_23_ciaran_lock_down_data_api.py"
)
_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")
# A table created after the migration, to prove new tables now start closed.
_PROBE_TABLE = "lockdown_probe"


def _load_migration(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load migration at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MIGRATION = _load_migration(_MIGRATION_PATH, "ciaran_lock_down_data_api")


async def _run(db: AsyncSession, statements: tuple[str, ...]) -> None:
    for statement in statements:
        await db.execute(text(statement))


async def _rls_enabled(db: AsyncSession, table: str) -> bool:
    result = await db.execute(
        text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(:name)"),
        {"name": f"public.{table}"},
    )
    return bool(result.scalar_one())


async def _api_privileges(db: AsyncSession, table: str) -> set[tuple[str, str]]:
    """Every (role, privilege) an API role holds on the table."""
    held: set[tuple[str, str]] = set()
    for role in _MIGRATION.API_ROLES:
        for privilege in _PRIVILEGES:
            result = await db.execute(
                text("SELECT has_table_privilege(:role, to_regclass(:name), :privilege)"),
                {"role": role, "name": f"public.{table}", "privilege": privilege},
            )
            if result.scalar_one():
                held.add((role, privilege))
    return held


@pytest_asyncio.fixture
async def supabase_defaults(db_session: AsyncSession) -> AsyncSession:
    for role in _MIGRATION.API_ROLES:
        await db_session.execute(text(
            f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
            f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$"
        ))
    # create_all() never makes alembic_version; a real migrated database always has it.
    await db_session.execute(text(
        "CREATE TABLE IF NOT EXISTS public.alembic_version (version_num varchar(32) PRIMARY KEY)"
    ))
    roles = ", ".join(_MIGRATION.API_ROLES)
    await db_session.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {roles}"))
    await db_session.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {roles}"))
    return db_session


@pytest.mark.parametrize("table", _MIGRATION.LOCKED_DOWN_TABLES)
async def test_upgrade_enables_rls_and_revokes_api_roles(supabase_defaults: AsyncSession, table: str) -> None:
    db = supabase_defaults
    assert await _api_privileges(db, table), "fixture should reproduce Supabase's open default"

    await _run(db, _MIGRATION.UPGRADE_STATEMENTS)

    assert await _rls_enabled(db, table)
    assert await _api_privileges(db, table) == set()


async def test_upgrade_closes_tables_created_afterwards(supabase_defaults: AsyncSession) -> None:
    db = supabase_defaults

    await _run(db, _MIGRATION.UPGRADE_STATEMENTS)
    await db.execute(text(f"CREATE TABLE public.{_PROBE_TABLE} (id int PRIMARY KEY)"))

    assert await _api_privileges(db, _PROBE_TABLE) == set()


async def test_upgrade_leaves_the_owner_able_to_read_and_write(supabase_defaults: AsyncSession) -> None:
    db = supabase_defaults
    await _run(db, _MIGRATION.UPGRADE_STATEMENTS)

    await db.execute(text("INSERT INTO public.alembic_version (version_num) VALUES ('probe')"))
    result = await db.execute(text("SELECT count(*) FROM public.alembic_version WHERE version_num = 'probe'"))

    assert result.scalar_one() == 1


async def test_downgrade_restores_the_previous_state(supabase_defaults: AsyncSession) -> None:
    db = supabase_defaults
    table = "trip_location_pings"
    await _run(db, _MIGRATION.UPGRADE_STATEMENTS)

    await _run(db, _MIGRATION.DOWNGRADE_STATEMENTS)
    await db.execute(text(f"CREATE TABLE public.{_PROBE_TABLE} (id int PRIMARY KEY)"))

    assert not await _rls_enabled(db, table)
    assert ("anon", "SELECT") in await _api_privileges(db, table)
    assert ("anon", "SELECT") in await _api_privileges(db, _PROBE_TABLE)
