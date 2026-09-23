"""Dispatcher-side Audit Pack routes — the insurer-facing evidence export.

Admin-only: a pack can carry a driver's full identity number and the trip's location
trail, and deciding who receives those is an operator-level call, not a desk one.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
from app.core.exceptions import ResourceNotFoundError
from app.core.limits import AUDIT_PACK_BUILD, FLEET_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import enum_text
from app.db.session import get_db
from app.orchestration.audit_pack_builder import build_audit_manifest
from app.orchestration.incident_declaration_service import list_declarations, record_declaration
from app.orchestration.audit_pack_service import (
    download_issued_pdf,
    get_audit_pack,
    issue_audit_pack,
    list_access_events,
    list_audit_packs,
    read_audit_packs,
    render_preview_pdf,
    render_trip_incident_sheet,
    revoke_audit_pack,
    share_url,
    verify_url,
)
from app.schemas.audit_pack import (
    AuditPackAccessEventRead,
    AuditPackCreate,
    AuditPackIssued,
    AuditPackManifest,
    AuditPackOptions,
    AuditPackRead,
    IncidentDeclarationCreate,
    IncidentDeclarationRecord,
)
from app.reporting.incident_sheet import NoIncidentError
from app.schemas.people import UserRead
from app.storage.supabase_storage import EvidenceObjectIntegrityError, EvidenceStorageUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/audit-trail", tags=["audit-packs"])
trip_packs_router = APIRouter(prefix="/trips/{trip_id}/audit-packs", tags=["audit-packs"])
packs_router = APIRouter(prefix="/audit-packs", tags=["audit-packs"])
declarations_router = APIRouter(prefix="/trips/{trip_id}/incident-declarations", tags=["audit-packs"])

_UNEXPECTED = "An unexpected error occurred. Please try again."


def _not_found(exc: ResourceNotFoundError) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc))


def _pdf_response(pdf: bytes, filename: str) -> Response:
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _options(
    scope_consignment_id: UUID | None = Query(default=None),
    include_location_trail: bool = Query(default=True),
    include_full_driver_id: bool = Query(default=False),
) -> AuditPackOptions:
    return AuditPackOptions(
        scope_consignment_id=scope_consignment_id,
        include_location_trail=include_location_trail,
        include_full_driver_id=include_full_driver_id,
    )


@router.get(
    "/preview",
    response_model=AuditPackManifest,
    summary="Preview the audit pack manifest for a trip (nothing is stored or anchored)",
    dependencies=[Depends(rate_limit(AUDIT_PACK_BUILD))],
)
async def preview_audit_trail(
    trip_id: UUID,
    options: AuditPackOptions = Depends(_options),
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> AuditPackManifest:
    try:
        return await build_audit_manifest(
            db, trip_id=trip_id, operator_organization_id=current_user.organization_id, options=options,
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error building audit trail preview for trip_id=%s", trip_id)
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_UNEXPECTED) from exc


@router.get(
    "/preview.pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="Preview the audit pack as a PDF (watermarked PREVIEW; nothing is stored or anchored)",
    dependencies=[Depends(rate_limit(AUDIT_PACK_BUILD))],
)
async def preview_audit_trail_pdf(
    trip_id: UUID,
    options: AuditPackOptions = Depends(_options),
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> Response:
    try:
        manifest, pdf = await render_preview_pdf(
            db, trip_id=trip_id, operator_organization_id=current_user.organization_id, options=options,
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error rendering audit trail PDF for trip_id=%s", trip_id)
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_UNEXPECTED) from exc
    return _pdf_response(pdf, f"{manifest.trip.trip_reference}-audit-preview.pdf")


@router.get(
    "/incident-sheet.pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="Incident fact sheet (1–2 pages) for SAPS, the tracking company or a TAPA report",
    dependencies=[Depends(rate_limit(AUDIT_PACK_BUILD))],
)
async def incident_sheet_pdf(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> Response:
    try:
        manifest, pdf = await render_trip_incident_sheet(
            db, trip_id=trip_id, operator_organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    except NoIncidentError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _pdf_response(pdf, f"{manifest.trip.trip_reference}-incident-sheet.pdf")


@trip_packs_router.post(
    "",
    response_model=AuditPackIssued,
    status_code=http_status.HTTP_201_CREATED,
    summary="Issue an audit pack: snapshot, render, store and seal it, and mint its share link",
    dependencies=[Depends(rate_limit(AUDIT_PACK_BUILD))],
)
async def issue_audit_pack_endpoint(
    trip_id: UUID,
    payload: AuditPackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> AuditPackIssued:
    try:
        issued = await issue_audit_pack(
            db, trip_id=trip_id, organization_id=current_user.organization_id, issued_by=current_user,
            request=payload,
        )
        [read] = await read_audit_packs(db, [issued.pack])
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    except EvidenceStorageUnavailableError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The pack could not be stored, so nothing was issued. Please try again.",
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error issuing audit pack for trip_id=%s", trip_id)
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_UNEXPECTED) from exc
    return AuditPackIssued(
        pack=read, share_token=issued.raw_token, share_url=share_url(issued.raw_token),
        verify_url=verify_url(issued.pack.id),
    )


@trip_packs_router.get("", response_model=list[AuditPackRead], summary="List a trip's issued audit packs")
async def list_audit_packs_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> list[AuditPackRead]:
    return await list_audit_packs(db, trip_id=trip_id, organization_id=current_user.organization_id)


@packs_router.post(
    "/{pack_id}/revoke",
    response_model=AuditPackRead,
    summary="Revoke an audit pack's share link (the pack itself is kept as a record)",
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def revoke_audit_pack_endpoint(
    pack_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> AuditPackRead:
    try:
        pack = await revoke_audit_pack(
            db, pack_id=pack_id, organization_id=current_user.organization_id, user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    [read] = await read_audit_packs(db, [pack])
    return read


@packs_router.get("/{pack_id}", response_model=AuditPackRead, summary="One issued audit pack")
async def get_audit_pack_endpoint(
    pack_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> AuditPackRead:
    try:
        pack = await get_audit_pack(db, pack_id=pack_id, organization_id=current_user.organization_id)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    [read] = await read_audit_packs(db, [pack])
    return read


@packs_router.get(
    "/{pack_id}/access-events",
    response_model=list[AuditPackAccessEventRead],
    summary="Every use of an audit pack's share link, newest first",
)
async def list_access_events_endpoint(
    pack_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> list[AuditPackAccessEventRead]:
    try:
        events = await list_access_events(db, pack_id=pack_id, organization_id=current_user.organization_id)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    return [
        AuditPackAccessEventRead(
            event_type=enum_text(e.event_type),
            client_ip=e.client_ip, user_agent=e.user_agent, created_at=e.created_at,
        )
        for e in events
    ]


@packs_router.get(
    "/{pack_id}/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
    summary="Download an issued pack's PDF exactly as issued",
)
async def download_issued_pdf_endpoint(
    pack_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> Response:
    try:
        label, pdf = await download_issued_pdf(db, pack_id=pack_id, organization_id=current_user.organization_id)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    except EvidenceObjectIntegrityError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="The stored PDF no longer matches the one issued. Re-issue the pack.",
        ) from exc
    except EvidenceStorageUnavailableError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage is unavailable. Try again.",
        ) from exc
    return _pdf_response(pdf, f"{label}.pdf")


# Any dispatcher, not only admins: whoever took the SAPS case number on the phone should
# be able to record it, and nothing here is shared outside the operator until a pack is
# issued (which stays admin-only).
@declarations_router.post(
    "",
    response_model=IncidentDeclarationRecord,
    status_code=http_status.HTTP_201_CREATED,
    summary="Declare police-report and notification facts for a trip's incident",
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def record_declaration_endpoint(
    trip_id: UUID,
    payload: IncidentDeclarationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDeclarationRecord:
    try:
        row = await record_declaration(
            db, trip_id=trip_id, organization_id=current_user.organization_id, user_id=current_user.id,
            request=payload,
        )
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
    declared = await list_declarations(db, trip_id=trip_id, organization_id=current_user.organization_id)
    return next(d for d in declared if d.declaration_id == row.id)


@declarations_router.get(
    "", response_model=list[IncidentDeclarationRecord], summary="A trip's incident declarations, oldest first",
)
async def list_declarations_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[IncidentDeclarationRecord]:
    try:
        return await list_declarations(db, trip_id=trip_id, organization_id=current_user.organization_id)
    except ResourceNotFoundError as exc:
        raise _not_found(exc) from exc
