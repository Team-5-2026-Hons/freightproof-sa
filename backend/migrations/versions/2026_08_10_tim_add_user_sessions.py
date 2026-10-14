"""add user_sessions — last-seen record backing the dispatcher idle timeout

Supabase refreshes access tokens indefinitely, so a dispatcher who signs in and walks
away stays authenticated forever unless this side tracks activity. One row per session,
stamped on every authenticated request and read by auth/sessions.enforce_idle_timeout.

Keyed on session_id, not user_id: a dispatcher may legitimately work from two machines,
and keying on the user would make both share one idle clock that neither could ever
exhaust. (DriverSession is keyed the other way on purpose — a driver may hold exactly
one session, because evidence attribution depends on it.)

Purely additive: creates one new table and touches nothing existing.

Revision ID: tim_user_sessions
Revises: ciaran_linehaul_photo
Create Date: 2026-08-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_user_sessions"
down_revision = "ciaran_linehaul_photo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        # session_id is the primary key — see the module docstring on why this differs
        # from driver_sessions.
        sa.Column("session_id", sa.String(255), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # user_id: the retention sweep deletes a user's own expired rows on their next sign-in.
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    # last_seen_at: the same sweep filters on age.
    op.create_index("ix_user_sessions_last_seen_at", "user_sessions", ["last_seen_at"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_last_seen_at", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
