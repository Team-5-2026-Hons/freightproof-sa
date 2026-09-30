"""Every table must be closed to the Supabase Data API, by 0003 or by the lockdown migration.

The gap this guards against went unnoticed for four months: tables added after
0003_tom_rls_policies were created without RLS and were readable and writable with the
publishable key. The lockdown migration also revokes Supabase's default grants, so a new
table is already closed; this test keeps the RLS convention explicit on top of that. When
it fails for a new table, enable RLS in that table's own migration and list it below.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

from app.db.models import Base

_VERSIONS = Path(__file__).resolve().parents[2] / "migrations" / "versions"

# Tables 0003_tom_rls_policies enabled RLS on that still exist (its handshake_events
# is today's phase_events, which kept RLS through the rename).
_RLS_FROM_0003 = frozenset({
    "blockchain_receipts", "checkpoints", "consignments", "driver_substitutions", "drivers",
    "evidence_artifacts", "exceptions", "merkle_batch_leaves", "merkle_batches",
    "organizations", "parcels", "phase_events", "precincts", "sla_configs",
    "trailer_gps_snapshots", "trip_templates", "trip_trailers", "trips", "users", "vehicles",
})
# Alembic's own bookkeeping table: not a model, but just as exposed.
_NON_MODEL_TABLES = frozenset({"alembic_version"})


def _load_migration(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load migration at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_LOCKDOWN = _load_migration(_VERSIONS / "2026_09_23_ciaran_lock_down_data_api.py", "ciaran_lock_down_data_api")


def test_every_model_table_is_closed_to_the_data_api() -> None:
    model_tables = frozenset(Base.metadata.tables)

    uncovered = model_tables - _RLS_FROM_0003 - frozenset(_LOCKDOWN.LOCKED_DOWN_TABLES)

    assert uncovered == frozenset(), f"no RLS on {sorted(uncovered)}: enable it in the table's migration"


def test_lockdown_list_names_only_real_tables() -> None:
    known = frozenset(Base.metadata.tables) | _NON_MODEL_TABLES

    unknown = frozenset(_LOCKDOWN.LOCKED_DOWN_TABLES) - known

    assert unknown == frozenset()


def test_lockdown_does_not_repeat_0003() -> None:
    overlap = _RLS_FROM_0003 & frozenset(_LOCKDOWN.LOCKED_DOWN_TABLES)

    assert overlap == frozenset()
