"""Versioned immediate requests and independent phone observation metadata.

Owner: Ciaran. Hand-written, additive; no historical evidence/hash/result rewrites.
Never apply from this feature branch to shared Supabase.
"""
from alembic import op
import sqlalchemy as sa

revision = 'ciaran_driver_transfer_v2'
down_revision = 'tim_dsub_driver_analytics'
branch_labels = None
depends_on = None

_REQUEST = 'driver_substitution_requests'
_CONFIRMATION = 'driver_substitution_confirmations'
_COMPLETED = 'driver_substitutions'
_PLANNING = ('exchange_label', 'exchange_latitude', 'exchange_longitude', 'exchange_instructions', 'expected_at', 'is_planned')
_SHAPE = (
    "(request_format = 'planned_v1' AND reservation_start_at IS NULL AND "
    "num_nonnulls(exchange_label, exchange_latitude, exchange_longitude, exchange_instructions, expected_at, is_planned) = 6) OR "
    "(request_format = 'immediate_v2' AND reservation_start_at IS NOT NULL AND "
    "num_nonnulls(exchange_label, exchange_latitude, exchange_longitude, exchange_instructions, expected_at, is_planned) = 0)"
)


def upgrade() -> None:
    op.add_column(_REQUEST, sa.Column('request_format', sa.String(20), nullable=False, server_default='planned_v1'))
    op.add_column(_REQUEST, sa.Column('reservation_start_at', sa.DateTime(timezone=True), nullable=True))
    for field in _PLANNING:
        op.alter_column(_REQUEST, field, nullable=True)
    op.alter_column(_REQUEST, 'exchange_instructions', server_default=None)
    op.create_check_constraint('ck_dsub_requests_format_shape', _REQUEST, _SHAPE)
    op.alter_column(_COMPLETED, 'exchange_location', nullable=True)
    op.alter_column(_COMPLETED, 'is_planned', nullable=True)
    op.add_column(_CONFIRMATION, sa.Column('location_observed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(_CONFIRMATION, sa.Column('location_unavailable_reason', sa.String(30), nullable=True))


def downgrade() -> None:
    # Dropping accepted policy/observations would destroy evidence; require a human-led decision.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM driver_substitution_requests WHERE request_format <> 'planned_v1')")):
        raise RuntimeError('Cannot downgrade while immediate-v2 transfer records exist')
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM driver_substitution_confirmations WHERE location_observed_at IS NOT NULL OR location_unavailable_reason IS NOT NULL)")):
        raise RuntimeError('Cannot downgrade while phone observation metadata exists')
    op.drop_column(_CONFIRMATION, 'location_unavailable_reason')
    op.drop_column(_CONFIRMATION, 'location_observed_at')
    op.alter_column(_COMPLETED, 'is_planned', nullable=False)
    op.alter_column(_COMPLETED, 'exchange_location', nullable=False)
    op.drop_constraint('ck_dsub_requests_format_shape', _REQUEST, type_='check')
    for field in _PLANNING:
        op.alter_column(_REQUEST, field, nullable=False)
    op.alter_column(_REQUEST, 'exchange_instructions', server_default='')
    op.drop_column(_REQUEST, 'reservation_start_at')
    op.drop_column(_REQUEST, 'request_format')
