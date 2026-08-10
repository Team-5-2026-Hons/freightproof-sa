"""add driver_sessions — one active device per driver

A driver account signed in on two handsets attributes evidence captured by two
people to one identity. Supabase signs the tokens and the backend cannot revoke
one, so instead it records the session it recognises and refuses requests that
carry an older one.

Revision ID: tim_driver_sessions
Revises: tim_trip_location_pings
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_driver_sessions"
down_revision = "tim_trip_location_pings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "driver_sessions",
        # driver_id is the primary key: a schema that can hold two rows for one driver
        # would permit exactly the state this table exists to prevent.
        sa.Column("driver_id", UUID(as_uuid=True), sa.ForeignKey("drivers.id"), primary_key=True, nullable=False),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("driver_sessions")
