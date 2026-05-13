"""Add driver_substitutions table.

Records every mid-trip driver change — planned or unplanned.
Planned substitutions are normal trip events. Unplanned ones link to a
TripException row and are anchored to the blockchain separately.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-13
Author: tom
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "driver_substitutions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("trips.id"), nullable=False),
        sa.Column("original_driver_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("substituting_driver_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("exchange_location", sa.String(255), nullable=False),
        sa.Column("approving_dispatcher_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_planned", sa.Boolean(), nullable=False),
        sa.Column("substitution_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exception_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("exceptions.id"), nullable=True),
        sa.Column(
            "blockchain_receipt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("blockchain_receipts.id",
                          use_alter=True,
                          name="fk_driver_sub_blockchain_receipt"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_driver_substitutions_trip_id",
        "driver_substitutions",
        ["trip_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_driver_substitutions_trip_id", table_name="driver_substitutions")
    op.drop_table("driver_substitutions")
