"""Add TripStop model for multi-stop/multi-client trips (FP-112).

Adds trip_stops (sequenced route waypoints, no origin/destination type — role
is derived from which consignments link to a stop). Adds nullable
pickup_stop_id/delivery_stop_id/load_priority/unit_count_expected/
pp_manifest_number to consignments. Relaxes trips.client_organization_id,
trips.origin_precinct_id, trips.destination_precinct_id to nullable (client
now lives per-consignment; origin/destination become a derived convenience
for multi-stop trips). Backfills two TripStop rows (seq 0 = origin, seq 1 =
destination) for every existing trip so single-leg trips keep working
unchanged.

Design: docs/superpowers/plans/2026-06-24-fp112-tripstop.md

Revision ID: ciaran_add_tripstop
Revises: tim_add_precinct_is_shared
Create Date: 2026-07-02
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_add_tripstop"
down_revision = "tim_add_precinct_is_shared"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trip_stops",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("trip_id", sa.UUID(), nullable=False),
        sa.Column("precinct_id", sa.UUID(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("slot_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["precinct_id"], ["precincts.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_id", "sequence", name="uq_trip_stops_trip_id_sequence"),
    )

    # Backfill: every existing trip becomes a 2-stop route (seq 0 = its current
    # origin, seq 1 = its current destination) so single-leg trips are unaffected.
    op.execute(
        """
        INSERT INTO trip_stops (id, trip_id, precinct_id, sequence, created_at, updated_at)
        SELECT gen_random_uuid(), id, origin_precinct_id, 0, created_at, updated_at
        FROM trips
        WHERE origin_precinct_id IS NOT NULL
        """
    )
    op.execute(
        """
        INSERT INTO trip_stops (id, trip_id, precinct_id, sequence, created_at, updated_at)
        SELECT gen_random_uuid(), id, destination_precinct_id, 1, created_at, updated_at
        FROM trips
        WHERE destination_precinct_id IS NOT NULL
        """
    )

    op.add_column("consignments", sa.Column("pickup_stop_id", sa.UUID(), nullable=True))
    op.add_column("consignments", sa.Column("delivery_stop_id", sa.UUID(), nullable=True))
    op.add_column("consignments", sa.Column("load_priority", sa.Integer(), nullable=True))
    op.add_column("consignments", sa.Column("unit_count_expected", sa.Integer(), nullable=True))
    op.add_column("consignments", sa.Column("pp_manifest_number", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_consignments_pickup_stop", "consignments", "trip_stops", ["pickup_stop_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_consignments_delivery_stop", "consignments", "trip_stops", ["delivery_stop_id"], ["id"]
    )

    op.alter_column("trips", "client_organization_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("trips", "origin_precinct_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("trips", "destination_precinct_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column("trips", "destination_precinct_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("trips", "origin_precinct_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("trips", "client_organization_id", existing_type=sa.UUID(), nullable=False)

    op.drop_constraint("fk_consignments_delivery_stop", "consignments", type_="foreignkey")
    op.drop_constraint("fk_consignments_pickup_stop", "consignments", type_="foreignkey")
    op.drop_column("consignments", "pp_manifest_number")
    op.drop_column("consignments", "unit_count_expected")
    op.drop_column("consignments", "load_priority")
    op.drop_column("consignments", "delivery_stop_id")
    op.drop_column("consignments", "pickup_stop_id")

    op.drop_table("trip_stops")
