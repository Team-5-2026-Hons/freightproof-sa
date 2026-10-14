"""add blockchain receipt data hash index

Revision ID: chiko_receipt_hash_index
Revises: ciaran_trip_history_page
Create Date: 2026-09-11
"""

from alembic import op

revision = "chiko_receipt_hash_index"
down_revision = "ciaran_trip_history_page"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_blockchain_receipts_data_hash",
        "blockchain_receipts",
        ["data_hash"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_blockchain_receipts_data_hash",
        table_name="blockchain_receipts",
    )
