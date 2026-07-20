"""FastAPI router for blockchain receipt and verification endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
from app.blockchain.anchor_service import list_receipts_for_subject
from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import DispatcherRole, SubjectType
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
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> list[BlockchainReceiptRead]:
    try:
        receipts = await list_receipts_for_subject(
            db, subject_type=subject_type,
            subject_id=subject_id, organization_id=current_user.organization_id,
        )
    except SubjectNotVisibleError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Blockchain subject not found")
    return [BlockchainReceiptRead.model_validate(r) for r in receipts]


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
    is_admin = current_user.role == DispatcherRole.ADMIN_DISPATCHER
    return VerifyResponse(
        status=outcome.status,
        receipt=BlockchainReceiptRead.model_validate(outcome.receipt) if (outcome.receipt and is_admin) else None,
        expected_hash=outcome.expected_hash if is_admin else None,
        current_hash=outcome.current_hash if is_admin else None,
    )
