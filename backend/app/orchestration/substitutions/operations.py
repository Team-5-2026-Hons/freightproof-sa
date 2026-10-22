"""Idempotency for driver substitution calls, and the clock they stamp.

Each state-changing call carries a client_request_id. `find_replay` returns the stored answer to an
actor's earlier identical call (or refuses a reused key with different content); `record_operation`
stores the answer once the call succeeds. `utcnow` is the one clock every substitution module reads,
looked up as `operations.utcnow()` so a test can pin it in one place.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import IdempotencyKeyReusedError
from app.db.models.driver_substitutions import DriverSubstitutionOperation


ResultT = TypeVar("ResultT", bound=BaseModel)


def utcnow() -> datetime:
    """The server's clock. A module function (not an inline call) so tests can pin exact SAST instants."""
    return datetime.now(UTC)


def body_digest(*scope: uuid.UUID, body: BaseModel) -> str:
    """SHA-256 of the canonical body plus the ids it was sent against, so the same key reused on
    another trip or request is a different body, not a replay."""
    canonical = json.dumps(
        {"scope": [str(item) for item in scope], "body": body.model_dump(mode="json")},
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class OperationKey:
    """Who did what with which client key and body: the identity of one idempotent call."""

    action: str
    client_request_id: uuid.UUID
    digest: str
    actor_user_id: uuid.UUID | None = None
    actor_driver_id: uuid.UUID | None = None

    def _actor_matches(self) -> ColumnElement[bool]:
        if self.actor_user_id is not None:
            return DriverSubstitutionOperation.actor_user_id == self.actor_user_id
        return DriverSubstitutionOperation.actor_driver_id == self.actor_driver_id


async def find_replay(db: AsyncSession, key: OperationKey, *, result_type: type[ResultT]) -> ResultT | None:
    """The stored result of this actor's earlier identical call, or None if there was none.

    Raises IdempotencyKeyReusedError when the key was used for different content.
    """
    operation = (await db.execute(
        select(DriverSubstitutionOperation).where(
            key._actor_matches(), DriverSubstitutionOperation.action == key.action,
            DriverSubstitutionOperation.client_request_id == key.client_request_id,
        )
    )).scalar_one_or_none()
    if operation is None:
        return None
    if operation.body_digest != key.digest:
        raise IdempotencyKeyReusedError()
    return result_type.model_validate(operation.result_json)


def record_operation(
    db: AsyncSession, key: OperationKey, *, request_id: uuid.UUID | None, result: BaseModel,
    late_evidence_id: uuid.UUID | None = None,
) -> None:
    db.add(DriverSubstitutionOperation(
        actor_user_id=key.actor_user_id, actor_driver_id=key.actor_driver_id, action=key.action,
        client_request_id=key.client_request_id, body_digest=key.digest, request_id=request_id,
        late_evidence_id=late_evidence_id, result_json=result.model_dump(mode="json"),
    ))
