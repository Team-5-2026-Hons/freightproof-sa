"""Public audit-pack routes — the share link an insurer opens, and the seal check
printed on every PDF. No authentication: the unguessable token in the path is the
credential, and every use of it is logged (orchestration/audit_packs/access.py).

A closed link answers 410 as a normal response rather than by raising: get_db rolls the
transaction back on an exception, which would erase the very "denied" log row that lets
the issuing dispatcher see a leaked link being tried. The same goes for a missing viewer
grant (401) and a wrong code (400): both are logged, so both are returned, not raised.

A pack issued to an email address needs a viewer grant (FP-291): the password was mailed
to that address alongside the link at issue, POST /{token}/password/verify exchanges it
for a grant, and every other token route expects that grant in the X-Audit-Pack-Grant
header.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import resolve_client_ip
from app.core.exceptions import (
    FileStorageUnavailableError,
    ResourceNotFoundError,
    StoredFileMismatchError,
)
from app.core.limits import AUDIT_PACK_PASSWORD_VERIFY, AUDIT_PACK_PUBLIC, BLOCKCHAIN_VERIFY
from app.core.rate_limit import rate_limit
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import AuditPackAccessEventType
from app.db.session import get_db
from app.orchestration.audit_packs.access import (
    EmailVerificationRequired,
    Requester,
    ShareLinkClosed,
    open_shared_pack,
    seal_by_pack_id,
    shared_artifact,
    shared_incident_sheet,
    shared_pdf,
    shared_view,
    verify_shared_pack,
    verify_shared_pack_password,
)
from app.reporting.incident_sheet import NoIncidentError
from app.schemas.audit_pack import (
    LiveVerification,
    PasswordEntry,
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


GRANT_HEADER = "X-Audit-Pack-Grant"

_PASSWORD_FAILED_DETAIL = {
    "wrong": "That password is not right. Check the email and try again.",
    "locked": "Too many wrong attempts. Try again in a few minutes.",
}


def _closed(exc: ShareLinkClosed) -> JSONResponse:
    return JSONResponse(status_code=http_status.HTTP_410_GONE, content={"detail": _CLOSED_DETAIL[exc.reason]})


def _unverified(exc: EmailVerificationRequired) -> JSONResponse:
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
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="The stored evidence file no longer matches the one sealed. Contact the issuing operator.",
        ) from exc
    except FileStorageUnavailableError as exc:
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Try again shortly.") from exc
    return Response(
        content=data, media_type=mime_type,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/{token}/verify",
    response_model=LiveVerification,
    summary="Re-check every anchored record against today's database and Hedera",
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
    "/{token}/password/verify",
    response_model=ViewerGrant,
    summary="Exchange the password mailed at issue for a viewer grant",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PASSWORD_VERIFY))],
)
async def verify_password_endpoint(
    token: str, payload: PasswordEntry, request: Request, db: AsyncSession = Depends(get_db),
) -> ViewerGrant | JSONResponse:
    try:
        check = await verify_shared_pack_password(
            db, raw_token=token, password=payload.password, requester=_requester(request),
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    if check.grant is None or check.grant_expires_at is None:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={"detail": _PASSWORD_FAILED_DETAIL[check.outcome], "reason": check.outcome},
        )
    return ViewerGrant(grant=check.grant, expires_at=check.grant_expires_at)
