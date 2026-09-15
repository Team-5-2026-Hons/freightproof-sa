"""SQLAlchemy models for the receiver QR handover (FP-155).

A capability token is the entire mechanism: no receiver account, no OTP. The driver's
device displays it as a QR; the receiver's ordinary phone camera reads it and posts a
confirmation against it. Everything here exists to make that single POST unforgeable —
single-use, short-lived, cryptographically unguessable, and bound to the exact stop it
was issued for.

Scope note: FP-236 built the token primitive alone. FP-237/238/239/240 have since been
built on top of it — the rotating series is handover_service.rotate_capability_token,
the QR render is driver-pwa's ReceiverHandover step, the public scan page is
frontend/receiver, and same-device detection is HandoverConfirmation.bearer_token_present
below.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, UniqueConstraint
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
    # When the receiver's browser first loaded this token's page (FP-239). Non-null means
    # a human is holding this code right now, which is what takes it out of the rotation:
    # rotate_capability_token will neither retire an opened token nor issue a successor
    # to one, so the code in the receiver's hand stays alive while they type their name.
    #
    # NOT a redemption and not a claim on the delivery — only the conditional UPDATE in
    # redeem_capability_token decides that, and an opened token that is never confirmed
    # still dies at expires_at like any other. It is also a UX signal in its own right:
    # the driver's screen can say "the receiver has opened the link" instead of leaving
    # them watching a code with no idea whether the scan worked.
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set the one time this token's life was extended to cover an identity verification
    # (spec §6.3). Its NULL-ness is the gate, not a flag a caller checks: the conditional
    # UPDATE in extend_token_for_verification keys on it, so the extension is
    # single-claim at the database exactly as opened_at is.
    verification_extended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # SHA-256 hex of the browser-binding secret minted on that first page load, never the
    # secret itself — the same rule token_hash above follows, for the same reason.
    #
    # This is the half of the credential that does not travel in the QR. The token in the
    # URL is a bearer credential and a screenshot of it is as good as the original; this
    # second half is set as an HttpOnly cookie on the ONE browser that opened the link
    # first, and confirming requires both. A forwarded URL lands in a browser with no
    # cookie and cannot mint one, because minting is conditional on opened_at being NULL.
    #
    # It binds a browser profile, not a device — no web API can do the latter (no MAC
    # address is exposed, and CGNAT makes mobile IPs worthless as identifiers). Handing
    # someone an unlocked phone still defeats it. It stops the casual forward.
    session_secret_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
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


class HandoverConfirmation(Base):
    """What the receiver actually did, once a capability token was redeemed.

    One row per successful redemption — enforced by the unique constraint on
    `phase_event_id`, not merely by the token being single-use: the rotating series
    (FP-237) issues many tokens against one confirmation phase event, and this
    constraint is what makes "the confirmation happened once" true at the database
    rather than at the application's word.

    What is NOT here is as deliberate as what is. The receiver's name and ID number are
    rendered INTO the attestation PNG and live only in Supabase Storage (af-south-1),
    exactly as ConfirmationEvidence.recipientName documents for the driver-side flow
    this replaces. Putting them in columns here would move personal data into a row that
    phase reads and evidence exports join against, for no evidential gain — the PNG is
    what gets hashed and what gets shown in a dispute.

    receiver_ip and receiver_user_agent are recorded as WEAK signals and nothing more.
    South African mobile networks are heavily CGNAT'd (docs/iteration2-feedback-response
    -2026-08-25.md §7): thousands of subscribers share one address, and driver and
    receiver on the same warehouse wifi are identical. They are kept because a
    suspicious attempt is evidence in its own right, the same principle
    HandoverTokenAttempt applies — never because they identify anyone.
    """

    __tablename__ = "handover_confirmations"
    __table_args__ = (
        UniqueConstraint("phase_event_id", name="uq_handover_confirmations_phase_event_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The redeemed grant this confirmation came through. Non-null: a confirmation with no
    # token did not come from a scan, and there is no other way to create one.
    token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=False
    )
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    # The attestation PNG the receiver's own browser rendered. This is the artifact the
    # driver's ConfirmationCompleteRequest then submits as pod_signature_artifact_id —
    # the whole point of the feature is that this id refers to something the driver's
    # device did not produce.
    signature_artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=False
    )
    # The receiver's OWN position fix, from their own browser — a third independent
    # source on the most disputed moment in the trip, alongside the driver's phone and
    # Pulsit. Nullable because a browser may refuse or fail to produce one, and a
    # handover with no fix is still a handover; the absence is itself part of the record.
    receiver_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_accuracy_m: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    # 45 characters holds an IPv6 address with an IPv4-mapped suffix, the longest form
    # this can legitimately take.
    receiver_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    receiver_user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # FP-240. True when the confirming request carried an Authorization header at all.
    # An ordinary camera scan opens a fresh, tokenless browser context, so this is
    # normally False; True means the confirmation came from something already holding one
    # of our sessions — most plausibly the driver's own handset. Recorded as evidence and
    # never used as a gate, following the seal-mismatch precedent in phase_service.py:
    # record it, do not just refuse and forget it happened.
    bearer_token_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Server clock, never the client's — the design point carried from the feedback
    # response: "Server timestamp only — never trust the client clock."
    confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
