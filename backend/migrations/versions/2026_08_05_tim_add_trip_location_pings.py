"""add trip_location_pings — the driver's per-trip location trail

Every GPS column that existed before this migration is pinned to one piece of
evidence (a checkpoint, a phase event, an exception). This table holds the trail
between them: one row per driver interaction with the PWA while a trip is open,
which is what replaced the three manual "Capture GPS Location" steps the driver
used to tap through.

POPIA: personal location data, Postgres only, never anchored to Hedera. See the
module docstring on app/db/models/locations.py for the full constraint set.

Revision ID: tim_trip_location_pings
Revises: 2026_07_28_ciaran_phase
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_trip_location_pings"
down_revision = "2026_07_28_ciaran_phase"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trip_location_pings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("trip_id", UUID(as_uuid=True), sa.ForeignKey("trips.id"), nullable=False),
        sa.Column("driver_id", UUID(as_uuid=True), sa.ForeignKey("drivers.id"), nullable=False),
        # Numeric(10, 7) matches every other coordinate column in the schema.
        sa.Column("lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("lng", sa.Numeric(10, 7), nullable=False),
        sa.Column("accuracy_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("context", sa.String(80), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Serves the only read this table has: one trip's trail, in the order it was walked.
    op.create_index(
        "ix_trip_location_pings_trip_recorded",
        "trip_location_pings",
        ["trip_id", "recorded_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_trip_location_pings_trip_recorded", table_name="trip_location_pings")
    op.drop_table("trip_location_pings")
