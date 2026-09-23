"""Public audit-pack routes — the share link an insurer opens, and the seal check
printed on every PDF. No authentication: the unguessable token in the path is the
credential, and every use of it is logged (orchestration/audit_pack_access.py).

A closed link answers 410 as a normal response rather than by raising: get_db rolls the
transaction back on an exception, which would erase the very "denied" log row that lets
the issuing dispatcher see a leaked link being tried.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import resolve_client_ip
from app.core.exceptions import ResourceNotFoundError
from app.core.limits import AUDIT_PACK_PUBLIC, BLOCKCHAIN_VERIFY
from app.core.rate_limit import rate_limit
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import AuditPackAccessEventType
from app.db.session import get_db
from app.orchestration.audit_pack_access import (
    ShareLinkClosed,
    open_shared_pack,
    seal_by_pack_id,
    shared_artifact,
    shared_incident_sheet,
    shared_pdf,
    shared_view,
    verify_shared_pack,
)
from app.reporting.incident_sheet import NoIncidentError
from app.schemas.audit_pack import LiveVerification, PublicAuditPackView, PublicPackSeal
from app.storage.supabase_storage import EvidenceObjectIntegrityError, EvidenceStorageUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public/audit-packs", tags=["audit-packs-public"])

_LINK_NOT_FOUND = "This audit pack link does not exist."
_CLOSED_DETAIL = {
    "revoked": "This audit pack link has been revoked by the operator who issued it.",
    "expired": "This audit pack link has expired. Ask the operator who issued it for a new one.",
}


def _closed(exc: ShareLinkClosed) -> JSONResponse:
    return JSONResponse(status_code=http_status.HTTP_410_GONE, content={"detail": _CLOSED_DETAIL[exc.reason]})


async def _open(
    request: Request, db: AsyncSession, token: str, event_type: AuditPackAccessEventType,
) -> AuditPack:
    return await open_shared_pack(
        db, raw_token=token, event_type=event_type, client_ip=resolve_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


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
    summary="Open an audit pack from its share link",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def open_pack_endpoint(
    token: str, request: Request, db: AsyncSession = Depends(get_db),
) -> PublicAuditPackView | JSONResponse:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.VIEWED)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    return await shared_view(db, pack)


@router.get(
    "/{token}/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="Download the pack's PDF exactly as issued",
    dependencies=[Depends(rate_limit(AUDIT_PACK_PUBLIC))],
)
async def shared_pdf_endpoint(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PDF_DOWNLOADED)
        seal = await seal_by_pack_id(db, pack_id=pack.id)
        pdf = await shared_pdf(pack)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except EvidenceObjectIntegrityError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="The stored PDF no longer matches the one issued. Contact the issuing operator.",
        ) from exc
    except EvidenceStorageUnavailableError as exc:
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
async def shared_incident_sheet_endpoint(token: str, request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PDF_DOWNLOADED)
        seal = await seal_by_pack_id(db, pack_id=pack.id)
        pdf = await shared_incident_sheet(pack)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
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
) -> Response:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.PHOTO_VIEWED)
        mime_type, data = await shared_artifact(db, pack, artifact_id=artifact_id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Not found.") from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    except (EvidenceStorageUnavailableError, EvidenceObjectIntegrityError) as exc:
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
    token: str, request: Request, db: AsyncSession = Depends(get_db),
) -> LiveVerification | JSONResponse:
    try:
        pack = await _open(request, db, token, AuditPackAccessEventType.VERIFY_RUN)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_LINK_NOT_FOUND) from exc
    except ShareLinkClosed as exc:
        return _closed(exc)
    return await verify_shared_pack(db, pack)

