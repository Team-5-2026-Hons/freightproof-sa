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


@router.post("", response_model=EvidenceArtifactRead, status_code=http_status.HTTP_201_CREATED)
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
