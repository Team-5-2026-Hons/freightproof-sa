"""FastAPI router for blockchain receipt and verification endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType
from app.db.session import get_db
from app.orchestration.verification_service import verify_subject
from app.schemas.blockchain import BlockchainReceiptRead, VerifyRequest, VerifyResponse
from app.schemas.people import UserRead

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


@router.get("/receipts", response_model=list[BlockchainReceiptRead])
async def list_receipts(
    subject_type: SubjectType = Query(...),
    subject_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[BlockchainReceiptRead]:
    try:
        await assert_subject_visible(
            db, subject_type=subject_type,
            subject_id=subject_id, organization_id=current_user.organization_id,
        )
    except SubjectNotVisibleError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Blockchain subject not found")
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
    try:
        await assert_subject_visible(
            db, subject_type=payload.subject_type,
            subject_id=payload.subject_id, organization_id=current_user.organization_id,
        )
    except SubjectNotVisibleError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Blockchain subject not found")
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
