"""Receipt reads for the blockchain endpoints.

The application boundary for reading anchored receipts: the API layer calls this module,
never the blockchain layer. Kept thin on purpose; auditing or caching of receipt reads
would be added here rather than in the endpoint.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain import anchor_service
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType


async def lookup_receipts(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    data_hash: str | None = None,
    hedera_tx_id: str | None = None,
    subject_id: uuid.UUID | None = None,
) -> list[BlockchainReceipt]:
    """Exact-match receipts visible to an organisation, newest first.

    Raises ValueError unless exactly one of data_hash or hedera_tx_id is given.
    """
    return await anchor_service.lookup_receipts(
        db,
        organization_id=organization_id,
        data_hash=data_hash,
        hedera_tx_id=hedera_tx_id,
        subject_id=subject_id,
    )


async def list_receipts_for_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> list[BlockchainReceipt]:
    """All receipts for one subject, newest first.

    Raises SubjectNotVisibleError when the subject is outside the caller's organisation.
    """
    return await anchor_service.list_receipts_for_subject(
        db,
        subject_type=subject_type,
        subject_id=subject_id,
        organization_id=organization_id,
    )
