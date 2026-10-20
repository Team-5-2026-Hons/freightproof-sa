"""The hand-written FP-83 C3 CP4 migration (tim_dsub_capture_findings), on the disposable TEST database.

CI never runs Alembic, so this is the only proof its DDL matches the models. Same method as
test_driver_substitution_migration.py: inside the rolled-back test transaction the model-built
schema is rewound to its pre-migration shape, then upgrade and downgrade are replayed.
"""

import functools
import importlib.util
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionConfirmation
from tests.integration._driver_substitution_world import add_pending, build_world

_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_10_19_tim_substitution_capture_findings.py"
)
_COLUMNS = {
    "driver_substitution_confirmations": "action_location_assessment",
    "exceptions": "substitution_confirmation_id",
}


@functools.cache
def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tim_dsub_capture_findings_migration", _PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rewind(conn: Connection) -> None:
    for table, column in _COLUMNS.items():
        conn.execute(text(f"ALTER TABLE public.{table} DROP COLUMN IF EXISTS {column} CASCADE"))


def _run(conn: Connection, step: str) -> None:
    with Operations.context(MigrationContext.configure(conn)):
        getattr(_load(), step)()


def _shape(conn: Connection) -> dict[str, object]:
    inspector = inspect(conn)
    return {
        table: {
            "columns": sorted((c["name"], str(c["type"]), c["nullable"]) for c in inspector.get_columns(table)),
            "indexes": sorted(
                (str(i["name"]), tuple(i["column_names"]), bool(i["unique"]),
                 str((i.get("dialect_options") or {}).get("postgresql_where")))
                for i in inspector.get_indexes(table)
            ),
            "fks": sorted(
                (str(f["name"]), tuple(f["constrained_columns"]), f["referred_table"])
                for f in inspector.get_foreign_keys(table)
            ),
        }
        for table in _COLUMNS
    }


async def _step(db: AsyncSession, step: str) -> None:
    await (await db.connection()).run_sync(_run, step)


async def test_migration_chain_position() -> None:
    module = _load()

    assert module.revision == "tim_dsub_capture_findings"
    assert module.down_revision == "ciaran_checkpoint_actor"
    assert len(module.revision) <= 32


async def test_upgrade_matches_the_models_and_a_clean_downgrade_reverses_it(db_session: AsyncSession) -> None:
    conn = await db_session.connection()
    model_shape = await conn.run_sync(_shape)
    await conn.run_sync(_rewind)
    rewound_shape = await conn.run_sync(_shape)

    await _step(db_session, "upgrade")
    upgraded = await conn.run_sync(_shape)
    await _step(db_session, "downgrade")
    downgraded = await conn.run_sync(_shape)

    assert upgraded == model_shape
    assert downgraded == rewound_shape


async def test_downgrade_refuses_while_a_capture_carries_an_assessment(db_session: AsyncSession) -> None:
    world = await build_world(db_session)
    request = await add_pending(db_session, world, outgoing=world.a, incoming=world.b, expected_at=datetime.now(UTC))
    db_session.add(DriverSubstitutionConfirmation(
        id=uuid.uuid4(), request_id=request.id, role="outgoing", driver_id=world.a,
        captured_at=datetime.now(UTC), received_at=datetime.now(UTC),
        confirmed_vehicle_ids=[str(world.horse_id)], seal_checks=[],
        action_location_assessment={"proximity": "unverified"},
    ))
    await db_session.flush()

    with pytest.raises(RuntimeError, match="Refusing to downgrade"):
        await _step(db_session, "downgrade")
