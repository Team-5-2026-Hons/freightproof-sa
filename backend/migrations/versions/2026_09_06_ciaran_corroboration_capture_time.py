"""add phase_events.driver_captured_at and checkpoints.driver_captured_at

Task 0A: closes the timestamp gap in Pulsit corroboration (FP-68 follow-up).
Before this, a phase/checkpoint completion queued offline and flushed hours later
carried no independent record of WHEN the driver's phone actually submitted it —
only completed_at/created_at, both stamped when the SERVER processed the request.
Comparing a fresh Pulsit fix (taken at process time) against a driver claim from
hours earlier manufactured a position agreement or disagreement neither source
actually attested to. `driver_captured_at` is the driver's own capture instant,
diffed against the tracker fix's own reading time in
app/orchestration/corroboration_service.py's `_within_corroboration_skew`.

Both columns are nullable with no server_default and no backfill: a row completed
before this column existed genuinely has no recorded capture instant, and inventing
one (from completed_at, or from now()) would fabricate evidence this task exists to
stop fabricating. Timezone-aware only, matching every other timestamp column on
these two tables — enforced at the schema layer (schemas/phases.py, schemas/
transit.py), not by the column type itself, since Postgres's TIMESTAMPTZ silently
accepts a naive value stored under the session's timezone rather than rejecting it.

Revision ID: ciaran_corr_capture_time
Revises: ciaran_exc_resolution_method
Create Date: 2026-09-06
"""
from alembic import op
import sqlalchemy as sa

revision = "ciaran_corr_capture_time"
down_revision = "ciaran_exc_resolution_method"
branch_labels = None
depends_on = None

_COLUMN = "driver_captured_at"


def upgrade() -> None:
    op.add_column(
        "phase_events", sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "checkpoints", sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("checkpoints", _COLUMN)
    op.drop_column("phase_events", _COLUMN)
