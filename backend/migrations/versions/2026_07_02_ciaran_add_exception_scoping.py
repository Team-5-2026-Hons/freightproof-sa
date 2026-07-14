"""Add consignment_id + trip_stop_id scoping FKs to exceptions (FP-112 alignment).

Adds nullable consignment_id/trip_stop_id columns to the exceptions table so a
multi-client evidence chain can be cut per client and per stop. Nothing
populates these columns yet — handshake_service.py doesn't know its stop
until the iter-3 per-stop refactor.

Revision ID: ciaran_add_exception_scoping
Revises: ciaran_add_tripstop
Create Date: 2026-07-02
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_add_exception_scoping"
down_revision = "ciaran_add_tripstop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exceptions", sa.Column("consignment_id", sa.UUID(), nullable=True))
    op.add_column("exceptions", sa.Column("trip_stop_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_exceptions_consignment_id", "exceptions", "consignments", ["consignment_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_exceptions_trip_stop_id", "exceptions", "trip_stops", ["trip_stop_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_exceptions_trip_stop_id", "exceptions", type_="foreignkey")
    op.drop_constraint("fk_exceptions_consignment_id", "exceptions", type_="foreignkey")
    op.drop_column("exceptions", "trip_stop_id")
    op.drop_column("exceptions", "consignment_id")
