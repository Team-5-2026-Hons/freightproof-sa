"""backfill terminal timestamps and index cursor-paginated trip history

Revision ID: ciaran_trip_history_page
Revises: ciaran_exc_review_semantics
Create Date: 2026-09-06
"""

from alembic import op

revision = "ciaran_trip_history_page"
down_revision = "ciaran_exc_review_semantics"
branch_labels = None
depends_on = None

_INDEX_NAME = "ix_trips_org_status_closed_id"


def upgrade() -> None:
    op.execute("""
    UPDATE trips SET closed_at = updated_at
    WHERE status IN ('closed', 'cancelled') AND closed_at IS NULL
    """)
    op.create_index(
        _INDEX_NAME,
        "trips",
        ["operator_organization_id", "status", "closed_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="trips")
