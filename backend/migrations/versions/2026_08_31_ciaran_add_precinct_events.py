"""add precinct_events table

Revision ID: ciaran_precinct_events
Revises: ciaran_uniq_fleet_ids
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "ciaran_precinct_events"
down_revision = "ciaran_uniq_fleet_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "precinct_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("precinct_id", UUID(as_uuid=True), sa.ForeignKey("precincts.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("blockchain_receipt_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_precinct_events_precinct_id", "precinct_events", ["precinct_id"])
    op.create_foreign_key(
        "fk_precinct_events_blockchain_receipt",
        "precinct_events",
        "blockchain_receipts",
        ["blockchain_receipt_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_index("ix_precinct_events_precinct_id", table_name="precinct_events")
    op.drop_table("precinct_events")
