"""add vehicle_id to exceptions

A breakdown is recorded against its trip only, and trailers attach to a trip through
the many-to-many trip_trailers table, so nothing said which trailer on an interlink
broke down. Adds a nullable exceptions.vehicle_id (FK to vehicles) that the server sets
on MECHANICAL exceptions from the driver's "truck or trailer" answer
(docs/design-notes/2026-09-12-trailer-analytics-spec.md, Stage 1).

No backfill: an old breakdown can't be tied to a vehicle truthfully, so it stays NULL
and keeps counting for the trip's horse (spec decision 2).

Safe beside the FP-153 materialized views: they read the exceptions table, but ADD
COLUMN leaves dependent views alone, and none of them reference vehicle_id, so the
downgrade's DROP COLUMN is safe too.

Linearized 2026-09-12: this migration and Tim's tim_handover_tokens (FP-236) were both
written on top of tom_analytics_read_models, which gave Alembic two heads once both
reached dev. This one was re-pointed onto tim_handover_tokens so the chain stays a single
line; Tim's migration is unchanged. The two share no table, so the order changes nothing
in the schema.

Revision ID: tom_add_exception_vehicle
Revises: tim_handover_tokens
Create Date: 2026-09-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tom_add_exception_vehicle"
down_revision = "tim_handover_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exceptions",
        sa.Column(
            "vehicle_id",
            UUID(as_uuid=True),
            sa.ForeignKey("vehicles.id", name="fk_exceptions_vehicle_id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_exceptions_vehicle_id", "exceptions", type_="foreignkey")
    op.drop_column("exceptions", "vehicle_id")
