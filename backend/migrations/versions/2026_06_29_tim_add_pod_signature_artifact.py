"""add pod_signature_artifact_id to handshake_events

BQ2 resolved: proof of delivery is a photo AND an on-device signature, not
either/or — this adds the signature artifact FK alongside the existing
pod_photo_artifact_id.

Revision ID: tim_pod_signature_artifact
Revises: ciaran_add_vehicle_length_m
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_pod_signature_artifact"
down_revision = "ciaran_add_vehicle_length_m"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "handshake_events",
        sa.Column(
            "pod_signature_artifact_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "evidence_artifacts.id",
                use_alter=True,
                name="fk_handshake_pod_signature",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_handshake_pod_signature", "handshake_events", type_="foreignkey")
    op.drop_column("handshake_events", "pod_signature_artifact_id")
