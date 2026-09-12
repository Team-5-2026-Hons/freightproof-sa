"""SQLAlchemy models for the receiver QR handover (FP-155).

A capability token is the entire mechanism: no receiver account, no OTP. The driver's
device displays it as a QR; the receiver's ordinary phone camera reads it and posts a
confirmation against it. Everything here exists to make that single POST unforgeable —
single-use, short-lived, cryptographically unguessable, and bound to the exact stop it
was issued for.

Scope note: this is the token primitive only. Issuing the *rotating* series of codes
that share one grant (FP-237), the QR render (FP-238), the public scan page (FP-239)
and same-device detection (FP-240) are separate tickets built on top of this table.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import HandoverTokenRejectionReason


class HandoverCapabilityToken(Base):
    """One single-use grant to confirm a delivery at one stop.

    The raw token is never stored — only `token_hash` (SHA-256 hex) — so a leaked
    database row yields nothing redeemable, the same reasoning `driver_sessions` and
    `user_sessions` apply to Supabase's tokens rather than to a password. `trip_id`
    and `trip_stop_id` are denormalised off `phase_event_id` (rather than requiring a
    join to check them) so `redeem_capability_token` can reject a wrong-trip or
    wrong-stop presentation with one row read, matching the denormalisation
    `phase_step_events.trip_id` uses for the same reason in the sibling design note.

    Redemption is `redeemed_at IS NOT NULL` — there is no separate status column.
    The atomic gate in `orchestration/handover_service.redeem_capability_token` is a
    single conditional `UPDATE ... WHERE redeemed_at IS NULL AND expires_at > now()`,
    so two simultaneous scans race the database, not application code.
    """

    __tablename__ = "handover_capability_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_handover_capability_tokens_token_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    trip_stop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trip_stops.id"), nullable=False
    )
    # SHA-256 hex digest of the raw token — see class docstring. Indexed via the
    # unique constraint above; redemption looks a presented token up by this hash.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HandoverTokenAttempt(Base):
    """Every redemption attempt against a capability token — accepted or rejected.

    A rejected attempt is evidence in its own right (per the ticket's DoD), the same
    principle the seal-mismatch sites in `phase_service.py` apply to a failed
    comparison: record it, do not just return an error and forget it happened.

    `token_id` is nullable because an UNKNOWN attempt (a presented token whose hash
    matches nothing) has no row to point at — the attempt is still logged, with
    `presented_trip_id`/`presented_stop_id` holding whatever the caller supplied so an
    investigator can see what was tried even when it was tried against nothing real.
    """

    __tablename__ = "handover_token_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=True
    )
    presented_trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    presented_trip_stop_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # NULL means the attempt succeeded. Every rejected row carries one of the
    # HandoverTokenRejectionReason values — never free text, so the evidence stays
    # queryable and the same identical-rejection-response requirement FP-239 needs
    # (expired/unknown/already-redeemed must look alike to the caller) can be built
    # on top of this column without re-deriving the reason from scratch.
    rejection_reason: Mapped[Optional[HandoverTokenRejectionReason]] = mapped_column(
        String(30), nullable=True
    )
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
