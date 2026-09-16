"""Receiver QR handover routes (FP-155).

Two routers, one module: `router` is driver-authenticated (issues the rotating QR,
reports confirmation status); `public_router` has NO authentication — the capability
token in the path IS the authorisation (db/models/handover.py).

The public half is the only unauthenticated write-capable surface in this API. Rules:
  1. Every failure looks the same — one 404, one detail string. True reason goes to
     handover_token_attempts, never over HTTP.
  2. It reads back almost nothing — see HandoverScanResponse's docstring.
  3. Rate-limited per IP, since a receiver has no token to count against.
  4. Confirming needs both halves of the credential: the URL token and the HttpOnly
     cookie minted when the URL was first opened — the cookie is what a receiver can't forward.
"""

import base64
import json
import logging
from datetime import UTC, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.client_ip import resolve_client_ip
from app.core.config import settings
from app.core.limits import HANDOVER_ISSUE, HANDOVER_PUBLIC, IDVS_VERIFY, IDVS_WEBHOOK
from app.core.rate_limit import rate_limit
from app.db.models.enums import (
    ArtifactType,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.db.models.trips import Consignment, Trip, TripStop
from app.db.session import get_db
from app.integrations.idvs import get_idvs_client
from app.orchestration.artifact_service import create_receiver_artifact
from app.orchestration.handover_service import (
    build_scan_url,
    find_open_token,
    hash_presented_token,
    load_handover_confirmation,
    mark_token_opened,
    record_handover_confirmation,
    redeem_capability_token,
    rotate_capability_token,
    session_secret_matches,
)
from app.orchestration.receiver_verification_service import (
    attach_confirmation,
    ingest_webhook_decision,
    load_verification_for_token,
    raise_verification_exception,
    record_consent,
    resolve_verification,
    start_verification,
    verify_webhook_signature,
    webhook_timestamp_is_fresh,
)
from app.schemas.handover import (
    HandoverConfirmRequest,
    HandoverConfirmResponse,
    HandoverConsentRequest,
    HandoverScanResponse,
    HandoverStatusResponse,
    HandoverTokenResponse,
    HandoverVerificationState,
    HandoverVerifyResponse,
)
from app.schemas.people import DriverRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/phases/{phase_event_id}/handover", tags=["handover"])
public_router = APIRouter(prefix="/handover", tags=["handover"])

# One constant so the routes can't drift into distinguishable failure messages (rule 1).
_GENERIC_NOT_FOUND = "This delivery confirmation link is not valid."

HANDOVER_SESSION_COOKIE = "fp_handover_session"  # scoped to the handover path only
_COOKIE_PATH = "/api/v1/handover"

# Shared by _load_confirmation_event and the token endpoint's stop check.
_CONFIRMATION_NOT_FOUND = "Confirmation phase not found."


def _not_found() -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_GENERIC_NOT_FOUND)


# Didit sends three signature variants; this is the raw-body one, correct here because
# `await request.body()` reads bytes before any parser re-encodes them. X-Signature-V2
# signs a canonicalised form we'd have to guess — prefer it once a real delivery is captured.
_DIDIT_SIGNATURE_HEADER = "x-signature"
_DIDIT_TIMESTAMP_HEADER = "x-timestamp"


def _verification_state(v: ReceiverIdentityVerification) -> HandoverVerificationState:
    # Coerced through the enum constructor, not `.value` directly: these columns are
    # mapped_column(String(20)), and a freshly-loaded row hands back a bare str with no
    # .value. EnumClass(x) accepts either a member or its raw string, so this covers both.
    return HandoverVerificationState(
        status=ReceiverVerificationStatus(v.status).value,
        tier=ReceiverVerificationTier(v.tier).value,
        unverified_reason=(
            ReceiverVerificationUnverifiedReason(v.unverified_reason).value
            if v.unverified_reason else None
        ),
        identity_match=v.identity_match,
    )


async def _load_confirmation_event(
    db: AsyncSession, *, trip_id: UUID, phase_event_id: UUID, driver_id: UUID,
) -> PhaseEvent:
    """Resolve a confirmation phase event the given driver actually owns.

    Ownership is checked in the same query, not after it: a driver who doesn't own the
    trip gets the same 404 as a trip that doesn't exist, so no row detail leaks.
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
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=_CONFIRMATION_NOT_FOUND,
        )
    return event


@router.post(
    "/tokens",
    response_model=HandoverTokenResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Issue the next QR in the rotating series",
    dependencies=[Depends(rate_limit(HANDOVER_ISSUE))],
)
async def issue_handover_token_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandoverTokenResponse:
    """Mint the next code. `force=true` is the driver's "show a new code" escape hatch."""
    event = await _load_confirmation_event(
        db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
    )
    # Re-checked (not just relied on from _load_confirmation_event) so mypy can narrow
    # trip_stop_id to a UUID for rotate_capability_token.
    trip_stop_id = event.trip_stop_id
    if trip_stop_id is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=_CONFIRMATION_NOT_FOUND,
        )

    # Refuse to re-open a handover that already happened — else the driver could keep
    # minting live grants to overwrite a confirmation the receiver already gave.
    if await load_handover_confirmation(db, phase_event_id=event.id) is not None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This delivery has already been confirmed by the receiver.",
        )

    try:
        rotation = await rotate_capability_token(
            db,
            phase_event_id=event.id,
            trip_id=trip_id,
            trip_stop_id=trip_stop_id,
            force=force,
        )
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to issue a handover token for phase_event=%s", phase_event_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not issue a handover code.",
        ) from None

    return HandoverTokenResponse(
        # None while paused: the receiver holds a live code, not an error.
        scan_url=build_scan_url(rotation.raw_token) if rotation.raw_token else None,
        expires_at=rotation.token.expires_at,
        rotate_after_seconds=settings.HANDOVER_ROTATION_SECONDS,
        receiver_opened=rotation.paused,
    )


@router.get("", response_model=HandoverStatusResponse, summary="Has the receiver confirmed yet?")
async def handover_status_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandoverStatusResponse:
    event = await _load_confirmation_event(
        db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
    )
    confirmation = await load_handover_confirmation(db, phase_event_id=event.id)

    if confirmation is not None:
        return HandoverStatusResponse(
            confirmed=True,
            confirmed_at=confirmation.confirmed_at,
            receiver_opened=True,
            signature_artifact_id=confirmation.signature_artifact_id,
        )

    open_token = await find_open_token(db, phase_event_id=event.id)
    return HandoverStatusResponse(confirmed=False, receiver_opened=open_token is not None)


async def _live_token(db: AsyncSession, raw_token: str) -> HandoverCapabilityToken:
    """Look a presented token up for the READ path only — never for redemption, which goes
    through redeem_capability_token's conditional UPDATE. Same generic 404 for every reason."""
    token = (
        await db.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.token_hash == hash_presented_token(raw_token)
            )
        )
    ).scalar_one_or_none()

    if token is None or token.redeemed_at is not None:
        raise _not_found()
    if token.expires_at <= datetime.now(UTC):
        raise _not_found()
    return token


@public_router.get(
    "/{raw_token}",
    response_model=HandoverScanResponse,
    summary="What the receiver is about to confirm (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def scan_handover_endpoint(
    raw_token: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> HandoverScanResponse:
    token = await _live_token(db, raw_token)

    # Returns a secret on the FIRST load only; a forwarded URL opened in a second browser
    # gets None, no cookie, and will fail to confirm — but the page still renders.
    session_secret = await mark_token_opened(db, token_id=token.id)

    trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
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

    await db.commit()

    if session_secret is not None:
        response.set_cookie(
            key=HANDOVER_SESSION_COOKIE,
            value=session_secret,
            httponly=True,  # no script on the page can exfiltrate it (XSS)
            samesite="strict",  # confirm POST is same-site from the page we just served
            secure=settings.ENVIRONMENT != "development",  # plain HTTP locally would silently drop it
            path=_COOKIE_PATH,
            # Covers the token's LONGEST possible life: a verification extends the token
            # by IDVS_TOKEN_EXTENSION_MINUTES, and a dead cookie fails the binding check
            # the same way a forged link does.
            max_age=(
                settings.HANDOVER_TOKEN_EXPIRY_MINUTES + settings.IDVS_TOKEN_EXTENSION_MINUTES
            ) * 60,
        )

    return HandoverScanResponse(
        trip_reference=trip.trip_reference,
        destination_name=destination_name or "Destination",
        waybill_references=[w for w in waybills if w],
        expires_at=token.expires_at,
        verification=_verification_state(verification) if verification is not None else None,
    )


@public_router.post(
    "/{raw_token}/confirm",
    response_model=HandoverConfirmResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="The receiver confirms the delivery (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def confirm_handover_endpoint(
    raw_token: str,
    payload: HandoverConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    fp_handover_session: Optional[str] = Cookie(default=None, alias=HANDOVER_SESSION_COOKIE),
) -> HandoverConfirmResponse:
    token = await _live_token(db, raw_token)

    # Both halves, or nothing. Checked BEFORE redemption so a wrong-browser attempt
    # doesn't burn a token the real receiver is still holding.
    if not session_secret_matches(token, fp_handover_session):
        logger.warning(
            "Handover confirm rejected: session secret mismatch for token=%s", token.id,
        )
        raise _not_found()

    # The gate: the single conditional UPDATE deciding whether this delivery gets
    # confirmed, so two simultaneous scans race the database, not each other in Python.
    result = await redeem_capability_token(
        db, trip_id=token.trip_id, trip_stop_id=token.trip_stop_id, raw_token=raw_token,
    )
    if not result.success:
        # Already logged by the service with its true reason. Committed, not rolled
        # back — the attempt row IS the evidence.
        await db.commit()
        raise _not_found()

    trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
    signature_bytes = base64.b64decode(payload.signature_png_base64)

    try:
        artifact = await create_receiver_artifact(
            db,
            trip_id=token.trip_id,
            file_bytes=signature_bytes,
            mime_type="image/png",
            artifact_type=ArtifactType.DOCUMENT,
            captured_at=datetime.now(UTC),  # server clock; receiver's phone clock isn't evidence
            captured_lat=payload.receiver_lat,
            captured_lng=payload.receiver_lng,
        )
        confirmation = await record_handover_confirmation(
            db,
            token=token,
            signature_artifact_id=artifact.id,
            receiver_lat=payload.receiver_lat,
            receiver_lng=payload.receiver_lng,
            receiver_accuracy_m=payload.receiver_accuracy_m,
            # resolve_client_ip, not request.client.host: behind Railway's edge the socket
            # peer is Railway, not the receiver.
            receiver_ip=resolve_client_ip(request),
            receiver_user_agent=request.headers.get("user-agent"),
            # FP-240: a camera scan opens a clean context with no Authorization header.
            bearer_token_present=bool(request.headers.get("authorization")),
        )
        # Separate from confirmation: a receiver may verify and then walk away, which is
        # a real state, not an error.
        await attach_confirmation(
            db, token_id=token.id, handover_confirmation_id=confirmation.id,
        )
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to record a handover confirmation for token=%s", result.token_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not record the confirmation.",
        ) from None

    return HandoverConfirmResponse(
        confirmed_at=confirmation.confirmed_at, trip_reference=trip.trip_reference,
    )


@public_router.post(
    "/{raw_token}/consent",
    response_model=HandoverVerificationState,
    status_code=http_status.HTTP_201_CREATED,
    summary="Record the receiver's consent to an identity check (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def handover_consent_endpoint(
    raw_token: str,
    payload: HandoverConsentRequest,
    db: AsyncSession = Depends(get_db),
) -> HandoverVerificationState:
    """Create the verification row; must precede any vendor session (POPIA s27(1)(a))."""
    token = await _live_token(db, raw_token)

    existing = await load_verification_for_token(db, token_id=token.id)
    if existing is not None:
        # Idempotent: a reload mid-flow must not create a second row.
        return _verification_state(existing)

    verification = await record_consent(db, token=token, consent_text=payload.consent_text)
    if not payload.has_document:
        verification.tier = ReceiverVerificationTier.SELFIE_ONLY
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.NO_DOCUMENT

    try:
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to record handover consent for token")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not record consent.",
        ) from None

    return _verification_state(verification)


@public_router.post(
    "/{raw_token}/verify",
    response_model=HandoverVerifyResponse,
    summary="Start a vendor identity session (public, no auth)",
    dependencies=[Depends(rate_limit(IDVS_VERIFY))],
)
async def handover_verify_endpoint(
    raw_token: str,
    db: AsyncSession = Depends(get_db),
) -> HandoverVerifyResponse:
    """Claim quota, create the session, extend the token, hand back a URL.

    `session_url` is None on every degradation path, not an error — the client proceeds
    to signing at a lower tier so a delivery stays confirmable when the vendor is down.
    """
    token = await _live_token(db, raw_token)
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        raise _not_found()

    session = await start_verification(
        db,
        token=token,
        raw_token=raw_token,  # row stores only a hash; vendor needs the presented token
        verification=verification,
        client=get_idvs_client(),
    )
    await db.commit()

    return HandoverVerifyResponse(
        session_url=session.session_url if session is not None else None,
        tier=ReceiverVerificationTier(verification.tier).value,  # see _verification_state
        unverified_reason=(
            ReceiverVerificationUnverifiedReason(verification.unverified_reason).value
            if verification.unverified_reason else None
        ),
    )


@public_router.post(
    "/{raw_token}/verify/resolve",
    response_model=HandoverVerificationState,
    summary="Fetch the authoritative decision (public, no auth, EMPTY BODY)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def handover_resolve_endpoint(
    raw_token: str,
    receiver_name: str = "",
    receiver_id_number: str = "",
    db: AsyncSession = Depends(get_db),
) -> HandoverVerificationState:
    """The security boundary: takes no session identifier from the caller. The session id
    comes from our own row, written before the redirect — the client can only say "I am
    back", never claim a result directly (the exact failure Didit patched in their own
    WordPress plugin).
    """
    token = await _live_token(db, raw_token)
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        raise _not_found()

    verdict = await resolve_verification(
        db,
        verification=verification,
        client=get_idvs_client(),
        typed_name=receiver_name,
        typed_id_number=receiver_id_number,
    )

    if verdict.exception_type is not None:
        trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
        await raise_verification_exception(
            db, trip=trip, phase_event_id=token.phase_event_id,
            trip_stop_id=token.trip_stop_id, verdict=verdict,
        )

    await db.commit()
    return _verification_state(verification)


@public_router.post(
    "/webhooks/didit",
    status_code=http_status.HTTP_200_OK,
    summary="Vendor decision webhook (public, HMAC-verified)",
    dependencies=[Depends(rate_limit(IDVS_WEBHOOK))],
)
async def handover_webhook_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Signed backstop for decisions the receiver's own return never delivered.

    Returns 200 for everything it accepts, including an unknown session, so the vendor's
    retries don't hammer a session we never created. A bad signature is the one
    exception: 401, logged, nothing written.
    """
    raw_body = await request.body()
    signature = request.headers.get(_DIDIT_SIGNATURE_HEADER)

    if not verify_webhook_signature(raw_body, signature):
        logger.warning("Rejected an IDVS webhook with an invalid or missing signature")
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.",
        )

    # Checked AFTER the signature so an unsigned caller learns nothing about our clock.
    # Stops replay of a genuine, validly-signed but stale delivery (HMAC alone can't).
    # 401, not 200, so a merely-delayed delivery gets retried rather than dropped.
    if not webhook_timestamp_is_fresh(request.headers.get(_DIDIT_TIMESTAMP_HEADER)):
        logger.warning("Rejected an IDVS webhook with a stale or missing timestamp")
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.",
        )

    try:
        payload = json.loads(raw_body)
    except ValueError:
        logger.warning("IDVS webhook body was not valid JSON")
        return {"status": "ignored"}  # 200, not 400: retrying won't help a signed-but-bad body

    await ingest_webhook_decision(db, payload=payload)
    await db.commit()
    return {"status": "ok"}
