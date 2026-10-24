"""Store the device tokens drivers register, so a GATE_ARRIVAL push has somewhere to go."""

from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.db.models.driver_push_tokens import DriverPushToken
from app.schemas.push import PushTokenRegistration


async def register_push_token(db: AsyncSession, *, driver_id: UUID, payload: PushTokenRegistration) -> None:
    """Record `payload.token` as belonging to `driver_id`, refreshing it if already known.

    One upsert on the unique token, not a read-then-write: the app re-registers on every
    launch, and two launches racing would otherwise both see "absent" and one would fail on
    the constraint. A token held by another driver moves to this one (the device changed hands).
    """
    statement = pg_insert(DriverPushToken).values(
        driver_id=driver_id, token=payload.token, platform=payload.platform.value,
    )
    await db.execute(statement.on_conflict_do_update(
        constraint="uq_driver_push_tokens_token",
        set_={
            "driver_id": statement.excluded.driver_id,
            "platform": statement.excluded.platform,
            "last_seen_at": func.now(),
            "updated_at": func.now(),
        },
    ))
