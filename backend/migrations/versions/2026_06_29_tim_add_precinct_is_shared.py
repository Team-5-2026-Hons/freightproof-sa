"""add is_shared to precincts

SEC-PRECINCT-1: GET /precincts leaked every organization's precincts (GPS
coordinates, geofence radius) to every authenticated dispatcher. Precincts
now default to private to principal_organization_id; is_shared opts a
precinct into cross-org visibility.

Revision ID: tim_add_precinct_is_shared
Revises: tim_pod_signature_artifact
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "tim_add_precinct_is_shared"
down_revision = "tim_pod_signature_artifact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "precincts",
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("precincts", "is_shared")
