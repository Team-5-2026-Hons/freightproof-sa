"""The hand-written tim_add_driver_push_tokens migration, on the disposable TEST database.

Same method as test_driver_substitution_uploads_migration.py: rewind the model-built schema
inside the rolled-back test transaction, replay upgrade and downgrade, compare shapes.
"""

import functools
import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

_PATH = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "2026_10_21_tim_add_driver_push_tokens.py"
_TABLE = "driver_push_tokens"


@functools.cache
def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tim_add_driver_push_tokens_migration", _PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(conn: Connection, step: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(_load(), step)()


def _shape(conn: Connection) -> dict[str, object] | None:
    inspector = inspect(conn)
    if not inspector.has_table(_TABLE):
        return None
    return {
        "columns": sorted((c["name"], str(c["type"]), c["nullable"]) for c in inspector.get_columns(_TABLE)),
        "uniques": sorted(str(u["name"]) for u in inspector.get_unique_constraints(_TABLE)),
        "indexes": sorted(str(i["name"]) for i in inspector.get_indexes(_TABLE)),
        "fks": sorted((str(f["name"]), f["referred_table"]) for f in inspector.get_foreign_keys(_TABLE)),
    }


async def _step(db: AsyncSession, step: str) -> None:
    await (await db.connection()).run_sync(_run, step)


async def test_migration_chain_position() -> None:
    module = _load()

    assert (module.revision, module.down_revision) == ("tim_add_driver_push_tokens", "tim_add_incidents")
    assert len(module.revision) <= 32


async def test_upgrade_matches_the_model_and_a_clean_downgrade_removes_it(db_session: AsyncSession) -> None:
    conn = await db_session.connection()
    model_shape = await conn.run_sync(_shape)
    await db_session.execute(text(f"DROP TABLE public.{_TABLE}"))

    await _step(db_session, "upgrade")
    upgraded = await conn.run_sync(_shape)
    rls = (await db_session.execute(text("SELECT relrowsecurity FROM pg_class WHERE relname = :t"), {"t": _TABLE})).scalar_one()
    await _step(db_session, "downgrade")

    assert upgraded == model_shape and rls is True
    assert await conn.run_sync(_shape) is None
