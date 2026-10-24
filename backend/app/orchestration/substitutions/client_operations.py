"""Current public create policy, with unchanged legacy parsing/digests for accepted retries.

The underlying version-aware lifecycle also supports historical v1 request fixtures/recovery.
Public new arrangements pass this boundary: only immediate v2 creates are accepted.
"""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import SubstitutionInvalidError
from app.orchestration.substitutions import guards, operations, service
from app.schemas.driver_substitutions import (
    ArrangeSubstitutionRequest, ArrangeImmediateSubstitutionRequest,
    ReplaceSubstitutionRequest, ReplaceImmediateSubstitutionRequest, SubstitutionRequestRead,
)
from app.schemas.people import UserRead


async def _legacy_replay(db: AsyncSession, trip_id: uuid.UUID, actor: UserRead, key: operations.OperationKey) -> SubstitutionRequestRead:
    await guards.lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    replay = await operations.find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay
    guards.require_new_arrangements_enabled()
    raise SubstitutionInvalidError('Refresh the dispatcher before arranging a new transfer.')


async def arrange_immediate_or_replay(
    db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead,
    payload: ArrangeSubstitutionRequest | ArrangeImmediateSubstitutionRequest,
) -> SubstitutionRequestRead:
    if isinstance(payload, ArrangeSubstitutionRequest):
        return await _legacy_replay(db, trip_id, actor, operations.OperationKey(action=service.ACTION_ARRANGE,
            actor_user_id=actor.id, client_request_id=payload.client_request_id, digest=operations.body_digest(trip_id, body=payload)))
    return await service.arrange_substitution(db, trip_id=trip_id, actor=actor, payload=payload)


async def replace_immediate_or_replay(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: UserRead,
    payload: ReplaceSubstitutionRequest | ReplaceImmediateSubstitutionRequest,
) -> SubstitutionRequestRead:
    if isinstance(payload, ReplaceSubstitutionRequest):
        return await _legacy_replay(db, trip_id, actor, operations.OperationKey(action=service.ACTION_REPLACE,
            actor_user_id=actor.id, client_request_id=payload.client_request_id, digest=operations.body_digest(trip_id, request_id, body=payload)))
    return await service.replace_substitution(db, trip_id=trip_id, request_id=request_id, actor=actor, payload=payload)
