"""Handshake advancement endpoints — driver PWA's 'Complete & continue' CTAs.

Stage-2-scoped shim: each route still resolves its target PhaseEvent by
(trip_id, phase_type) via _next_pending() below — the phase_event_id-addressed
route shape (parent plan §3.2) is Stage 3.1's job. This shim lives in this one
file, for this one stage, and is deleted wholesale once those routes land.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_driver
from app.core.exceptions import (
    HederaServiceError,
    HederaTimeoutError,
    PhaseSequenceError,
    ResourceNotFoundError,
)
from app.db.models.enums import PhaseStatus, PhaseType
from app.db.models.phases import PhaseEvent
from app.db.session import get_db
from app.orchestration.phase_service import (
    advance_activation, advance_confirmation, advance_departure, advance_loading,
    advance_unloading, get_handshake_detail,
)
from app.schemas.handshakes import (
    H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
    HandshakeEventRead,
)
from app.schemas.people import DriverRead
from app.schemas.trips import TripDetailResponse

router = APIRouter(prefix="/trips/{trip_id}/handshakes", tags=["handshakes"])


async def _next_pending(db: AsyncSession, *, trip_id: UUID, phase_type: PhaseType) -> UUID:
    """The next not-yet-completed PhaseEvent row of this type for the trip —
    resolves the route's implied phase_type to the id the phase engine actually
    addresses by (T2). Every row already exists from create_trip (task 2.1)."""
    result = await db.execute(
        select(PhaseEvent.id)
        .where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.phase_type == phase_type,
            PhaseEvent.status != PhaseStatus.COMPLETED,
        )
        .order_by(PhaseEvent.sequence_number)
        .limit(1)
    )
    phase_event_id = result.scalar_one_or_none()
    if phase_event_id is None:
        raise ResourceNotFoundError("PhaseEvent", phase_type.value)
    return phase_event_id


@router.post("/h1/complete", response_model=TripDetailResponse)
async def complete_h1_endpoint(
    trip_id: UUID,
    payload: H1CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        phase_event_id = await _next_pending(db, trip_id=trip_id, phase_type=PhaseType.ACTIVATION)
        return await advance_activation(
            db, trip_id=trip_id, driver_id=current_driver.id, phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/h2/complete", response_model=TripDetailResponse)
async def complete_h2_endpoint(
    trip_id: UUID,
    payload: H2CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    try:
        phase_event_id = await _next_pending(db, trip_id=trip_id, phase_type=PhaseType.LOADING)
        return await advance_loading(
            db, trip_id=trip_id, driver_id=current_driver.id, phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseSequenceError as exc:
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
        phase_event_id = await _next_pending(db, trip_id=trip_id, phase_type=PhaseType.DEPARTURE)
        return await advance_departure(
            db, trip_id=trip_id, driver_id=current_driver.id, phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseSequenceError as exc:
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
        phase_event_id = await _next_pending(db, trip_id=trip_id, phase_type=PhaseType.UNLOADING)
        return await advance_unloading(
            db, trip_id=trip_id, driver_id=current_driver.id, phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/h5/complete", response_model=TripDetailResponse)
async def complete_h5_endpoint(
    trip_id: UUID,
    payload: H5CompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """Note: as of task 2.5 (D7), advance_confirmation anchors fail-open —
    a Hedera outage no longer raises HederaTimeoutError/HederaServiceError here,
    it's caught internally and recorded on event.anchor_status. This endpoint
    therefore always returns 200 on a successful phase completion, even when the
    anchor itself failed (dispatchers see that via anchor_status='failed', not
    via a 504/502 here)."""
    try:
        phase_event_id = await _next_pending(db, trip_id=trip_id, phase_type=PhaseType.CONFIRMATION)
        return await advance_confirmation(
            db, trip_id=trip_id, driver_id=current_driver.id, phase_event_id=phase_event_id, payload=payload,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PhaseSequenceError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/{handshake_type}", response_model=HandshakeEventRead)
async def get_handshake_detail_endpoint(
    trip_id: UUID,
    handshake_type: PhaseType,
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
