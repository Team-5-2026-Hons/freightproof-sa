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


# Headers the vendor signs with. Case-insensitive on the way in, so the spelling here is
# cosmetic. Quarantined beside each other like the _DIDIT_* constants in
# integrations/idvs.py.
#
# Didit sends three signature variants. This is the raw-body one, which is correct for us
# specifically because `await request.body()` below reads the bytes before any parser
# touches them — the documented failure mode for X-Signature is middleware that re-encodes
# the JSON first, and we have none. X-Signature-V2 is the vendor's recommendation and
# signs a canonicalised form instead; adopting it would mean guessing that canonicalisation
# exactly, and replacing a verified assumption with an unverified one is a bad trade. Once
# a real delivery has been captured, prefer V2 and keep this as the fallback.
_DIDIT_SIGNATURE_HEADER = "x-signature"
_DIDIT_TIMESTAMP_HEADER = "x-timestamp"


def _verification_state(v: ReceiverIdentityVerification) -> HandoverVerificationState:
    # Coerced through the enum constructor, not read with `.value` directly: these
    # columns are mapped_column(String(20)) per the enum-comparison trap this feature has
    # already been bitten by once. `v` is only guaranteed to still be the exact Python
    # object a service function set an enum onto when nothing else queried it since — any
    # other load (a second request, a second query in the same request) hands back a
    # bare `str`, which has no `.value` and would 500 this route. EnumClass(x) accepts
    # either an existing member or its raw string value, so this is correct for both.
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

    verification = await load_verification_for_token(db, token_id=token.id)

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
            # Must cover the token's LONGEST possible life, not its nominal one. A
            # verification extends the token by IDVS_TOKEN_EXTENSION_MINUTES, so sizing
            # this to HANDOVER_TOKEN_EXPIRY_MINUTES alone meant a receiver whose document
            # check ran long came back to a live token and a dead cookie — and a dead
            # cookie fails the binding check, which is reported as the same generic 404 as
            # a forged link. The mock vendor returns in seconds and never exposed this;
            # a real document-and-liveness round trip does.
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
        # Link the verification the receiver completed before signing. Separate from the
        # confirmation row because the two happen at different moments and a receiver may
        # verify and then walk away — a verification with no confirmation is a real state,
        # not an error.
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
    """Create the verification row. Must precede any vendor session.

    Consent first, always. POPIA s27(1)(a) is what makes the biometric check lawful at all,
    and a check started before consent was recorded is one we cannot justify afterwards.
    """
    token = await _live_token(db, raw_token)

    existing = await load_verification_for_token(db, token_id=token.id)
    if existing is not None:
        # Idempotent: a receiver who reloads mid-flow must not create a second row, and the
        # unique constraint on token_id would refuse it anyway.
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

    `session_url` is None on every degradation path and that is NOT an error — the client
    proceeds to signing at a lower tier. A delivery must stay confirmable when a vendor is
    down, and this is where that promise is kept.
    """
    token = await _live_token(db, raw_token)
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        # No consent recorded — refuse, identically to every other public failure.
        raise _not_found()

    session = await start_verification(
        db,
        token=token,
        # The row stores only a hash; the vendor has to be told where to send the receiver
        # back to, and that address is built from the presented token.
        raw_token=raw_token,
        verification=verification,
        client=get_idvs_client(),
    )
    await db.commit()

    return HandoverVerifyResponse(
        session_url=session.session_url if session is not None else None,
        # See _verification_state's comment: coerced through the enum, never read via a
        # bare `.value`, because this `verification` came back from a fresh query and its
        # String(20) columns carry no automatic enum coercion.
        tier=ReceiverVerificationTier(verification.tier).value,
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
    """THE security boundary. Takes no session identifier from anyone.

    The client can say "I am back" and nothing else. The session id comes from our own row,
    written before the redirect. This is the exact failure Didit patched in their own
    WordPress plugin, where a browser could post {status: "Approved"} and be believed — and
    our exposure is worse, because this route has no authentication at all by design.

    receiver_name / receiver_id_number are the typed identity to cross-check against the
    document. They are what the receiver already gave us, not a claim about the session.
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

    Returns 200 for everything it accepts, including an unknown session — the vendor
    retries five times on a non-200, and making it retry into a wall for a session we
    never created helps nobody.

    A bad signature is the one exception: 401, logged, nothing written.
    """
    raw_body = await request.body()
    signature = request.headers.get(_DIDIT_SIGNATURE_HEADER)

    if not verify_webhook_signature(raw_body, signature):
        logger.warning("Rejected an IDVS webhook with an invalid or missing signature")
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.",
        )

    # Checked AFTER the signature, deliberately. An unsigned caller learns nothing about
    # our clock this way, and the freshness rule is about replay of GENUINE deliveries —
    # a valid signature on a body captured last week is exactly the attack this stops,
    # and HMAC alone cannot: it proves authorship, never recency.
    #
    # 401 rather than 200 so a delivery merely delayed past the window is retried by the
    # vendor instead of being silently dropped.
    if not webhook_timestamp_is_fresh(request.headers.get(_DIDIT_TIMESTAMP_HEADER)):
        logger.warning("Rejected an IDVS webhook with a stale or missing timestamp")
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.",
        )

    try:
        payload = json.loads(raw_body)
    except ValueError:
        logger.warning("IDVS webhook body was not valid JSON")
        # 200, not 400: the signature was ours, so retrying will not help.
        return {"status": "ignored"}

    await ingest_webhook_decision(db, payload=payload)
    await db.commit()
    return {"status": "ok"}
