"""Add missing updated_at column to precincts table.

Same omission as vehicles — the initial migration (0001) created the precincts
table without updated_at despite the ORM model defining it. Any ORM INSERT
fails because SQLAlchemy includes updated_at in the RETURNING clause.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "precincts",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )

    op.execute("UPDATE precincts SET updated_at = created_at")

    op.execute(
        """
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON precincts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS set_updated_at ON precincts")
    op.drop_column("precincts", "updated_at")
