"""extend blockchain_receipts for arbitrary subjects

Revision ID: ciaran_extend_blockchain_receipts
Revises: 0008
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "ciaran_bc_receipts_ext"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add columns nullable first, backfill, then enforce NOT NULL on subject_id.
    op.add_column(
        "blockchain_receipts",
        sa.Column("subject_type", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "blockchain_receipts",
        sa.Column("subject_id", UUID(as_uuid=True), nullable=True),
    )

    # Backfill: all existing receipts are trip-scoped.
    op.execute("""
        UPDATE blockchain_receipts
        SET subject_type = 'trip', subject_id = trip_id
        WHERE subject_type IS NULL
    """)

    # Now make NOT NULL.
    op.alter_column("blockchain_receipts", "subject_type", nullable=False)
    op.alter_column("blockchain_receipts", "subject_id", nullable=False)

    # trip_id becomes nullable so non-trip receipts can omit it.
    op.alter_column("blockchain_receipts", "trip_id", nullable=True)

    # Composite index for the common query "all receipts for entity X".
    op.create_index(
        "ix_blockchain_receipts_subject",
        "blockchain_receipts",
        ["subject_type", "subject_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_blockchain_receipts_subject", table_name="blockchain_receipts")
    op.alter_column("blockchain_receipts", "trip_id", nullable=False)
    op.drop_column("blockchain_receipts", "subject_id")
    op.drop_column("blockchain_receipts", "subject_type")
