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
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.handover_responses import _verification_state
from app.auth.dependencies import get_current_driver
from app.core.client_ip import resolve_client_ip
from app.core.config import settings
from app.api.v1.custody_errors import custody_http_exception
from app.core.exceptions import (
    CustodyAccessError,
    HandoverAlreadyConfirmedError,
    HandoverLinkInvalidError,
    ResourceNotFoundError,
)
from app.core.limits import HANDOVER_ISSUE, HANDOVER_PUBLIC, IDVS_VERIFY, IDVS_WEBHOOK
from app.core.rate_limit import rate_limit
from app.db.cleanup import rollback_after_error
from app.db.errors import DatabaseUnavailableError
from app.db.models.enums import (
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.db.models.handover import HandoverCapabilityToken
from app.db.session import get_db
from app.orchestration.handover.capability import build_scan_url, session_secret_matches
from app.orchestration.handover.receiver_verification import (
    ingest_webhook_decision,
    verify_webhook_signature,
    webhook_timestamp_is_fresh,
)
from app.orchestration.handover.service import (
    ReceiverSubmission,
    begin_verification,
    ensure_handover_open,
    load_confirmation_target,
    load_confirmation_target_for_write,
    load_handover_progress,
    load_live_token,
    load_scan_page,
    load_trip_for_token,
    record_receiver_confirmation,
    redeem_token,
    resolve_receiver_verification,
    rotate_next_token,
    submit_consent,
)
from app.schemas.handover import (
    IssueTokenQuery,
    HandoverConfirmRequest,
    HandoverConfirmResponse,
    HandoverConsentRequest,
    HandoverResolveRequest,
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


@contextmanager
def _confirmation_errors() -> Iterator[None]:
    """A confirmation lookup's failures as HTTP: 404 for a missing event or a trip the driver
    never held (one answer, so existence is not disclosed), the coded 409 for a driver who held
    it earlier."""
    try:
        yield
    except ResourceNotFoundError:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=_CONFIRMATION_NOT_FOUND,
        ) from None
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc


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
    query: Annotated[IssueTokenQuery, Query()],
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandoverTokenResponse:
    """Mint the next code. `force=true` is the driver's "show a new code" escape hatch.

    A former driver cannot mint a new receiver link: only whoever holds the trip now can."""
    with _confirmation_errors():
        target = await load_confirmation_target_for_write(
            db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
            custody_sequence=query.custody_sequence,
        )

    try:
        await ensure_handover_open(db, target=target)
    except HandoverAlreadyConfirmedError:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail="This delivery has already been confirmed by the receiver.",
        ) from None

    try:
        rotation = await rotate_next_token(db, target=target, force=query.force)
        await db.commit()
    except DatabaseUnavailableError:
        raise  # get_db cleans up; the shared handler returns 503.
    except SQLAlchemyError:
        await rollback_after_error(db)
        logger.exception("Failed to issue a handover token for phase_event=%s", phase_event_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not issue a handover code.",
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
    with _confirmation_errors():
        target = await load_confirmation_target(
            db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
        )
    progress = await load_handover_progress(db, target=target)

    if progress.confirmation is not None:
        return HandoverStatusResponse(
            confirmed=True,
            confirmed_at=progress.confirmation.confirmed_at,
            receiver_opened=True,
            signature_artifact_id=progress.confirmation.signature_artifact_id,
        )

    return HandoverStatusResponse(confirmed=False, receiver_opened=progress.receiver_opened)


async def _live_token(db: AsyncSession, raw_token: str) -> HandoverCapabilityToken:
    """Look a presented token up for the READ path only; the same generic 404 for every reason."""
    try:
        return await load_live_token(db, raw_token)
    except HandoverLinkInvalidError:
        raise _not_found() from None


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
    try:
        page = await load_scan_page(db, raw_token=raw_token)
    except HandoverLinkInvalidError:
        raise _not_found() from None

    await db.commit()

    if page.session_secret is not None:
        response.set_cookie(
            key=HANDOVER_SESSION_COOKIE,
            value=page.session_secret,
            httponly=True,  # no script on the page can exfiltrate it (XSS)
            samesite="strict",  # confirm POST is same-site from the page we just served
            secure=settings.ENVIRONMENT != "development",  # plain HTTP locally would silently drop it
            path=_COOKIE_PATH,
            # Cover the verification extension too: an expired cookie fails the binding check.
            max_age=(
                settings.HANDOVER_TOKEN_EXPIRY_MINUTES + settings.IDVS_TOKEN_EXTENSION_MINUTES
            ) * 60,
        )

    return HandoverScanResponse(
        trip_reference=page.trip_reference,
        destination_name=page.destination_name or "Destination",
        waybill_references=[w for w in page.waybill_references if w],
        expires_at=page.token.expires_at,
        verification=(
            _verification_state(page.verification) if page.verification is not None else None
        ),
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

    # Check both halves before redemption so a wrong browser cannot burn the receiver's token.
    if not session_secret_matches(token, fp_handover_session):
        logger.warning(
            "Handover confirm rejected: session secret mismatch for token=%s", token.id,
        )
        raise _not_found()

    try:
        result = await redeem_token(db, token=token, raw_token=raw_token)
    except HandoverLinkInvalidError:
        # The service logged the reason; commit the attempt row because it IS evidence.
        await db.commit()
        raise _not_found() from None

    trip = await load_trip_for_token(db, token=token)
    signature_bytes = base64.b64decode(payload.signature_png_base64)

    try:
        confirmation = await record_receiver_confirmation(
            db,
            token=token,
            submission=ReceiverSubmission(
                signature_bytes=signature_bytes,
                receiver_lat=payload.receiver_lat,
                receiver_lng=payload.receiver_lng,
                receiver_accuracy_m=payload.receiver_accuracy_m,
                # resolve_client_ip, not request.client.host: behind Railway's edge the socket
                # peer is Railway, not the receiver.
                receiver_ip=resolve_client_ip(request),
                receiver_user_agent=request.headers.get("user-agent"),
                # FP-240: a camera scan opens a clean context with no Authorization header.
                bearer_token_present=bool(request.headers.get("authorization")),
            ),
        )
        await db.commit()
    except DatabaseUnavailableError:
        raise  # get_db cleans up; the shared handler returns 503.
    except SQLAlchemyError:
        await rollback_after_error(db)
        logger.exception("Failed to record a handover confirmation for token=%s", result.token_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not record the confirmation.",
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

    outcome = await submit_consent(
        db, token=token, consent_text=payload.consent_text,
        consented=payload.consented, has_document=payload.has_document,
    )
    if not outcome.created:
        # Idempotent: a reload mid-flow must not create a second row.
        return _verification_state(outcome.verification)

    try:
        await db.commit()
    except DatabaseUnavailableError:
        raise  # get_db cleans up; the shared handler returns 503.
    except SQLAlchemyError:
        await rollback_after_error(db)
        logger.exception("Failed to record handover consent for token")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not record consent.",
        ) from None

    return _verification_state(outcome.verification)


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
    try:
        started = await begin_verification(db, token=token, raw_token=raw_token)
    except HandoverLinkInvalidError:
        raise _not_found() from None
    verification = started.verification
    await db.commit()

    return HandoverVerifyResponse(
        session_url=started.session_url,
        tier=ReceiverVerificationTier(verification.tier).value,  # see _verification_state
        unverified_reason=(
            ReceiverVerificationUnverifiedReason(verification.unverified_reason).value
            if verification.unverified_reason else None
        ),
    )


@public_router.post(
    "/{raw_token}/verify/resolve",
    response_model=HandoverVerificationState,
    summary="Fetch the authoritative decision (public, no auth, no session id accepted)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def handover_resolve_endpoint(
    raw_token: str,
    payload: HandoverResolveRequest,
    db: AsyncSession = Depends(get_db),
) -> HandoverVerificationState:
    """The security boundary: takes no session identifier from the caller. The session id
    comes from our own row, written before the redirect — the client can only say "I am
    back", never claim a result directly (the exact failure Didit patched in their own
    WordPress plugin). The body holds only the typed name and ID number, never the URL.
    """
    token = await _live_token(db, raw_token)
    try:
        verification = await resolve_receiver_verification(
            db,
            token=token,
            typed_name=payload.receiver_name,
            typed_id_number=payload.receiver_id_number,
        )
    except HandoverLinkInvalidError:
        raise _not_found() from None

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
