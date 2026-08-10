"""Add missing updated_at column to vehicles table.

The initial migration (0001) accidentally omitted updated_at from the vehicles
table while every other table received it. The ORM model has the column, so
any INSERT causes a ProgrammingError when SQLAlchemy's RETURNING clause
requests a column the DB doesn't have.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicles",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )

    # Backfill existing rows so updated_at = created_at (best approximation).
    op.execute("UPDATE vehicles SET updated_at = created_at")

    # Wire up the existing trigger function that keeps updated_at current.
    op.execute(
        """
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON vehicles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS set_updated_at ON vehicles")
    op.drop_column("vehicles", "updated_at")
