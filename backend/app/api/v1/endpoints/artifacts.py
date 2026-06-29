"""Evidence artifact upload — called by driver PWA before submitting a handshake step."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import ArtifactType
from app.db.session import get_db
from app.orchestration.artifact_service import MAX_FILE_SIZE_BYTES, create_artifact
from app.schemas.evidence import EvidenceArtifactRead
from app.schemas.people import DriverRead

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
