"""Celery task: poll Parcel Perfect for consignment sync updates.

Runs on the beat schedule (PP_POLL_INTERVAL_SECONDS) and refreshes every
active consignment's waybill data from Parcel Perfect so that parcel counts,
declared values, and barcode sets stay in sync with PP throughout a trip.

Layering: tasks → orchestration → integrations → db.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from celery import Task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import TripStatus
from app.db.models.trips import Consignment, Trip
from app.orchestration.consignments.sync import fetch_and_sync_consignment
from app.tasks import celery

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES: frozenset[TripStatus] = frozenset({
    TripStatus.CREATED,
    TripStatus.ACTIVE,
})


@dataclass(frozen=True)
class _ConsignmentWork:
    """One consignment's sweep inputs as plain values, safe to read after a rollback."""

    id: uuid.UUID
    pp_reference: str
    trip_id: uuid.UUID
    pp_raw_json: dict[str, Any] | None


async def _sync_all_active() -> dict[str, Any]:
    """Fetch and sync all consignments linked to active trips.

    Isolated as a private coroutine so unit tests can drive it directly
    without spinning up a real Celery worker process.

    For each active consignment:
      - Calls fetch_and_sync_consignment (which hits the PP API or mock).
      - Commits the session on success.
      - On failure: rolls back that consignment's changes, logs the error,
        increments the error counter, and continues to the next one so a
        single bad waybill does not block the rest of the batch.

    Returns:
        {"synced": <int>, "errors": <int>}
    """
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    synced: int = 0
    errors: int = 0
    pods_confirmed: int = 0

    async with session_factory() as db:
        result = await db.execute(
            select(Consignment)
            .join(Trip, Trip.id == Consignment.trip_id)
            .where(Trip.status.in_(_ACTIVE_STATUSES))
        )
        work: list[_ConsignmentWork] = [
            _ConsignmentWork(c.id, c.parcel_perfect_reference, c.trip_id, c.pp_raw_json)
            for c in result.scalars().all() if c.trip_id is not None
        ]

        logger.info(
            "pp_sync: found %d active consignment(s) to refresh",
            len(work),
        )

        for item in work:
            prior_poddate: str = (item.pp_raw_json or {}).get("details", {}).get("poddate", "")
            if prior_poddate:
                logger.info(
                    "pp_sync: skipping consignment id=%s — POD already confirmed (%s)",
                    item.id,
                    prior_poddate,
                )
                pods_confirmed += 1
                continue

            try:
                sync_result = await fetch_and_sync_consignment(
                    db=db,
                    pp_reference=item.pp_reference,
                    trip_id=item.trip_id,
                )
                if sync_result.warning:
                    logger.warning(
                        "pp_sync: consignment id=%s pp_reference=%s: %s",
                        item.id,
                        item.pp_reference,
                        sync_result.warning,
                    )
                updated = sync_result.consignment
                await db.commit()
                synced += 1

                new_poddate: str = (
                    (updated.pp_raw_json or {}).get("details", {}).get("poddate", "")
                )
                if new_poddate:
                    pods_confirmed += 1
                    logger.info(
                        "pp_sync: POD confirmed for consignment id=%s pp_reference=%s poddate=%s",
                        item.id,
                        item.pp_reference,
                        new_poddate,
                    )
                else:
                    logger.info(
                        "pp_sync: synced consignment id=%s pp_reference=%s",
                        item.id,
                        item.pp_reference,
                    )
            except Exception:
                await db.rollback()
                errors += 1
                logger.exception(
                    "pp_sync: failed to sync consignment id=%s pp_reference=%s",
                    item.id,
                    item.pp_reference,
                )

    await engine.dispose()

    summary: dict[str, Any] = {"synced": synced, "errors": errors, "pods_confirmed": pods_confirmed}
    logger.info("pp_sync: complete — %s", summary)
    return summary


@celery.task(
    name="tasks.pp.sync_active_consignments",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def sync_active_consignments(self: Task) -> dict[str, Any]:
    """Celery beat task: refresh all active-trip consignments from Parcel Perfect.

    Scheduled via beat_schedule in app/tasks/__init__.py at the interval
    defined by settings.PP_POLL_INTERVAL_SECONDS.

    On an unhandled exception (e.g. DB unreachable, engine startup failure)
    the task retries up to 3 times with a 30-second delay before propagating
    the final exception as a task failure.
    """
    try:
        return asyncio.run(_sync_all_active())
    except Exception as exc:
        logger.error(
            "pp_sync: unhandled exception — scheduling retry (%d/%d): %r",
            self.request.retries,
            self.max_retries,
            exc,
        )
        raise self.retry(exc=exc)
