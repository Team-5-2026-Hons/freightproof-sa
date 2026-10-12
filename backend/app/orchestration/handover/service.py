"""Handover route sequencing — the database work behind the receiver QR routes (FP-155).

Top tier of handover/: it composes `capability` and `receiver_verification`, which never
import it. `api/v1/endpoints/handover.py` validates, calls one function here per step,
maps the errors below onto HTTP, and decides when the transaction is saved.

Nothing in this module ends a transaction, and nothing raises HTTPException. Transaction
boundaries stay in the route because the redemption gate saves at points the HTTP response
depends on (a lost race saves its attempt row BEFORE the 404). Errors are domain types from
core/exceptions.py; the route owns the status codes and detail strings.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    HandoverAlreadyConfirmedError,
    HandoverLinkInvalidError,
    ResourceNotFoundError,
)
from app.db.models.enums import ArtifactType, EvidenceRole, PhaseType
from app.db.models.handover import HandoverCapabilityToken, HandoverConfirmation
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.db.models.trips import Consignment, Trip, TripStop
from app.orchestration.evidence.artifacts import create_receiver_artifact
from app.orchestration.evidence.attribution import EvidenceAttribution
from app.orchestration.handover.capability import (
    HandoverRedemptionResult,
    RotationResult,
    find_open_token,
    hash_presented_token,
    load_handover_confirmation,
    mark_token_opened,
    record_handover_confirmation,
    redeem_capability_token,
    rotate_capability_token,
)
from app.orchestration.handover.receiver_verification import (
    attach_confirmation,
    load_verification_for_token,
    raise_verification_exception,
    record_consent_decision,
    resolve_verification,
    start_verification,
)

# The signature is a PNG the receiver drew; nothing else is ever stored from this surface.
_SIGNATURE_MIME_TYPE = "image/png"


@dataclass(frozen=True)
class ConfirmationTarget:
    """A confirmation phase event the calling driver owns, with the stop it confirms.

    `trip_stop_id` is a plain UUID, not Optional: load_confirmation_target refuses an event
    without one, so callers never need to re-check it.
    """

    event_id: uuid.UUID
    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID


@dataclass(frozen=True)
class HandoverProgress:
    """Where a handover stands: confirmed, or at least opened by the receiver."""

    confirmation: Optional[HandoverConfirmation]
    receiver_opened: bool


@dataclass(frozen=True)
class ScanPage:
    """Everything the public scan page reads back, gathered in one pass."""

    token: HandoverCapabilityToken
    # Not None only on the first load of this link (the browser-binding cookie's value).
    session_secret: Optional[str]
    trip_reference: str
    destination_name: Optional[str]
    waybill_references: list[Optional[str]]
    verification: Optional[ReceiverIdentityVerification]


@dataclass(frozen=True)
class ReceiverSubmission:
    """What the receiver's confirm request carried, already decoded by the route."""

    signature_bytes: bytes
    receiver_lat: Optional[Decimal]
    receiver_lng: Optional[Decimal]
    receiver_accuracy_m: Optional[Decimal]
    receiver_ip: Optional[str]
    receiver_user_agent: Optional[str]
    bearer_token_present: bool


@dataclass(frozen=True)
class ConsentOutcome:
    """The verification row for a consent request, and whether this request created it."""

    verification: ReceiverIdentityVerification
    created: bool


@dataclass(frozen=True)
class VerificationStart:
    """The locked verification row and the vendor session URL, if one could be started."""

    verification: ReceiverIdentityVerification
    session_url: Optional[str]


async def load_confirmation_target(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID, driver_id: uuid.UUID,
) -> ConfirmationTarget:
    """Resolve a confirmation phase event the given driver actually owns.

    Ownership is checked in the same query, not after it: a driver who doesn't own the
    trip gets the same not-found as a trip that doesn't exist, so no row detail leaks.
    """
    event = (
        await db.execute(
            select(PhaseEvent)
            .join(Trip, Trip.id == PhaseEvent.trip_id)
            .where(
                PhaseEvent.id == phase_event_id,
                PhaseEvent.trip_id == trip_id,
                PhaseEvent.phase_type == PhaseType.CONFIRMATION,
                Trip.driver_id == driver_id,
            )
        )
    ).scalar_one_or_none()

    if event is None or event.trip_stop_id is None:
        raise ResourceNotFoundError("Confirmation phase", str(phase_event_id))
    return ConfirmationTarget(
        event_id=event.id, trip_id=event.trip_id, trip_stop_id=event.trip_stop_id,
    )


async def ensure_handover_open(db: AsyncSession, *, target: ConfirmationTarget) -> None:
    """Refuse to re-open a handover that already happened.

    Else the driver could keep minting live grants to overwrite a confirmation the
    receiver already gave.
    """
    if await load_handover_confirmation(db, phase_event_id=target.event_id) is not None:
        raise HandoverAlreadyConfirmedError(str(target.event_id))


async def rotate_next_token(
    db: AsyncSession, *, target: ConfirmationTarget, force: bool,
) -> RotationResult:
    """Mint the next code in the rotating series for this confirmation."""
    return await rotate_capability_token(
        db,
        phase_event_id=target.event_id,
        trip_id=target.trip_id,
        trip_stop_id=target.trip_stop_id,
        force=force,
    )


async def load_handover_progress(
    db: AsyncSession, *, target: ConfirmationTarget,
) -> HandoverProgress:
    """Whether the receiver has confirmed yet, and failing that whether they opened the link."""
    confirmation = await load_handover_confirmation(db, phase_event_id=target.event_id)
    if confirmation is not None:
        return HandoverProgress(confirmation=confirmation, receiver_opened=True)

    open_token = await find_open_token(db, phase_event_id=target.event_id)
    return HandoverProgress(confirmation=None, receiver_opened=open_token is not None)


async def load_live_token(db: AsyncSession, raw_token: str) -> HandoverCapabilityToken:
    """Look a presented token up for the READ path only — never for redemption, which goes
    through redeem_capability_token's conditional UPDATE. Same error for every reason."""
    token = (
        await db.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.token_hash == hash_presented_token(raw_token)
            )
        )
    ).scalar_one_or_none()

    if token is None or token.redeemed_at is not None:
        raise HandoverLinkInvalidError()
    if token.expires_at <= datetime.now(UTC):
        raise HandoverLinkInvalidError()
    return token


async def load_trip_for_token(db: AsyncSession, *, token: HandoverCapabilityToken) -> Trip:
    """The trip a live token belongs to. The FK guarantees it exists."""
    return (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()


async def load_scan_page(db: AsyncSession, *, raw_token: str) -> ScanPage:
    """Open the link and gather what the receiver is about to confirm.

    Marks the token opened (pausing the driver's rotation), so the caller must save the transaction.
    """
    token = await load_live_token(db, raw_token)

    # Returns a secret on the FIRST load only; a forwarded URL opened in a second browser
    # gets None, no cookie, and will fail to confirm — but the page still renders.
    session_secret = await mark_token_opened(db, token_id=token.id)

    trip = await load_trip_for_token(db, token=token)
    # Explicit join: TripStop has no `precinct` relationship, only the FK column.
    destination_name = (
        await db.execute(
            select(Precinct.name)
            .join(TripStop, TripStop.precinct_id == Precinct.id)
            .where(TripStop.id == token.trip_stop_id)
        )
    ).scalar_one_or_none()
    waybills = (
        await db.execute(
            select(Consignment.parcel_perfect_reference).where(
                Consignment.delivery_stop_id == token.trip_stop_id
            )
        )
    ).scalars().all()

    verification = await load_verification_for_token(db, token_id=token.id)

    return ScanPage(
        token=token,
        session_secret=session_secret,
        trip_reference=trip.trip_reference,
        destination_name=destination_name,
        waybill_references=list(waybills),
        verification=verification,
    )


async def redeem_token(
    db: AsyncSession, *, token: HandoverCapabilityToken, raw_token: str,
) -> HandoverRedemptionResult:
    """The gate: the single conditional UPDATE deciding whether this delivery gets
    confirmed, so two simultaneous scans race the database, not each other in Python.

    On failure the attempt row is already written, so the caller must SAVE the transaction
    before answering — the attempt is evidence, and discarding it would erase the record.
    """
    result = await redeem_capability_token(
        db, trip_id=token.trip_id, trip_stop_id=token.trip_stop_id, raw_token=raw_token,
    )
    if not result.success:
        raise HandoverLinkInvalidError()
    return result


async def record_receiver_confirmation(
    db: AsyncSession, *, token: HandoverCapabilityToken, submission: ReceiverSubmission,
) -> HandoverConfirmation:
    """Store the signature, write the confirmation and link any verification to it."""
    artifact = await create_receiver_artifact(
        db,
        trip_id=token.trip_id,
        file_bytes=submission.signature_bytes,
        mime_type=_SIGNATURE_MIME_TYPE,
        artifact_type=ArtifactType.DOCUMENT,
        captured_at=datetime.now(UTC),  # server clock; receiver's phone clock isn't evidence
        captured_lat=submission.receiver_lat,
        captured_lng=submission.receiver_lng,
        attribution=EvidenceAttribution(
            phase_event_id=token.phase_event_id, role=EvidenceRole.POD_SIGNATURE,
        ),
    )
    confirmation = await record_handover_confirmation(
        db,
        token=token,
        signature_artifact_id=artifact.id,
        receiver_lat=submission.receiver_lat,
        receiver_lng=submission.receiver_lng,
        receiver_accuracy_m=submission.receiver_accuracy_m,
        receiver_ip=submission.receiver_ip,
        receiver_user_agent=submission.receiver_user_agent,
        bearer_token_present=submission.bearer_token_present,
    )
    # Separate from confirmation: a receiver may verify and then walk away, which is
    # a real state, not an error.
    await attach_confirmation(
        db, token_id=token.id, handover_confirmation_id=confirmation.id,
    )
    return confirmation


async def submit_consent(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    consent_text: str,
    consented: bool,
    has_document: bool,
) -> ConsentOutcome:
    """Create the verification row; must precede any vendor session (POPIA s27(1)(a)).

    Idempotent: a reload mid-flow must not create a second row, so an existing one is
    returned untouched with `created=False` and nothing for the caller to save.
    """
    existing = await load_verification_for_token(db, token_id=token.id)
    if existing is not None:
        return ConsentOutcome(verification=existing, created=False)

    verification = await record_consent_decision(
        db, token=token, consent_text=consent_text,
        consented=consented, has_document=has_document,
    )
    return ConsentOutcome(verification=verification, created=True)


async def begin_verification(
    db: AsyncSession, *, token: HandoverCapabilityToken, raw_token: str,
) -> VerificationStart:
    """Claim quota, create the vendor session and extend the token.

    `session_url` is None on every degradation path, not an error.
    """
    # Locked: a doubled request waits, then sees the first's session instead of making another.
    verification = await load_verification_for_token(db, token_id=token.id, lock=True)
    if verification is None:
        raise HandoverLinkInvalidError()

    session = await start_verification(
        db,
        token=token,
        raw_token=raw_token,  # row stores only a hash; vendor needs the presented token
        verification=verification,
    )
    return VerificationStart(
        verification=verification,
        session_url=session.session_url if session is not None else None,
    )


async def resolve_receiver_verification(
    db: AsyncSession, *, token: HandoverCapabilityToken, typed_name: str, typed_id_number: str,
) -> ReceiverIdentityVerification:
    """Fetch the authoritative decision and file any exception it calls for.

    Takes no session identifier from the caller: the session id comes from our own row,
    written before the redirect, so the client can only say "I am back".
    """
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        raise HandoverLinkInvalidError()

    verdict = await resolve_verification(
        db,
        verification=verification,
        typed_name=typed_name,
        typed_id_number=typed_id_number,
    )

    if verdict.exception_type is not None:
        trip = await load_trip_for_token(db, token=token)
        await raise_verification_exception(
            db, trip=trip, phase_event_id=token.phase_event_id,
            trip_stop_id=token.trip_stop_id, verdict=verdict,
        )
    return verification
