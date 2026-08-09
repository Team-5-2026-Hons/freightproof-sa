"""add linehaul_photo_artifact_id to phase_events

The paper linehaul sheet the warehouse hands the driver at loading. Distinct
from waybill_photo_artifact_id (departure): that is the legal waybill copy,
this is the driver-safe summary. Third-party evidence of what the warehouse
CLAIMED was loaded, independent of FreightProof's own record.

Nullable and optional throughout the stack (model, schema, orchestration): a
warehouse that has already gone paperless hands the driver nothing to
photograph, and this must never block his trip.

Revision ID: ciaran_linehaul_photo
Revises: tim_driver_sessions
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "ciaran_linehaul_photo"
down_revision = "tim_driver_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "phase_events",
        sa.Column(
            "linehaul_photo_artifact_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "evidence_artifacts.id",
                use_alter=True,
                name="fk_phase_linehaul_photo",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_phase_linehaul_photo", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "linehaul_photo_artifact_id")
