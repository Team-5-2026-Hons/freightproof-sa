"""Public audit-pack routes — the share link an insurer opens, and the seal check
printed on every PDF. No authentication: the unguessable token in the path is the
credential, and every use of it is logged (orchestration/audit_packs/access.py).

A closed link answers 410 as a normal response rather than by raising: get_db rolls the
transaction back on an exception, which would erase the very "denied" log row that lets
the issuing dispatcher see a leaked link being tried. The same goes for a missing viewer
grant (401) and a wrong code (400): both are logged, so both are returned, not raised.

A pack issued to an email address needs a viewer grant (FP-291): POST /{token}/email-code
emails a one-time code, POST /{token}/email-code/verify exchanges it for a grant, and every
other token route expects that grant in the X-Audit-Pack-Grant header.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import resolve_client_ip
from app.core.exceptions import (
    EmailUnavailableError,
    FileStorageUnavailableError,
    ResourceNotFoundError,
    StoredFileMismatchError,
)
from app.core.limits import AUDIT_PACK_EMAIL_CODE, AUDIT_PACK_PUBLIC, BLOCKCHAIN_VERIFY
from app.core.rate_limit import rate_limit
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import AuditPackAccessEventType
from app.db.session import get_db
from app.orchestration.audit_packs.access import (
    EmailVerificationRequired,
    Requester,
    ShareLinkClosed,
    open_shared_pack,
    request_shared_pack_code,
    seal_by_pack_id,
    shared_artifact,
    shared_incident_sheet,
    shared_pdf,
    shared_view,
    verify_shared_pack,
    verify_shared_pack_code,
)
from app.orchestration.audit_packs.email_codes import EmailCodeNotRequired, EmailCodeRequestTooSoon
from app.reporting.incident_sheet import NoIncidentError
from app.schemas.audit_pack import (
    EmailCodeEntry,
    EmailCodeSent,
    LiveVerification,
    PublicAuditPackView,
    PublicPackSeal,
    ViewerGrant,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public/audit-packs", tags=["audit-packs-public"])

_LINK_NOT_FOUND = "This audit pack link does not exist."
_CLOSED_DETAIL = {
    "revoked": "This audit pack link has been revoked by the operator who issued it.",
    "expired": "This audit pack link has expired. Ask the operator who issued it for a new one.",
}


# The header the portal sends a viewer grant in. A header, not a query parameter: a URL
# is written to access logs, proxy logs and browser history.
GRANT_HEADER = "X-Audit-Pack-Grant"

_CODE_FAILED_DETAIL = {
    "wrong": "That code is not right. Check the email and try again.",
    "expired": "That code has expired or was already used. Ask for a new one.",
    "locked": "Too many wrong codes. Ask for a new one.",
}


def _closed(exc: ShareLinkClosed) -> JSONResponse:
    return JSONResponse(status_code=http_status.HTTP_410_GONE, content={"detail": _CLOSED_DETAIL[exc.reason]})


def _unverified(exc: EmailVerificationRequired) -> JSONResponse:
    # verification_required tells the portal to show the code screen rather than an error.
    return JSONResponse(
        status_code=http_status.HTTP_401_UNAUTHORIZED,
        content={
            "detail": "Enter the code we email you to open this pack.",
            "verification_required": True,
            "email_hint": exc.email_hint,
        },
    )


def _requester(request: Request, grant: str | None = None) -> Requester:
    return Requester(client_ip=resolve_client_ip(request), user_agent=request.headers.get("user-agent"), grant=grant)


async def _open(
    request: Request, db: AsyncSession, token: str, event_type: AuditPackAccessEventType, grant: str | None,
) -> AuditPack:
    return await open_shared_pack(db, raw_token=token, event_type=event_type, requester=_requester(request, grant))


def _grant_header(grant: str | None = Header(default=None, alias=GRANT_HEADER)) -> str | None:
    return grant


@router.get(
    "/seal/{pack_id}",
    response_model=PublicPackSeal,
    summary="Check an issued pack's seal (no evidence shown; the address printed on the PDF)",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def pack_seal_endpoint(pack_id: UUID, db: AsyncSession = Depends(get_db)) -> PublicPackSeal:
    try:
        return await seal_by_pack_id(db, pack_id=pack_id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Audit pack not found.") from exc


@router.get(
    "/{token}",
    response_model=PublicAuditPackView,
    # A pack frozen under manifest v1 must be served as v1: fields it never had (v2 additions)
    # stay absent instead of appearing as defaults the issuer never wrote.
    response_model_exclude_unset=True,
    summary="Open an audit pack from its share link",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def open_pack_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db), grant: str | None = Depends(_grant_header),
) -> PublicAuditPackView | JSONResponse:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.VIEWED, grant)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailVerificationRequired as exc:
        return _unverified(exc)
    return await shared_view(db, pack)


@router.get(
    "/{token}/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="Download the pack's PDF exactly as issued",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def shared_pdf_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db), grant: str | None = Depends(_grant_header),
) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PDF_DOWNLOADED, grant)
        seal = await seal_by_pack_id(db, pack_id=pack.id)
        pdf = await shared_pdf(pack)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailVerificationRequired as exc:
        return _unverified(exc)
    except StoredFileMismatchError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="The stored PDF no longer matches the one issued. Contact the issuing operator.",
        ) from exc
    except FileStorageUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Try again shortly.") from exc
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{seal.pack_label}.pdf"'},
    )


@router.get(
    "/{token}/incident-sheet.pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="The incident fact sheet, rendered from the issued pack's snapshot",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def shared_incident_sheet_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db), grant: str | None = Depends(_grant_header),
) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PDF_DOWNLOADED, grant)
        seal = await seal_by_pack_id(db, pack_id=pack.id)
        pdf = await shared_incident_sheet(pack)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailVerificationRequired as exc:
        return _unverified(exc)
    except NoIncidentError:
        # A normal response, not a raise, so the download log row commits (see module doc).
        return JSONResponse(status_code=http_status.HTTP_409_CONFLICT, content={"detail": "This pack records no critical incident."})
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{seal.pack_label}-incident-sheet.pdf"'},
    )


@router.get(
    "/{token}/artifacts/{artifact_id}",
    response_class=Response,
    summary="One evidence file named in the pack, as stored (the page re-hashes it)",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def shared_artifact_endpoint(
    token: str, artifact_id: UUID, request: Request, db: AsyncSession = Depends(get_db),
    grant: str | None = Depends(_grant_header),
) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PHOTO_VIEWED, grant)
        mime_type, data = await shared_artifact(db, pack, artifact_id=artifact_id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Not found.") from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailVerificationRequired as exc:
        return _unverified(exc)
    except StoredFileMismatchError as exc:
        # An integrity failure, not an outage: "try again" would hide that the stored file
        # changed after it was sealed. Same status as the PDF route's mismatch.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="The stored evidence file no longer matches the one sealed. Contact the issuing operator.",
        ) from exc
    except FileStorageUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Try again shortly.") from exc
    # Evidence bytes must never be interpreted as a page by the browser.
    return Response(
        content=data, media_type=mime_type,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/{token}/verify",
    response_model=LiveVerification,
    summary="Re-check every anchored record against today's database and Hedera",
    # Each run reads the public mirror node once per anchored record.
    dependencies=[Depends(rate_limit(BLOCKCHAIN_VERIFY))],
)
async def verify_pack_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db), grant: str | None = Depends(_grant_header),
) -> LiveVerification | JSONResponse:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.VERIFY_RUN, grant)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailVerificationRequired as exc:
        return _unverified(exc)
    return await verify_shared_pack(db, pack)



@router.post(
    "/{token}/email-code",
    response_model=EmailCodeSent,
    status_code=http_status.HTTP_202_ACCEPTED,
    summary="Email a one-time code to the pack's recipient (needed once per browser)",
    dependencies=[Depends(rate_limit(AUDIT_PACK_EMAIL_CODE))],
)
async def request_email_code_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db),
) -> EmailCodeSent | JSONResponse:
    try:
        email_hint = await request_shared_pack_code(db, raw_token=token, requester=_requester(request))
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EmailCodeNotRequired as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail="This pack opens without a code.",
        ) from exc
    except EmailCodeRequestTooSoon as exc:
        raise HTTPException(
            status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A code was sent a moment ago. Check your inbox, or try again shortly.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except EmailUnavailableError as exc:
        # Logged with the cause; the recipient only needs to know it is temporary.
        logger.error("Audit pack code email could not be sent: %s", exc)
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We couldn't send the code just now. Try again in a few minutes.",
        ) from exc
    return EmailCodeSent(email_hint=email_hint)


@router.post(
    "/{token}/email-code/verify",
    response_model=ViewerGrant,
    summary="Exchange the emailed code for a viewer grant",
    dependencies=[Depends(rate_limit(AUDIT_PACK_EMAIL_CODE))],
)
async def verify_email_code_endpoint(
    token: str, payload: EmailCodeEntry, request: Request, db: AsyncSession = Depends(get_db),
) -> ViewerGrant | JSONResponse:
    try:
        check = await verify_shared_pack_code(db, raw_token=token, code=payload.code, requester=_requester(request))
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    if check.grant is None or check.grant_expires_at is None:
        # Returned, not raised: the attempt count and the denied log row must commit.
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={"detail": _CODE_FAILED_DETAIL[check.outcome], "reason": check.outcome},
        )
    return ViewerGrant(grant=check.grant, expires_at=check.grant_expires_at)
