"""Evidence artifact endpoints: driver PWA upload, plus dispatcher trip-scoped listing."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.core.limits import ARTIFACT_UPLOAD
from app.core.rate_limit import rate_limit
from app.db.models.enums import ArtifactType
from app.db.session import get_db
from app.orchestration.artifact_service import (
    MAX_FILE_SIZE_BYTES,
    create_artifact,
    list_artifacts_for_trip,
)
from app.schemas.evidence import EvidenceArtifactRead, EvidenceArtifactWithUrl
from app.schemas.people import DriverRead, UserRead

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


# Each accepted upload is up to MAX_FILE_SIZE_BYTES written to Supabase Storage on our
# bill, and the driver holding the token chose the file. Budgeted for a phase's worth of
# evidence plus an offline-queue flush, not for a loop.
@router.post("", response_model=EvidenceArtifactRead, status_code=http_status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit(ARTIFACT_UPLOAD))])
async def upload_artifact_endpoint(
    trip_id: Annotated[UUID, Form()],
    artifact_type: Annotated[ArtifactType, Form()],
    captured_at: Annotated[datetime, Form()],
    file: Annotated[UploadFile, File()],
    captured_lat: Annotated[Decimal | None, Form()] = None,
    captured_lng: Annotated[Decimal | None, Form()] = None,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> EvidenceArtifactRead:
    # Reject on the declared size FIRST, before reading the body. UploadFile spools past
    # a threshold, so a large upload is written to the container's disk on its way to
    # being measured and then discarded — checking the header lets an oversized request
    # be refused without ever materialising it. The post-read check below stays, because
    # the header is client-supplied and can lie about a body that is genuinely too big.
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )

    try:
        return await create_artifact(
            db,
            trip_id=trip_id,
            file_bytes=file_bytes,
            mime_type=file.content_type or "application/octet-stream",
            artifact_type=artifact_type,
            captured_at=captured_at,
            captured_by_driver_id=current_driver.id,
            captured_lat=captured_lat,
            captured_lng=captured_lng,
        )
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


# Trip-scoped read router. Separate from the /artifacts upload router because the prefix
# differs and the auth differs — upload is driver-only, listing is dispatcher-only.
# Follows the pattern manifest.py sets for trip-scoped routes.
trip_artifacts_router = APIRouter(prefix="/trips/{trip_id}/artifacts", tags=["artifacts"])


@trip_artifacts_router.get("", response_model=list[EvidenceArtifactWithUrl])
async def list_trip_artifacts_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_dispatcher: UserRead = Depends(get_current_dispatcher),
) -> list[EvidenceArtifactWithUrl]:
    try:
        return await list_artifacts_for_trip(
            db, trip_id, operator_organization_id=current_dispatcher.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
