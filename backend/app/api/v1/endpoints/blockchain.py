"""FastAPI router for blockchain receipt and verification endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.events import DriverEvent, VehicleEvent
from app.db.models.enums import SubjectType
from app.db.models.people import Driver
from app.db.session import get_db
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.verification_service import verify_subject
from app.schemas.blockchain import BlockchainReceiptRead, VerifyRequest, VerifyResponse
from app.schemas.people import UserRead

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


async def _assert_subject_visible(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: UUID,
    organization_id: UUID,
) -> None:
    """Prevent dispatchers from probing receipts outside their organisation."""
    if subject_type == SubjectType.TRIP:
        query = select(Trip.id).where(
            Trip.id == subject_id,
            Trip.operator_organization_id == organization_id,
        )
    elif subject_type == SubjectType.VEHICLE:
        query = select(Vehicle.id).where(
            Vehicle.id == subject_id,
            Vehicle.organization_id == organization_id,
        )
    elif subject_type == SubjectType.DRIVER:
        query = select(Driver.id).where(
            Driver.id == subject_id,
            Driver.organization_id == organization_id,
        )
    elif subject_type == SubjectType.VEHICLE_EVENT:
        query = (
            select(VehicleEvent.id)
            .join(Vehicle, Vehicle.id == VehicleEvent.vehicle_id)
            .where(
                VehicleEvent.id == subject_id,
                Vehicle.organization_id == organization_id,
            )
        )
    elif subject_type == SubjectType.DRIVER_EVENT:
        query = (
            select(DriverEvent.id)
            .join(Driver, Driver.id == DriverEvent.driver_id)
            .where(
                DriverEvent.id == subject_id,
                Driver.organization_id == organization_id,
            )
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blockchain subject not found",
        )

    result = await db.execute(query.limit(1))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blockchain subject not found",
        )


@router.get("/receipts", response_model=list[BlockchainReceiptRead])
async def list_receipts(
    subject_type: SubjectType = Query(...),
    subject_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[BlockchainReceiptRead]:
    await _assert_subject_visible(
        db,
        subject_type=subject_type,
        subject_id=subject_id,
        organization_id=current_user.organization_id,
    )
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            BlockchainReceipt.subject_type == subject_type,
            BlockchainReceipt.subject_id == subject_id,
        )
        .order_by(BlockchainReceipt.created_at.desc())
    )
    return [BlockchainReceiptRead.model_validate(r) for r in result.scalars().all()]


@router.post("/verify", response_model=VerifyResponse)
async def verify_endpoint(
    payload: VerifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> VerifyResponse:
    await _assert_subject_visible(
        db,
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
        organization_id=current_user.organization_id,
    )
    outcome = await verify_subject(
        db,
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
    )
    return VerifyResponse(
        status=outcome.status,
        receipt=BlockchainReceiptRead.model_validate(outcome.receipt) if outcome.receipt else None,
        expected_hash=outcome.expected_hash,
        current_hash=outcome.current_hash,
    )
