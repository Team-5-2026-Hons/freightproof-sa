"""add license_expiry to drivers

Revision ID: ciaran_driver_license_expiry
Revises: ciaran_extend_blockchain_receipts
Create Date: 2026-05-17
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_driver_license_expiry"
down_revision = "ciaran_bc_receipts_ext"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("license_expiry", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("drivers", "license_expiry")
