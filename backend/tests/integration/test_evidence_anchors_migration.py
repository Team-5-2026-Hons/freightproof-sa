"""The hand-written FP-290 migration builds the schema the models declare, and reverses.

CI never runs Alembic and autogenerate is unusable on this repo, so this is the only thing
that proves the DDL works. It runs inside the test's rolled-back transaction against the
disposable test database (never DATABASE_URL): drop the two model-built tables, replay the
migration's upgrade, compare, downgrade, and replay again.
"""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_10_14_ciaran_evidence_anchors.py"
)
_TABLES = ("evidence_anchor_events", "exception_artifacts")


def _load():
    spec = importlib.util.spec_from_file_location("ciaran_evidence_anchors_migration", _PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop_model_tables(conn: Connection) -> None:
    for table in _TABLES:
        conn.execute(text(f"DROP TABLE IF EXISTS public.{table} CASCADE"))


def _run(conn: Connection, step: str) -> None:
    module = _load()
    with Operations.context(MigrationContext.configure(conn)):
        getattr(module, step)()


def _shape(conn: Connection) -> dict[str, object]:
    inspector = inspect(conn)
    return {
        table: {
            "columns": sorted(
                (c["name"], str(c["type"]), c["nullable"]) for c in inspector.get_columns(table)
            ),
            "uniques": sorted(str(u["name"]) for u in inspector.get_unique_constraints(table)),
            "indexes": sorted(str(i["name"]) for i in inspector.get_indexes(table)),
            "fks": sorted(str(f["name"]) for f in inspector.get_foreign_keys(table)),
            "checks": sorted(str(c["name"]) for c in inspector.get_check_constraints(table)),
        }
        for table in _TABLES
    }


async def test_migration_chain_position() -> None:
    module = _load()

    assert module.revision == "ciaran_evidence_anchors"
    assert module.down_revision == "tim_precinct_geofence_polygon"
    assert len(module.revision) <= 32


async def test_upgrade_matches_the_models_and_downgrade_removes_both_tables(db_session: AsyncSession) -> None:
    conn = await db_session.connection()
    model_shape = await conn.run_sync(_shape)
    await conn.run_sync(_drop_model_tables)

    await conn.run_sync(_run, "upgrade")
    migrated_shape = await conn.run_sync(_shape)
    rls = (await db_session.execute(text(
        "SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(:t)"), {"t": list(_TABLES)},
    )).all()

    assert migrated_shape == model_shape
    assert all(enabled for _, enabled in rls) and len(rls) == 2

    await conn.run_sync(_run, "downgrade")
    remaining = await conn.run_sync(lambda c: [t for t in _TABLES if inspect(c).has_table(t)])
    assert remaining == []

    await conn.run_sync(_run, "upgrade")
    assert await conn.run_sync(_shape) == model_shape


async def test_anchored_status_without_a_receipt_is_rejected(db_session: AsyncSession) -> None:
    """The ck_..._anchored_has_receipt constraint, as migrated."""
    import uuid
    from sqlalchemy.exc import IntegrityError
    from tests.integration._evidence_anchor_world import seed_world
    from app.db.models.transit import TripException
    from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType

    conn = await db_session.connection()
    await conn.run_sync(_drop_model_tables)
    await conn.run_sync(_run, "upgrade")
    world = await seed_world(db_session)
    exc = TripException(
        trip_id=world.trip.id, exception_type=ExceptionType.PANIC_BUTTON, source=ExceptionSource.DRIVER,
        severity=ExceptionSeverity.CRITICAL, description="x",
    )
    db_session.add(exc)
    await db_session.flush()

    try:
        async with db_session.begin_nested():
            await db_session.execute(text(
                "INSERT INTO evidence_anchor_events (id, trip_id, exception_id, receipt_type, occurred_at, "
                "payload_version, payload_json, event_hash, anchor_status) VALUES "
                "(:i, :t, :e, 'exception_raised', now(), 1, '{}', :h, 'anchored')"),
                {"i": uuid.uuid4(), "t": world.trip.id, "e": exc.id, "h": "0" * 64})
    except IntegrityError as error:
        assert "ck_evidence_anchor_events_anchored_has_receipt" in str(error)
    else:
        raise AssertionError("anchored without a receipt was accepted")
