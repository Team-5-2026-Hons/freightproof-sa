"""Trip creation redesign: trip_type, org pp_account_number, nullable consignment client org.

Revision ID: 2026_07_14_ciaran_tcr
Revises: ciaran_add_exception_scoping
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_07_14_ciaran_tcr"
down_revision = "ciaran_add_exception_scoping"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column("trip_type", sa.String(length=20), nullable=False, server_default="loaded"),
    )
    op.add_column(
        "organizations",
        sa.Column("pp_account_number", sa.String(length=6), nullable=True),
    )
    op.create_unique_constraint(
        "uq_organizations_pp_account_number", "organizations", ["pp_account_number"]
    )
    op.alter_column(
        "consignments",
        "client_organization_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    # Once consignments with NULL client_organization_id exist (the intended steady
    # state — PP-unresolved orgs), restoring NOT NULL will fail without a backfill.
    # That's expected — don't run this downgrade blindly.
    op.alter_column(
        "consignments",
        "client_organization_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_constraint(
        "uq_organizations_pp_account_number", "organizations", type_="unique"
    )
    op.drop_column("organizations", "pp_account_number")
    op.drop_column("trips", "trip_type")
