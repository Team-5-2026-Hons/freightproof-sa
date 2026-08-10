"""add vehicle_events and driver_events tables

Revision ID: ciaran_add_event_tables
Revises: ciaran_driver_license_expiry
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "ciaran_add_event_tables"
down_revision = "ciaran_driver_license_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "blockchain_receipt_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "blockchain_receipts.id",
                use_alter=True,
                name="fk_vehicle_events_blockchain_receipt",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_vehicle_events_vehicle_id", "vehicle_events", ["vehicle_id"])

    op.create_table(
        "driver_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("driver_id", UUID(as_uuid=True), sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("changed_fields", JSONB, nullable=False),
        sa.Column("changed_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "blockchain_receipt_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "blockchain_receipts.id",
                use_alter=True,
                name="fk_driver_events_blockchain_receipt",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_driver_events_driver_id", "driver_events", ["driver_id"])


def downgrade() -> None:
    op.drop_index("ix_driver_events_driver_id", table_name="driver_events")
    op.drop_table("driver_events")
    op.drop_index("ix_vehicle_events_vehicle_id", table_name="vehicle_events")
    op.drop_table("vehicle_events")
