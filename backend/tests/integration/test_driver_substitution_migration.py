"""The hand-written FP-83 C1 migration, run against the disposable TEST database.

CI never runs Alembic and autogenerate is unusable on this repo (CLAUDE.md), so this is the
only proof the DDL and the legacy-data preflight work. Every step runs inside the test's
rolled-back transaction (never DATABASE_URL): the model-built schema is rewound to its
pre-migration shape, legacy rows are seeded with raw SQL, then the migration's upgrade and
downgrade are replayed.
"""

import functools
import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution
from app.orchestration.substitutions.access import get_current_custody
from tests.integration._evidence_anchor_world import World, seed_world

_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations" / "versions" / "2026_10_19_ciaran_driver_substitutions.py"
)
_NEW_TABLES = (
    "driver_substitution_requests", "driver_substitution_confirmations",
    "driver_substitution_confirmation_artifacts", "driver_substitution_notices",
    "late_driver_evidence", "late_driver_evidence_artifacts",
    "driver_substitution_corrections", "driver_substitution_operations",
)
# Columns the migration adds to tables that already exist; dropped to rewind to legacy.
_ADDED_COLUMNS: dict[str, tuple[str, ...]] = {
    "driver_substitutions": (
        "updated_at", "request_id", "sequence_number", "previous_substitution_id",
        "completed_by_driver_id", "completed_by_user_id", "completion_mode", "declared_exchange_at",
        "missing_confirmation_reason", "incoming_identity_status", "incoming_identity_last_verified_at",
        "incoming_identity_observed_at", "identity_attested_by_user_id", "identity_attestation_reason",
        "identity_attested_at", "incoming_licence_expiry", "eligibility_observed_at",
        "payload_version", "payload_json", "event_hash", "anchor_status",
    ),
    "phase_events": ("performed_by_driver_id", "custody_sequence"),
    "exceptions": ("performed_by_driver_id", "custody_sequence"),
}
_SHAPE_TABLES = (*_NEW_TABLES, *_ADDED_COLUMNS)
_T0 = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)


@functools.cache
def _load() -> ModuleType:
    # Cached so the exception class the migration raises is the one tests catch.
    spec = importlib.util.spec_from_file_location("ciaran_driver_substitutions_migration", _PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rewind_to_legacy(conn: Connection) -> None:
    """Put the model-built schema back to what the deployed database looks like pre-migration."""
    for table in _NEW_TABLES:
        conn.execute(text(f"DROP TABLE IF EXISTS public.{table} CASCADE"))
    for table, columns in _ADDED_COLUMNS.items():
        for column in columns:
            conn.execute(text(f"ALTER TABLE public.{table} DROP COLUMN IF EXISTS {column} CASCADE"))


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
        for table in _SHAPE_TABLES
    }


def _has_new_schema(conn: Connection) -> bool:
    inspector = inspect(conn)
    columns = {c["name"] for c in inspector.get_columns("driver_substitutions")}
    return inspector.has_table("driver_substitution_requests") or "sequence_number" in columns


async def _driver(db: AsyncSession, world: World) -> Driver:
    driver = Driver(
        id=uuid.uuid4(), organization_id=world.org.id, full_name="Cover Driver",
        id_number=str(uuid.uuid4().int)[:13], phone_number="+27821234568",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    db.add(driver)
    await db.flush()
    return driver


async def _legacy_row(
    db: AsyncSession, world: World, *, outgoing: uuid.UUID, incoming: uuid.UUID, at: datetime,
    receipt_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """A pre-migration completed substitution, written with only the original columns."""
    row_id = uuid.uuid4()
    await db.execute(text(
        "INSERT INTO driver_substitutions (id, trip_id, original_driver_id, substituting_driver_id, "
        "exchange_location, approving_dispatcher_user_id, is_planned, substitution_at, "
        "blockchain_receipt_id) VALUES (:i, :t, :o, :s, 'Old depot', :u, true, :at, :r)"),
        {"i": row_id, "t": world.trip_id, "o": outgoing, "s": incoming, "u": world.user.id,
         "at": at, "r": receipt_id})
    return row_id


async def _legacy_world(db: AsyncSession) -> tuple[World, Driver, Driver]:
    world = await seed_world(db)
    b, c = await _driver(db, world), await _driver(db, world)
    conn = await db.connection()
    await conn.run_sync(_rewind_to_legacy)
    return world, b, c


async def _legacy_snapshot(db: AsyncSession) -> list[tuple[object, ...]]:
    rows = await db.execute(text(
        "SELECT id, trip_id, original_driver_id, substituting_driver_id, exchange_location, "
        "approving_dispatcher_user_id, is_planned, substitution_at, exception_id, "
        "blockchain_receipt_id, created_at FROM driver_substitutions ORDER BY id"))
    return [tuple(row) for row in rows]


async def _upgrade(db: AsyncSession) -> None:
    await (await db.connection()).run_sync(_run, "upgrade")


async def _downgrade(db: AsyncSession) -> None:
    await (await db.connection()).run_sync(_run, "downgrade")


# ── chain position and DDL ───────────────────────────────────────────────────


async def test_migration_chain_position() -> None:
    module = _load()

    assert module.revision == "ciaran_driver_substitutions"
    assert module.down_revision == "tim_add_audit_pack_email_codes"
    assert len(module.revision) <= 32


async def test_upgrade_matches_the_models_and_a_clean_downgrade_reverses_it(db_session: AsyncSession) -> None:
    conn = await db_session.connection()
    model_shape = await conn.run_sync(_shape)
    await conn.run_sync(_rewind_to_legacy)

    await _upgrade(db_session)
    migrated_shape = await conn.run_sync(_shape)
    rls = (await db_session.execute(text(
        "SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(:t)"), {"t": list(_NEW_TABLES)},
    )).all()

    assert migrated_shape == model_shape
    assert len(rls) == len(_NEW_TABLES) and all(enabled for _, enabled in rls)

    await _downgrade(db_session)
    assert not await conn.run_sync(_has_new_schema)

    await _upgrade(db_session)
    assert await conn.run_sync(_shape) == model_shape


# ── the pure legacy-chain ordering ───────────────────────────────────────────


def _link(module: ModuleType, outgoing: uuid.UUID, incoming: uuid.UUID, at: datetime) -> object:
    return module.LegacyLink(id=uuid.uuid4(), outgoing_driver_id=outgoing, incoming_driver_id=incoming, at=at)


def test_order_legacy_chain_follows_continuity_and_time() -> None:
    module = _load()
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first, second = _link(module, a, b, _T0), _link(module, b, c, _T0 + timedelta(hours=1))

    ordered = module.order_legacy_chain(trip_id=uuid.uuid4(), original_driver_id=a, links=[second, first])

    assert [link.id for link in ordered] == [first.id, second.id]


def test_a_timestamp_tie_with_only_one_possible_chain_is_not_ambiguous() -> None:
    module = _load()
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first, second = _link(module, a, b, _T0), _link(module, b, c, _T0)

    ordered = module.order_legacy_chain(trip_id=uuid.uuid4(), original_driver_id=a, links=[second, first])

    assert [link.id for link in ordered] == [first.id, second.id]


def test_a_timestamp_tie_with_two_possible_chains_is_ambiguous_whatever_the_uuid_order() -> None:
    module = _load()
    a, b = uuid.uuid4(), uuid.uuid4()
    links = [_link(module, a, b, _T0), _link(module, b, a, _T0), _link(module, a, b, _T0)]

    with pytest.raises(module.LegacyChainError, match="ambiguous"):
        module.order_legacy_chain(trip_id=uuid.uuid4(), original_driver_id=a, links=links)


@pytest.mark.parametrize("case", ["wrong_start", "gap", "time_contradicts_continuity", "self_handover"])
def test_a_legacy_chain_that_does_not_continue_is_refused(case: str) -> None:
    module = _load()
    a, b, c, d = (uuid.uuid4() for _ in range(4))
    links = {
        "wrong_start": [_link(module, b, c, _T0)],
        "gap": [_link(module, a, b, _T0), _link(module, c, d, _T0 + timedelta(hours=1))],
        "time_contradicts_continuity": [_link(module, a, b, _T0 + timedelta(hours=2)), _link(module, b, c, _T0)],
        "self_handover": [_link(module, a, a, _T0)],
    }[case]

    with pytest.raises(module.LegacyChainError, match="does not continue|chronology|itself"):
        module.order_legacy_chain(trip_id=uuid.uuid4(), original_driver_id=a, links=links)


# ── legacy rows through the real upgrade ─────────────────────────────────────


async def test_a_valid_legacy_chain_migrates_with_deterministic_sequences_and_no_invented_facts(
    db_session: AsyncSession,
) -> None:
    world, b, c = await _legacy_world(db_session)
    first = await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    second = await _legacy_row(db_session, world, outgoing=b.id, incoming=c.id, at=_T0 + timedelta(hours=1))
    third = await _legacy_row(db_session, world, outgoing=c.id, incoming=world.driver_id, at=_T0 + timedelta(hours=2))
    before = await _legacy_snapshot(db_session)

    await _upgrade(db_session)

    rows = {row.id: row for row in (await db_session.execute(select(DriverSubstitution))).scalars()}
    assert [(rows[i].sequence_number, rows[i].previous_substitution_id) for i in (first, second, third)] == [
        (1, None), (2, first), (3, second),
    ]
    for row in rows.values():
        assert row.request_id is None
        assert row.completed_by_driver_id is None and row.completed_by_user_id is None
        assert row.payload_version is None and row.payload_json is None and row.event_hash is None
        assert row.completion_mode is None and row.incoming_identity_status is None
        assert row.updated_at == row.created_at
    requests = await db_session.execute(select(func.count()).select_from(DriverSubstitutionRequest))
    assert requests.scalar_one() == 0  # no request was fabricated for a legacy row
    custody = await get_current_custody(db_session, trip=world.trip)
    assert (custody.driver_id, custody.sequence, custody.substitution_id) == (world.driver_id, 3, third)
    after = [r for r in await _legacy_snapshot(db_session)]
    assert after == before  # every original column, FK and timestamp is untouched


async def test_a_legacy_receipt_link_survives_the_migration(db_session: AsyncSession) -> None:
    world, b, _ = await _legacy_world(db_session)
    receipt_id = uuid.uuid4()
    await db_session.execute(text(
        "INSERT INTO blockchain_receipts (id, subject_type, subject_id, receipt_type, data_hash, payload_json) "
        "VALUES (:i, 'trip', :s, 'trip_lock', :h, '{}')"),
        {"i": receipt_id, "s": world.trip_id, "h": "c" * 64})
    row_id = await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0, receipt_id=receipt_id)

    await _upgrade(db_session)

    migrated = (await db_session.execute(select(DriverSubstitution).where(DriverSubstitution.id == row_id))).scalar_one()
    assert migrated.blockchain_receipt_id == receipt_id
    assert migrated.anchor_status is None  # unknown, not guessed from the receipt link


async def test_legacy_tie_with_one_possible_chain_migrates(db_session: AsyncSession) -> None:
    world, b, c = await _legacy_world(db_session)
    second = await _legacy_row(db_session, world, outgoing=b.id, incoming=c.id, at=_T0)
    first = await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)

    await _upgrade(db_session)

    sequences = dict((await db_session.execute(select(DriverSubstitution.id, DriverSubstitution.sequence_number))).all())
    assert (sequences[first], sequences[second]) == (1, 2)


async def test_ambiguous_legacy_chain_blocks_migration(db_session: AsyncSession) -> None:
    world, b, _ = await _legacy_world(db_session)
    await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    await _legacy_row(db_session, world, outgoing=b.id, incoming=world.driver_id, at=_T0)
    await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    conn = await db_session.connection()
    before = await _legacy_snapshot(db_session)
    fks_before = await conn.run_sync(lambda c: sorted(str(f["name"]) for f in inspect(c).get_foreign_keys("driver_substitutions")))

    with pytest.raises(_load().LegacyChainError, match="ambiguous"):
        await _upgrade(db_session)

    assert not await conn.run_sync(_has_new_schema)  # preflight ran before any DDL
    assert await _legacy_snapshot(db_session) == before
    assert await conn.run_sync(lambda c: sorted(str(f["name"]) for f in inspect(c).get_foreign_keys("driver_substitutions"))) == fks_before


async def test_legacy_chain_whose_outgoing_driver_does_not_continue_blocks_migration(db_session: AsyncSession) -> None:
    world, b, c = await _legacy_world(db_session)
    await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    await _legacy_row(db_session, world, outgoing=c.id, incoming=world.driver_id, at=_T0 + timedelta(hours=1))
    conn = await db_session.connection()

    with pytest.raises(_load().LegacyChainError, match="does not continue"):
        await _upgrade(db_session)

    assert not await conn.run_sync(_has_new_schema)


async def test_one_bad_trip_blocks_the_whole_migration_not_just_itself(db_session: AsyncSession) -> None:
    good, b, _ = await _legacy_world(db_session)
    bad = await seed_world(db_session, tag="B")
    stranger = await _driver(db_session, bad)
    await _legacy_row(db_session, good, outgoing=good.driver_id, incoming=b.id, at=_T0)
    await _legacy_row(db_session, bad, outgoing=stranger.id, incoming=bad.driver_id, at=_T0)
    conn = await db_session.connection()

    with pytest.raises(_load().LegacyChainError):
        await _upgrade(db_session)

    assert not await conn.run_sync(_has_new_schema)


async def test_a_new_amendment_follows_a_migrated_legacy_link(db_session: AsyncSession) -> None:
    world, b, c = await _legacy_world(db_session)
    first = await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    second = await _legacy_row(db_session, world, outgoing=b.id, incoming=c.id, at=_T0 + timedelta(hours=1))
    await _upgrade(db_session)
    request = DriverSubstitutionRequest(
        id=uuid.uuid4(), trip_id=world.trip_id, outgoing_driver_id=c.id, incoming_driver_id=world.driver_id,
        exchange_label="Depot", exchange_latitude=-33.0, exchange_longitude=18.0, exchange_instructions="",
        expected_at=_T0, reason="Rest break", is_planned=True, arranged_by_user_id=world.user.id,
        version=1, state="completed",
    )
    db_session.add(request)
    await db_session.flush()
    amendment = DriverSubstitution(
        id=uuid.uuid4(), trip_id=world.trip_id, original_driver_id=c.id, substituting_driver_id=world.driver_id,
        exchange_location="Depot", approving_dispatcher_user_id=world.user.id, is_planned=True,
        substitution_at=_T0 + timedelta(hours=3), sequence_number=3, previous_substitution_id=second,
        request_id=request.id, completed_by_user_id=world.user.id,
    )
    db_session.add(amendment)
    await db_session.flush()

    custody = await get_current_custody(db_session, trip=world.trip)

    assert (custody.driver_id, custody.sequence, custody.substitution_id) == (world.driver_id, 3, amendment.id)
    legacy = (await db_session.execute(select(DriverSubstitution).where(DriverSubstitution.id == first))).scalar_one()
    assert legacy.request_id is None and legacy.event_hash is None  # no prior hash invented for the chain


# ── downgrade never silently destroys recorded custody ───────────────────────


async def test_downgrade_with_only_legacy_rows_restores_the_original_shape_and_keeps_every_row(
    db_session: AsyncSession,
) -> None:
    world, b, _ = await _legacy_world(db_session)
    await _legacy_row(db_session, world, outgoing=world.driver_id, incoming=b.id, at=_T0)
    before = await _legacy_snapshot(db_session)
    await _upgrade(db_session)

    await _downgrade(db_session)

    conn = await db_session.connection()
    assert not await conn.run_sync(_has_new_schema)
    assert await _legacy_snapshot(db_session) == before


async def test_downgrade_refuses_while_a_request_exists(db_session: AsyncSession) -> None:
    world, b, _ = await _legacy_world(db_session)
    await _upgrade(db_session)
    db_session.add(DriverSubstitutionRequest(
        id=uuid.uuid4(), trip_id=world.trip_id, outgoing_driver_id=world.driver_id, incoming_driver_id=b.id,
        exchange_label="Depot", exchange_latitude=-33.0, exchange_longitude=18.0, exchange_instructions="",
        expected_at=_T0, reason="r", is_planned=True, arranged_by_user_id=world.user.id, version=1, state="cancelled",
    ))
    await db_session.flush()
    conn = await db_session.connection()

    with pytest.raises(RuntimeError, match="recorded custody"):
        await _downgrade(db_session)

    assert await conn.run_sync(_has_new_schema)  # nothing was dropped


async def test_downgrade_refuses_while_a_new_style_completed_substitution_exists(db_session: AsyncSession) -> None:
    world, b, _ = await _legacy_world(db_session)
    await _upgrade(db_session)
    request_id = uuid.uuid4()
    db_session.add(DriverSubstitutionRequest(
        id=request_id, trip_id=world.trip_id, outgoing_driver_id=world.driver_id, incoming_driver_id=b.id,
        exchange_label="Depot", exchange_latitude=-33.0, exchange_longitude=18.0, exchange_instructions="",
        expected_at=_T0, reason="r", is_planned=True, arranged_by_user_id=world.user.id, version=1, state="completed",
    ))
    await db_session.flush()
    db_session.add(DriverSubstitution(
        id=uuid.uuid4(), trip_id=world.trip_id, original_driver_id=world.driver_id, substituting_driver_id=b.id,
        exchange_location="Depot", approving_dispatcher_user_id=world.user.id, is_planned=True,
        substitution_at=_T0, sequence_number=1, request_id=request_id, completed_by_user_id=world.user.id,
    ))
    await db_session.flush()
    conn = await db_session.connection()

    with pytest.raises(RuntimeError, match="recorded custody"):
        await _downgrade(db_session)

    assert await conn.run_sync(_has_new_schema)


async def test_downgrade_refuses_while_an_action_carries_a_custody_sequence(db_session: AsyncSession) -> None:
    world, _, _ = await _legacy_world(db_session)
    await _upgrade(db_session)
    await db_session.execute(text(
        "INSERT INTO phase_events (id, trip_id, phase_type, sequence_number, custody_sequence) "
        "VALUES (:i, :t, 'trip_creation', 0, 1)"), {"i": uuid.uuid4(), "t": world.trip_id})
    conn = await db_session.connection()

    with pytest.raises(RuntimeError, match="recorded custody"):
        await _downgrade(db_session)

    assert await conn.run_sync(_has_new_schema)
    assert (await db_session.execute(select(PhaseEvent.custody_sequence))).scalar_one() == 1
