"""GET /trips/{trip_id}/manifest — role-aware. See manifest_service docstring."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi import status as http_status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _bearer, get_current_dispatcher, get_current_driver
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.manifest_service import get_linehaul_for_driver, get_manifest_for_dispatcher
from app.schemas.trips import LinehaulResponse, ManifestResponse

router = APIRouter(prefix="/trips/{trip_id}/manifest", tags=["trips"])


@router.get("", response_model=ManifestResponse | LinehaulResponse)
async def get_manifest_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)] = None,
) -> ManifestResponse | LinehaulResponse:
    """Auth is 'Dispatcher JWT OR Driver JWT' — tried explicitly in that order
    rather than via two stacked Depends(), since FastAPI dependencies can't
    express "either of these two auth schemes" declaratively."""
    try:
        dispatcher = await get_current_dispatcher(credentials, db)
    except HTTPException:
        dispatcher = None

    if dispatcher is not None:
        try:
            return await get_manifest_for_dispatcher(
                db, trip_id, operator_organization_id=dispatcher.organization_id,
            )
        except ResourceNotFoundError as exc:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    try:
        driver = await get_current_driver(credentials, db)
    except HTTPException:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Authentication required.")

    try:
        return await get_linehaul_for_driver(db, trip_id, driver_id=driver.id)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
