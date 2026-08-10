"""add length_m to vehicles for trailer combination validation

Revision ID: ciaran_add_vehicle_length_m
Revises: ciaran_add_event_tables
Create Date: 2026-05-17

length_m stores the trailer deck length in whole metres (6, 12, or 18).
Null is valid for horses, which have no relevant deck length.
Combination rules enforced in the dispatcher frontend:
  - 0 trailers  → valid (single unit)
  - 1 trailer   → valid (any length)
  - 2 trailers  → valid only when lengths sum to 18 m (6 + 12)
  - 3+ trailers → blocked
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_add_vehicle_length_m"
down_revision = "ciaran_add_event_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column("length_m", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vehicles", "length_m")
