"""The hand-written FP-83 C4 migration (tim_dsub_uploads), on the disposable TEST database.

Same method as test_driver_substitution_capture_findings_migration.py: rewind the model-built
schema inside the rolled-back test transaction, replay upgrade and downgrade, compare shapes.
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

from app.db.models.driver_substitutions import DriverSubstitutionUpload
from app.db.models.enums import ArtifactType
from app.db.models.evidence import EvidenceArtifact
from tests.integration._driver_substitution_world import build_world

_PATH = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "2026_10_19_tim_substitution_uploads.py"
_TABLE = "driver_substitution_uploads"


@functools.cache
def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tim_dsub_uploads_migration", _PATH)
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
        "checks": sorted(
            (str(c["name"]), " ".join(str(c["sqltext"]).split())) for c in inspector.get_check_constraints(_TABLE)
        ),
    }


async def _step(db: AsyncSession, step: str) -> None:
    await (await db.connection()).run_sync(_run, step)


async def test_migration_chain_position() -> None:
    module = _load()

    assert (module.revision, module.down_revision) == ("tim_dsub_uploads", "tim_dsub_capture_findings")
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


async def test_downgrade_refuses_while_an_upload_is_recorded(db_session: AsyncSession) -> None:
    world = await build_world(db_session)
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=world.trip_id, artifact_type=ArtifactType.PHOTO.value, s3_key="k", s3_bucket="b",
        file_hash="0" * 64, mime_type="image/jpeg", captured_by_driver_id=world.a, captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    db_session.add(DriverSubstitutionUpload(
        artifact_id=artifact.id, trip_id=world.trip_id, driver_id=world.a, purpose="late_evidence", custody_sequence=0,
    ))
    await db_session.flush()

    with pytest.raises(RuntimeError, match="Refusing to downgrade"):
        await _step(db_session, "downgrade")
