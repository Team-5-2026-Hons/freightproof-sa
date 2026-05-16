"""Add missing updated_at column to remaining tables that were omitted in 0001.

Cross-referencing the ORM models against the initial migration reveals three
tables whose ORM class defines updated_at but the DB column was never created:
organizations, trip_templates, sla_configs.

Other tables flagged as missing (trip_trailers, evidence_artifacts,
merkle_batch_leaves, checkpoints, trailer_gps_snapshots) do NOT define
updated_at in their ORM models, so no column is needed there.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

# Only tables where the ORM Mapped class defines updated_at.
_TABLES = [
    "organizations",
    "trip_templates",
    "sla_configs",
]


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("NOW()"),
                nullable=False,
            ),
        )
        # Backfill existing rows; use created_at where it exists.
        op.execute(f"UPDATE {table} SET updated_at = created_at")
        op.execute(
            f"""
            CREATE TRIGGER set_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
            """
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.execute(f"DROP TRIGGER IF EXISTS set_updated_at ON {table}")
        op.drop_column(table, "updated_at")
