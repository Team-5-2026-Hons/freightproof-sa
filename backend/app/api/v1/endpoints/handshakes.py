"""Handshake advancement endpoints — driver PWA's 'Complete & continue' CTAs."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import (
    HandshakeSequenceError,
    HederaServiceError,
    HederaTimeoutError,
    ResourceNotFoundError,
)
from app.db.models.enums import HandshakeType
from app.db.session import get_db
from app.orchestration.handshake_service import (
    advance_h1, advance_h2, advance_h3, advance_h4, advance_h5, get_handshake_detail,
)
from app.schemas.handshakes import (
    H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
    HandshakeEventRead,
)
from app.schemas.people import DriverRead
from app.schemas.trips import TripDetailResponse

router = APIRouter(prefix="/trips/{trip_id}/handshakes", tags=["handshakes"])


@router.post("/h1/complete", response_model=TripDetailResponse)
async def complete_h1_endpoint(
    trip_id: UUID,
    payload: H1CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h1(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/h2/complete", response_model=TripDetailResponse)
async def complete_h2_endpoint(
    trip_id: UUID,
    payload: H2CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h2(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=http_status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except HederaServiceError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/h3/complete", response_model=TripDetailResponse)
async def complete_h3_endpoint(
    trip_id: UUID,
    payload: H3CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h3(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/h4/complete", response_model=TripDetailResponse)
async def complete_h4_endpoint(
    trip_id: UUID,
    payload: H4CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """Note: returns 200 even on seal mismatch — the trip continues under
    EXCEPTION_HOLD with a dispatcher alert, per the contract. Never 4xx here."""
    try:
        return await advance_h4(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/h5/complete", response_model=TripDetailResponse)
async def complete_h5_endpoint(
    trip_id: UUID,
    payload: H5CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        return await advance_h5(db, trip_id=trip_id, driver_id=current_driver.id, payload=payload)
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HandshakeSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=http_status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except HederaServiceError as exc:
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{handshake_type}", response_model=HandshakeEventRead)
async def get_handshake_detail_endpoint(
    trip_id: UUID,
    handshake_type: HandshakeType,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandshakeEventRead:
    try:
        event = await get_handshake_detail(
            db, trip_id=trip_id, handshake_type=handshake_type, driver_id=current_driver.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return HandshakeEventRead.model_validate(event)
