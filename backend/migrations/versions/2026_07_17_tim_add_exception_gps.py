"""add gps_lat/gps_lng to exceptions

The panic-button flow (and any future driver-raised exception) captures the
driver's phone GPS fix client-side, but the exceptions table had nowhere to
put it — the coordinates were silently discarded before ever reaching the
API. Adds nullable gps_lat/gps_lng columns, matching Checkpoint.driver_phone_lat/
_lng's Numeric(10,7) precision and naming convention (backend/app/db/models/transit.py).

Revision ID: tim_add_exception_gps
Revises: ciaran_add_exception_scoping
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "tim_add_exception_gps"
down_revision = "ciaran_add_exception_scoping"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exceptions", sa.Column("gps_lat", sa.Numeric(10, 7), nullable=True))
    op.add_column("exceptions", sa.Column("gps_lng", sa.Numeric(10, 7), nullable=True))


def downgrade() -> None:
    op.drop_column("exceptions", "gps_lng")
    op.drop_column("exceptions", "gps_lat")
