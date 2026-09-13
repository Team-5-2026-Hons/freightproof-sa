"""Receiver QR handover routes (FP-155).

Two routers with deliberately different auth postures, in one module because they are two
halves of one exchange and splitting them would hide that:

  * `router`        — driver-authenticated. Issues the rotating QR and reports whether the
                      receiver has confirmed yet.
  * `public_router` — NO authentication at all. The capability token in the path IS the
                      authorisation, which is the entire design (db/models/handover.py):
                      the secret moves optically, in person, and a receiver has no account
                      to sign in to.

The public half is the only unauthenticated write-capable surface in this API. Four rules
govern it, and none are negotiable:

  1. Every failure looks the same. A wrong, expired, retired, already-redeemed or
     wrong-browser token all produce one 404 with one detail string. The true reason is
     written to handover_token_attempts and read by nobody over HTTP.
  2. It reads back almost nothing — see HandoverScanResponse's docstring.
  3. It is rate-limited per IP, because a receiver has no token to count against.
  4. Confirming needs BOTH halves of the credential: the token from the URL and the
     HttpOnly cookie minted when that URL was first opened. The URL alone is a bearer
     credential and a screenshot of it is as good as the original; the cookie is what a
     receiver cannot forward.
"""

import base64
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
from app.core.config import settings
from app.core.limits import HANDOVER_ISSUE, HANDOVER_PUBLIC
from app.core.rate_limit import rate_limit
from app.db.models.enums import ArtifactType, PhaseType
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Trip, TripStop
from app.db.session import get_db
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
from app.schemas.handover import (
    HandoverConfirmRequest,
    HandoverConfirmResponse,
    HandoverScanResponse,
    HandoverStatusResponse,
    HandoverTokenResponse,
)
from app.schemas.people import DriverRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/phases/{phase_event_id}/handover", tags=["handover"])
public_router = APIRouter(prefix="/handover", tags=["handover"])

# The single response every public failure produces. One constant, referenced everywhere,
# so the routes cannot drift into distinguishable messages — which would hand a guesser
# exactly the oracle rule 1 above exists to deny them.
_GENERIC_NOT_FOUND = "This delivery confirmation link is not valid."

# Name of the browser-binding cookie. Scoped to the handover path so it is never sent on
# any other request, and never reaches the dispatcher or the driver API.
HANDOVER_SESSION_COOKIE = "fp_handover_session"
_COOKIE_PATH = "/api/v1/handover"

# The driver-facing refusal for a confirmation phase that can't be handed over. Shared by
# _load_confirmation_event and the token endpoint's stop check so the two can't drift apart.
_CONFIRMATION_NOT_FOUND = "Confirmation phase not found."


def _not_found() -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_GENERIC_NOT_FOUND)


async def _load_confirmation_event(
    db: AsyncSession, *, trip_id: UUID, phase_event_id: UUID, driver_id: UUID,
) -> PhaseEvent:
    """Resolve a confirmation phase event the given driver actually owns.

    Ownership is checked in the same query, not after it, and a driver who does not own
    the trip gets the same 404 as a trip that does not exist. This mirrors the fix
    recorded as NEW-12 in the Stage 3 phase-refactor plan: complete_phase used to check
    the phase type before the driver, so a foreign trip_id plus a deliberately wrong phase
    type leaked the row's real type in the error body. Same threat model here — a trip id
    read off dispatch chatter — and the same answer.
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
    """Mint the next code. `force=true` is the driver's "show a new code" escape hatch —
    see rotate_capability_token's docstring for the stranding case it exists for.
    """
    event = await _load_confirmation_event(
        db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
    )
    # _load_confirmation_event already refuses a confirmation with no stop, but the type
    # checker can't see that through the call. Checking again narrows trip_stop_id to a
    # UUID for rotate_capability_token, and keeps this call safe if that guard ever moves.
    trip_stop_id = event.trip_stop_id
    if trip_stop_id is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=_CONFIRMATION_NOT_FOUND,
        )

    # Refuse to re-open a handover that already happened. Without this the driver could
    # keep minting tokens against a confirmed delivery, and every one would be a live
    # grant to overwrite a confirmation the receiver has already given.
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
        # None while paused: the receiver holds a live code and issuing another would
        # retire it. Not an error — the driver's step reads this as "they have it open".
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
    """Look a presented token up for the READ path only — never for redemption.

    Redemption goes through redeem_capability_token, whose conditional UPDATE is the only
    thing allowed to decide that a token is spendable. This helper exists so the scan page
    can render, and it raises the same generic 404 for every reason a token might not be
    showable, so the two public routes are equally unhelpful to a guesser.
    """
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

    # The claim. Returns a secret on the FIRST load only — a forwarded URL opened in a
    # second browser gets None here, receives no cookie, and will fail to confirm. The
    # page still renders for them, deliberately: refusing to render would tell the holder
    # of a forwarded link exactly what went wrong.
    session_secret = await mark_token_opened(db, token_id=token.id)

    trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
    # Explicit join, not a relationship load: TripStop has no `precinct` relationship —
    # only the FK column — and the destination NAME is the one thing the receiver needs to
    # recognise where they are standing.
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

    await db.commit()

    if session_secret is not None:
        response.set_cookie(
            key=HANDOVER_SESSION_COOKIE,
            value=session_secret,
            # HttpOnly: no script on the page can read it, so an XSS in the receiver app
            # cannot exfiltrate the half of the credential that is supposed to stay put.
            httponly=True,
            # Strict: the confirm POST is same-site from the page we just served, and
            # nothing else should ever carry this cookie.
            samesite="strict",
            # Secure everywhere except local development over plain HTTP, where setting it
            # would mean the cookie is silently never stored and every handover fails with
            # no visible cause.
            secure=settings.ENVIRONMENT != "development",
            path=_COOKIE_PATH,
            max_age=settings.HANDOVER_TOKEN_EXPIRY_MINUTES * 60,
        )

    return HandoverScanResponse(
        trip_reference=trip.trip_reference,
        destination_name=destination_name or "Destination",
        waybill_references=[w for w in waybills if w],
        expires_at=token.expires_at,
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

    # Both halves, or nothing. Checked BEFORE redemption so a wrong-browser attempt does
    # not burn a token the real receiver is still holding — a forwarded link must fail
    # without also destroying the legitimate handover it was copied from.
    if not session_secret_matches(token, fp_handover_session):
        logger.warning(
            "Handover confirm rejected: session secret mismatch for token=%s", token.id,
        )
        raise _not_found()

    # The gate. Everything above was a read; this is the single conditional UPDATE that
    # decides whether this delivery gets confirmed, and two simultaneous scans race the
    # database here rather than racing each other in Python.
    result = await redeem_capability_token(
        db, trip_id=token.trip_id, trip_stop_id=token.trip_stop_id, raw_token=raw_token,
    )
    if not result.success:
        # The attempt has already been logged by the service with its true reason. The
        # caller gets the same 404 as every other failure. Committed, not rolled back —
        # the attempt row IS the evidence and must survive the refusal.
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
            # Server clock. The receiver's phone clock is not evidence of anything.
            captured_at=datetime.now(UTC),
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
            receiver_ip=request.client.host if request.client else None,
            receiver_user_agent=request.headers.get("user-agent"),
            # FP-240. A camera scan opens a clean browser context with no Authorization
            # header; anything that HAS one was already holding a session of ours.
            bearer_token_present=bool(request.headers.get("authorization")),
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
