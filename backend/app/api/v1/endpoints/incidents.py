"""Incidents — the investigation a dispatcher runs over one or more exceptions. Dispatcher-only.

POST /trips/{trip_id}/incidents          report an incident (optionally stopping the trip)
GET  /trips/{trip_id}/incidents          that trip's incidents
GET  /incidents                          the organisation's incidents, filterable
GET  /incidents/{incident_id}            one incident in full
GET  /incidents/{incident_id}/evidence   the trip evidence the decision rests on
POST /incidents/{incident_id}/updates    append follow-up (note, owner, status, finding, ...)
POST /incidents/{incident_id}/close      close with an outcome and a reason
POST /incidents/{incident_id}/reopen     reopen with a reason
POST /incidents/{incident_id}/stop-trip  stop the incident's trip, decided after reporting
POST /incidents/{incident_id}/documents  attach a document (INCIDENT_DOCUMENTS_ENABLED, else 503)
GET  /incidents/{incident_id}/documents/{artifact_id}/url  a short-lived link to one

Thin by design: each route validates, calls orchestration.incidents, maps domain errors.
"""

import logging
from collections.abc import Awaitable
from typing import Annotated, NoReturn, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import (
    ExceptionAlreadyInIncidentError,
    IncidentDocumentsDisabledError,
    IncidentInvalidError,
    IncidentStateError,
    ResourceNotFoundError,
    TripStateError,
)
from app.core.limits import ARTIFACT_UPLOAD, FLEET_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import IncidentStatus, IncidentType
from app.db.session import get_db
from app.orchestration.incidents.creation import report_incident, stop_trip_from_incident
from app.orchestration.evidence.artifacts import MAX_FILE_SIZE_BYTES
from app.orchestration.incidents.documents import DocumentUpload, attach_document, document_url, require_enabled
from app.orchestration.incidents.evidence import get_incident_evidence
from app.orchestration.incidents.queries import get_incident_detail, list_incidents
from app.orchestration.incidents.updates import append_update, close_incident, reopen_incident
from app.schemas.incidents import (
    IncidentCloseRequest,
    IncidentCreate,
    IncidentDocumentLink,
    IncidentDetail,
    IncidentEvidence,
    IncidentListFilters,
    IncidentRead,
    IncidentReopenRequest,
    IncidentUpdateCreate,
)
from app.schemas.people import UserRead
from app.schemas.text import RequiredFreeText

logger = logging.getLogger(__name__)

trip_incidents_router = APIRouter(prefix="/trips/{trip_id}/incidents", tags=["incidents"])
router = APIRouter(prefix="/incidents", tags=["incidents"])

T = TypeVar("T")


def _raise_http(exc: Exception) -> NoReturn:
    match exc:
        case ResourceNotFoundError():
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        case ExceptionAlreadyInIncidentError():
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail={"message": str(exc), "incident_id": str(exc.incident_id)},
            ) from exc
        case IncidentStateError() | TripStateError():
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        case IncidentInvalidError():
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        case IncidentDocumentsDisabledError():
            raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    raise exc


async def _call(action: str, work: Awaitable[T]) -> T:
    """Run one orchestration call, mapping its domain errors and logging a database failure."""
    try:
        return await work
    except (ResourceNotFoundError, ExceptionAlreadyInIncidentError, IncidentStateError, TripStateError,
            IncidentInvalidError, IncidentDocumentsDisabledError) as exc:
        _raise_http(exc)
    except SQLAlchemyError as exc:
        logger.exception("Database error while trying to %s", action)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again.",
        ) from exc


async def _detail(db: AsyncSession, incident_id: UUID, user: UserRead, warnings: list[str] | None = None) -> IncidentDetail:
    return await _call("read an incident", get_incident_detail(
        db, incident_id=incident_id, organization_id=user.organization_id, warnings=warnings or [],
    ))


@trip_incidents_router.post(
    "", response_model=IncidentDetail, status_code=http_status.HTTP_201_CREATED,
    summary="Report an incident on this trip (optionally stopping it)",
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def report_incident_endpoint(
    trip_id: UUID,
    payload: IncidentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    incident = await _call("report an incident", report_incident(
        db, trip_id=trip_id, organization_id=current_user.organization_id, user_id=current_user.id, request=payload,
    ))
    return await _detail(db, incident.id, current_user)


@trip_incidents_router.get("", response_model=list[IncidentRead], summary="This trip's incidents, newest first")
async def list_trip_incidents_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[IncidentRead]:
    return await _call("list a trip's incidents", list_incidents(
        db, organization_id=current_user.organization_id, filters=IncidentListFilters(trip_id=trip_id),
    ))


@router.get("", response_model=list[IncidentRead], summary="The organisation's incidents, newest first")
async def list_incidents_endpoint(
    status: IncidentStatus | None = Query(default=None),
    incident_type: IncidentType | None = Query(default=None),
    assigned_to: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[IncidentRead]:
    filters = IncidentListFilters(status=status, incident_type=incident_type, assigned_to=assigned_to)
    return await _call("list incidents", list_incidents(
        db, organization_id=current_user.organization_id, filters=filters,
    ))


@router.get("/{incident_id}", response_model=IncidentDetail, summary="One incident in full")
async def get_incident_endpoint(
    incident_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    return await _detail(db, incident_id, current_user)


@router.get(
    "/{incident_id}/evidence", response_model=IncidentEvidence,
    summary="Seals, counts, scans, exceptions and last known position for this incident's trip",
)
async def get_incident_evidence_endpoint(
    incident_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentEvidence:
    return await _call("read incident evidence", get_incident_evidence(
        db, incident_id=incident_id, organization_id=current_user.organization_id,
    ))


@router.post(
    "/{incident_id}/updates", response_model=IncidentDetail, status_code=http_status.HTTP_201_CREATED,
    summary="Append follow-up to an incident", dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def append_incident_update_endpoint(
    incident_id: UUID,
    payload: IncidentUpdateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    await _call("append an incident update", append_update(
        db, incident_id=incident_id, organization_id=current_user.organization_id, user_id=current_user.id,
        request=payload,
    ))
    return await _detail(db, incident_id, current_user)


@router.post(
    "/{incident_id}/close", response_model=IncidentDetail,
    summary="Close an incident with an outcome and a reason", dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def close_incident_endpoint(
    incident_id: UUID,
    payload: IncidentCloseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    _, warnings = await _call("close an incident", close_incident(
        db, incident_id=incident_id, organization_id=current_user.organization_id, user_id=current_user.id,
        request=payload,
    ))
    return await _detail(db, incident_id, current_user, warnings)


@router.post(
    "/{incident_id}/reopen", response_model=IncidentDetail,
    summary="Reopen a closed incident with a reason", dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def reopen_incident_endpoint(
    incident_id: UUID,
    payload: IncidentReopenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    await _call("reopen an incident", reopen_incident(
        db, incident_id=incident_id, organization_id=current_user.organization_id, user_id=current_user.id,
        request=payload,
    ))
    return await _detail(db, incident_id, current_user)


@router.post(
    "/{incident_id}/stop-trip", response_model=IncidentDetail,
    summary="Stop this incident's trip (decided after it was reported)",
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def stop_incident_trip_endpoint(
    incident_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    await _call("stop an incident's trip", stop_trip_from_incident(
        db, incident_id=incident_id, organization_id=current_user.organization_id, user_id=current_user.id,
    ))
    return await _detail(db, incident_id, current_user)


@router.post(
    "/{incident_id}/documents", response_model=IncidentDetail, status_code=http_status.HTTP_201_CREATED,
    summary="Attach a document to an incident (off unless INCIDENT_DOCUMENTS_ENABLED)",
    dependencies=[Depends(rate_limit(ARTIFACT_UPLOAD))],
)
async def attach_incident_document_endpoint(
    incident_id: UUID,
    file: Annotated[UploadFile, File()],
    note: Annotated[RequiredFreeText, Form()],
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDetail:
    # The flag first, before any validation or Storage call. (FastAPI has already received the
    # multipart body by now; the flag stops the file being stored, not being sent.)
    try:
        require_enabled()
    except IncidentDocumentsDisabledError as exc:
        _raise_http(exc)
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )
    document = DocumentUpload(
        file_bytes=await file.read(), declared_mime=file.content_type, file_name=file.filename, note=note,
    )
    await _call("attach an incident document", attach_document(
        db, incident_id=incident_id, organization_id=current_user.organization_id, user_id=current_user.id,
        document=document,
    ))
    return await _detail(db, incident_id, current_user)


@router.get(
    "/{incident_id}/documents/{artifact_id}/url", response_model=IncidentDocumentLink,
    summary="A short-lived link to a document this incident cites",
)
async def incident_document_url_endpoint(
    incident_id: UUID,
    artifact_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> IncidentDocumentLink:
    url = await _call("sign an incident document", document_url(
        db, incident_id=incident_id, organization_id=current_user.organization_id, artifact_id=artifact_id,
    ))
    return IncidentDocumentLink(artifact_id=artifact_id, signed_url=url)
