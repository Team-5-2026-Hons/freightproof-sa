"""FP-239 — handover_confirmations, plus opened_at and session_secret_hash on tokens.

The unique constraint on phase_event_id is the real content of this migration. The
rotating series (FP-237) issues many capability tokens against one confirmation phase
event; exactly one of them may ever produce a confirmation, and that is enforced here
rather than trusted to the application — the same reasoning that put FP-236's redemption
gate in a conditional UPDATE instead of in Python.

opened_at exists because rotation and a human being are in direct conflict. The QR
re-issues every HANDOVER_ROTATION_SECONDS and each new frame retires the one before it,
which is the whole security value of rotating at all — but a receiver who scans at T
then spends forty seconds typing their name would find their token retired underneath
them by a rotation they never saw. Recording the moment a token's page is opened lets
rotation skip that token and stop: the code the receiver is actually holding stays
alive, and no OTHER code is live alongside it. A photograph of the driver's screen is
still dead within one interval, because a photograph never opens the page.

session_secret_hash is what stops a forwarded link. A capability token in a URL is a
BEARER credential: anyone holding the URL can spend it, so a receiver could screenshot it
and send it to someone who was never at the delivery. Device binding is not available to
us — no browser exposes a MAC address, and South African mobile IPs are CGNAT'd to
uselessness (docs/iteration2-feedback-response-2026-08-25.md §7) — but BROWSER binding
is. The first load of a token's page mints a second secret, returns it as an HttpOnly
cookie, and stores only its hash here; confirming requires both halves. A forwarded URL
arrives at a browser with no cookie and mints no new one, because the minting is
conditional on opened_at being NULL.

Honest about what that is worth: it binds to a browser profile, not to hardware. Handing
over an unlocked phone defeats it, and so does copying a cookie out of devtools. It stops
the casual forward, which is the realistic threat.

Revision ID: tim_handover_confirm
Revises: tom_trailer_vehicle_analytics
Create Date: 2026-09-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Keep revision ids under 32 characters — alembic_version.version_num is varchar(32).
revision = "tim_handover_confirm"
down_revision = "tom_trailer_vehicle_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "handover_capability_tokens",
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    # SHA-256 hex of the browser-binding secret — 64 characters, same convention as
    # token_hash on this table. Never the secret itself, for the same reason.
    op.add_column(
        "handover_capability_tokens",
        sa.Column("session_secret_hash", sa.String(64), nullable=True),
    )
    op.create_table(
        "handover_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "token_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("handover_capability_tokens.id"),
            nullable=False,
        ),
        sa.Column(
            "phase_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("phase_events.id"),
            nullable=False,
        ),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trips.id"), nullable=False),
        sa.Column(
            "signature_artifact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("evidence_artifacts.id"),
            nullable=False,
        ),
        sa.Column("receiver_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("receiver_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("receiver_accuracy_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("receiver_ip", sa.String(45), nullable=True),
        sa.Column("receiver_user_agent", sa.String(512), nullable=True),
        sa.Column("bearer_token_present", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_handover_confirmations_phase_event_id",
        "handover_confirmations",
        ["phase_event_id"],
    )
    # The driver's handover step polls this by trip while waiting for the receiver to
    # scan, every few seconds for as long as the handover takes. Without this index that
    # poll is a sequential scan each time.
    op.create_index("ix_handover_confirmations_trip_id", "handover_confirmations", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_handover_confirmations_trip_id", table_name="handover_confirmations")
    op.drop_constraint(
        "uq_handover_confirmations_phase_event_id", "handover_confirmations", type_="unique"
    )
    op.drop_table("handover_confirmations")
    op.drop_column("handover_capability_tokens", "session_secret_hash")
    op.drop_column("handover_capability_tokens", "opened_at")
