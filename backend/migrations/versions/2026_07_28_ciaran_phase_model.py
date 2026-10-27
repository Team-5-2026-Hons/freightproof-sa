"""Phase model: handshake_events -> phase_events, per-stop ledger, anchor state.

Renames rather than rebuilds: the rename carries the three RLS
policies, the indexes and the five inbound FKs across automatically, and preserves
the evidence_artifacts circular-FK use_alter arrangement that 0001 works hard to
get right. What a rename does NOT carry is policy and constraint NAMES — they stay
spelled "handshake_events" on a phase_events table — so this migration renames them
explicitly. FastAPI connects as service_role and bypasses RLS, so an RLS mistake
here produces no error anywhere: it produces a phase ledger carrying driver GPS and
seal data readable outside the POPIA posture via PostgREST. Treat the RLS rename
as a security control, not housekeeping.

Revision ID: 2026_07_28_ciaran_phase
Revises: tim_add_exception_gps
Create Date: 2026-07-28
Author: ciaran
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_28_ciaran_phase"
down_revision = "tim_add_exception_gps"
branch_labels = None
depends_on = None


_CONSTRAINT_RENAMES = [
    ("phase_events", "handshake_events_pkey", "phase_events_pkey"),
    ("phase_events", "handshake_events_trip_id_fkey", "phase_events_trip_id_fkey"),
    ("phase_events",
     "handshake_events_dispatcher_override_user_id_fkey",
     "phase_events_dispatcher_override_user_id_fkey"),
    ("phase_events", "fk_handshake_seal_photo", "fk_phase_seal_photo"),
    ("phase_events", "fk_handshake_waybill_photo", "fk_phase_waybill_photo"),
    ("phase_events", "fk_handshake_gate_photo", "fk_phase_gate_photo"),
    ("phase_events", "fk_handshake_pod_photo", "fk_phase_pod_photo"),
    ("phase_events", "fk_handshake_pod_signature", "fk_phase_pod_signature"),
    ("phase_events", "fk_handshake_blockchain_receipt", "fk_phase_blockchain_receipt"),
    ("trailer_gps_snapshots",
     "trailer_gps_snapshots_handshake_event_id_fkey",
     "trailer_gps_snapshots_phase_event_id_fkey"),
    ("exceptions", "exceptions_handshake_event_id_fkey", "exceptions_phase_event_id_fkey"),
]

_POLICY_RENAMES = [
    ("phase_events", "handshake_events_dispatcher_select", "phase_events_dispatcher_select"),
    ("phase_events", "handshake_events_driver_select", "phase_events_driver_select"),
    ("phase_events", "handshake_events_client_viewer_select", "phase_events_client_viewer_select"),
]


def _rename_constraints(pairs) -> None:
    for table, old, new in pairs:
        op.execute(f"""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{old}') THEN
                    ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
                END IF;
            END $$;
        """)


def _rename_policies(triples) -> None:
    for table, old, new in triples:
        op.execute(f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = '{table}' AND policyname = '{old}'
                ) THEN
                    ALTER POLICY {old} ON {table} RENAME TO {new};
                END IF;
            END $$;
        """)


def upgrade() -> None:
    op.rename_table("handshake_events", "phase_events")
    op.alter_column("phase_events", "handshake_type", new_column_name="phase_type")
    op.execute("ALTER INDEX IF EXISTS ix_handshake_events_trip_sequence "
               "RENAME TO ix_phase_events_trip_sequence")
    _rename_constraints(_CONSTRAINT_RENAMES)

    op.add_column(
        "phase_events",
        sa.Column("trip_stop_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_phase_events_trip_stop", "phase_events", "trip_stops", ["trip_stop_id"], ["id"],
    )
    op.add_column(
        "phase_events",
        sa.Column("anchor_status", sa.String(length=20),
                  nullable=False, server_default="not_required"),
    )
    op.add_column(
        "phase_events",
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
    )

    op.drop_constraint("uq_handshake_events_trip_type", "phase_events", type_="unique")
    op.create_unique_constraint(
        "uq_phase_events_trip_stop_type", "phase_events",
        ["trip_id", "trip_stop_id", "phase_type"],
    )
    op.execute("""
        CREATE UNIQUE INDEX uq_phase_events_trip_creation
        ON phase_events (trip_id) WHERE phase_type = 'trip_creation';
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_phase_events_idempotency_key
        ON phase_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
    """)

    op.alter_column("trailer_gps_snapshots", "handshake_event_id",
                    new_column_name="phase_event_id")
    op.alter_column("exceptions", "handshake_event_id", new_column_name="phase_event_id")

    op.add_column("trips", sa.Column("current_phase", sa.String(length=30), nullable=True))
    op.add_column("trips", sa.Column("current_stop", sa.Integer(), nullable=True))

    op.execute("UPDATE blockchain_receipts SET subject_type = 'phase_event' "
               "WHERE subject_type = 'handshake_event';")

    _rename_policies(_POLICY_RENAMES)

    op.execute("DROP POLICY IF EXISTS trailer_gps_snapshots_dispatcher_select "
               "ON trailer_gps_snapshots;")
    op.execute("""
        CREATE POLICY trailer_gps_snapshots_dispatcher_select ON trailer_gps_snapshots
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM phase_events pe
                JOIN trips t ON t.id = pe.trip_id
                WHERE pe.id = phase_event_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS trailer_gps_snapshots_dispatcher_select "
               "ON trailer_gps_snapshots;")
    _rename_policies([(t, new, old) for t, old, new in _POLICY_RENAMES])

    op.execute("UPDATE blockchain_receipts SET subject_type = 'handshake_event' "
               "WHERE subject_type = 'phase_event';")

    op.drop_column("trips", "current_stop")
    op.drop_column("trips", "current_phase")

    op.alter_column("exceptions", "phase_event_id", new_column_name="handshake_event_id")
    op.alter_column("trailer_gps_snapshots", "phase_event_id",
                    new_column_name="handshake_event_id")

    op.execute("DROP INDEX IF EXISTS uq_phase_events_idempotency_key;")
    op.execute("DROP INDEX IF EXISTS uq_phase_events_trip_creation;")
    op.drop_constraint("uq_phase_events_trip_stop_type", "phase_events", type_="unique")
    op.create_unique_constraint(
        "uq_handshake_events_trip_type", "phase_events", ["trip_id", "phase_type"],
    )

    op.drop_column("phase_events", "idempotency_key")
    op.drop_column("phase_events", "anchor_status")
    op.drop_constraint("fk_phase_events_trip_stop", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "trip_stop_id")

    _rename_constraints([(t, new, old) for t, old, new in _CONSTRAINT_RENAMES])
    op.execute("ALTER INDEX IF EXISTS ix_phase_events_trip_sequence "
               "RENAME TO ix_handshake_events_trip_sequence")
    op.alter_column("phase_events", "phase_type", new_column_name="handshake_type")
    op.rename_table("phase_events", "handshake_events")

    op.execute("""
        CREATE POLICY trailer_gps_snapshots_dispatcher_select ON trailer_gps_snapshots
        FOR SELECT TO authenticated
        USING (
            private.my_role() = 'dispatcher'
            AND EXISTS (
                SELECT 1 FROM handshake_events he
                JOIN trips t ON t.id = he.trip_id
                WHERE he.id = handshake_event_id
                AND (t.operator_organization_id = private.my_org_id()
                     OR t.client_organization_id = private.my_org_id())
            )
        );
    """)
