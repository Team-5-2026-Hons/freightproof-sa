"""Switch users and drivers to Supabase Auth identity.

- DROP users.hashed_password: Supabase Auth owns credentials; this column
  is dead weight and a security risk now that passwords never touch our DB.
- ADD FK users.id → auth.users(id): enforces that every dispatcher row maps
  to a real Supabase Auth account. auth.uid() in RLS policies resolves to
  users.id directly — no secondary lookup column needed.
- ADD FK drivers.id → auth.users(id): same pattern for the driver table.
  Drivers authenticate via phone OTP through Supabase; their Supabase UUID
  must equal drivers.id for RLS driver-scoped policies to work.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-13
Author: tom
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Supabase Auth manages credentials — hashed_password has no purpose.
    op.drop_column("users", "hashed_password")

    # users.id must equal the Supabase Auth UUID for auth.uid() to resolve.
    op.execute(
        "ALTER TABLE users "
        "ADD CONSTRAINT fk_users_auth_id "
        "FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;"
    )

    # drivers.id follows the same pattern.
    op.execute(
        "ALTER TABLE drivers "
        "ADD CONSTRAINT fk_drivers_auth_id "
        "FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE drivers DROP CONSTRAINT IF EXISTS fk_drivers_auth_id;")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_auth_id;")

    # Restore as nullable — original values are gone, only the column comes back.
    op.add_column(
        "users",
        sa.Column("hashed_password", sa.String(255), nullable=True),
    )
