"""tim add receiver verification

Revision ID: de581e6a301b
Revises: tom_live_analytics_views
Create Date: 2026-09-15 12:24:44.650370

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de581e6a301b'
down_revision: Union[str, Sequence[str], None] = 'tom_live_analytics_views'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('idvs_quota_ledger',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('sessions_used', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('period', 'provider', name='uq_idvs_quota_ledger_period_provider')
    )
    op.create_table('receiver_identity_verifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('token_id', sa.UUID(), nullable=False),
    sa.Column('handover_confirmation_id', sa.UUID(), nullable=True),
    sa.Column('trip_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('tier', sa.String(length=20), nullable=False),
    sa.Column('unverified_reason', sa.String(length=30), nullable=True),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('provider_session_id', sa.String(length=64), nullable=True),
    sa.Column('provider_decision_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('identity_match', sa.Boolean(), nullable=True),
    sa.Column('selfie_artifact_id', sa.UUID(), nullable=True),
    sa.Column('consent_given_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('consent_text_hash', sa.String(length=64), nullable=True),
    sa.Column('late_decision_status', sa.String(length=20), nullable=True),
    sa.Column('late_decision_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['handover_confirmation_id'], ['handover_confirmations.id'], ),
    sa.ForeignKeyConstraint(['selfie_artifact_id'], ['evidence_artifacts.id'], ),
    sa.ForeignKeyConstraint(['token_id'], ['handover_capability_tokens.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_id', name='uq_receiver_identity_verifications_token_id')
    )
    op.add_column('handover_capability_tokens', sa.Column('verification_extended_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('handover_capability_tokens', 'verification_extended_at')
    op.drop_table('receiver_identity_verifications')
    op.drop_table('idvs_quota_ledger')
