"""add seal_number_source and linehaul_pdf_artifact_id to phase_events

seal_number_source records how a departure or arrival seal number was entered on the
phone: read by on-device OCR and confirmed, OCR corrected by the driver, or typed.
Recorded, never anchored. linehaul_pdf_artifact_id is the scanned linehaul sheet as a
PDF, anchored with the scan image in loading payload v3.

Both nullable: older app builds send neither, and a failed PDF build must not block
loading.

Revision ID: tim_seal_source_linehaul_pdf
Revises: tim_precinct_geofence_polygon
Create Date: 2026-10-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "tim_seal_source_linehaul_pdf"
down_revision = "tim_precinct_geofence_polygon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("phase_events", sa.Column("seal_number_source", sa.String(20), nullable=True))
    op.add_column(
        "phase_events",
        sa.Column(
            "linehaul_pdf_artifact_id",
            UUID(as_uuid=True),
            sa.ForeignKey("evidence_artifacts.id", use_alter=True, name="fk_phase_linehaul_pdf"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_phase_linehaul_pdf", "phase_events", type_="foreignkey")
    op.drop_column("phase_events", "linehaul_pdf_artifact_id")
    op.drop_column("phase_events", "seal_number_source")
