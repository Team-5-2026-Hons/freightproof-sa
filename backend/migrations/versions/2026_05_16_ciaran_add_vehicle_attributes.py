"""Add make, model, year, vin_number, licence_disc_expiry, gross_vehicle_mass_kg to vehicles.

All columns are nullable so existing rows are unaffected and all current API
calls continue to work unchanged.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vehicles", sa.Column("make", sa.String(100), nullable=True))
    op.add_column("vehicles", sa.Column("model", sa.String(100), nullable=True))
    op.add_column("vehicles", sa.Column("year", sa.Integer(), nullable=True))
    op.add_column("vehicles", sa.Column("vin_number", sa.String(17), nullable=True))
    op.add_column("vehicles", sa.Column("licence_disc_expiry", sa.Date(), nullable=True))
    op.add_column("vehicles", sa.Column("gross_vehicle_mass_kg", sa.Integer(), nullable=True))

    op.create_index("ix_vehicles_vin_number", "vehicles", ["vin_number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_vehicles_vin_number", table_name="vehicles")
    op.drop_column("vehicles", "gross_vehicle_mass_kg")
    op.drop_column("vehicles", "licence_disc_expiry")
    op.drop_column("vehicles", "vin_number")
    op.drop_column("vehicles", "year")
    op.drop_column("vehicles", "model")
    op.drop_column("vehicles", "make")
