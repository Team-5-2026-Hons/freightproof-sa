"""merge ciaran and tim heads

Revision ID: 6ee6103df09a
Revises: ciaran_action_location, 8d6a2d9df9bc
Create Date: 2026-09-15 22:40:43.071308

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6ee6103df09a'
down_revision: Union[str, Sequence[str], None] = ('ciaran_action_location', '8d6a2d9df9bc')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
