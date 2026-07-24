"""Celery task: poll Parcel Perfect for consignment sync updates.

Runs on the beat schedule (PP_POLL_INTERVAL_SECONDS) and refreshes every
active consignment's waybill data from Parcel Perfect so that parcel counts,
declared values, and barcode sets stay in sync with PP throughout a trip.

Layering: tasks → orchestration → integrations → db.
"""

import asyncio
import logging
from typing import Any

from celery import Task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models.enums import TripStatus
from app.db.models.trips import Consignment, Trip
from app.orchestration.consignment_service import fetch_and_sync_consignment
from app.tasks import celery

logger = logging.getLogger(__name__)

# Trip statuses that represent an open, in-progress journey.
# CLOSED, CANCELLED, and EXCEPTION_HOLD are excluded: closed trips are
# immutable evidence records; cancelled trips have no active cargo; held
# trips may be legally sensitive and should not be auto-refreshed.
_ACTIVE_STATUSES: frozenset[TripStatus] = frozenset({
    TripStatus.CREATED,
    TripStatus.ORIGIN_GATE_IN,
    TripStatus.LOADING,
    TripStatus.ORIGIN_GATE_OUT,
    TripStatus.IN_TRANSIT,
    TripStatus.DEST_GATE_IN,
    TripStatus.UNLOADING,
})


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
    # Build a short-lived engine + session factory scoped to this task run.
    # We do not reuse the module-level engine from db/session.py because Celery
    # workers may run in a forked subprocess where a pre-fork connection pool
    # would be unsafe. A fresh engine per invocation is inexpensive at this
    # polling frequency (at most once per PP_POLL_INTERVAL_SECONDS).
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
        # Query consignments joined to trips with an active status.
        # We select (Consignment, trip_id, client_organization_id) in one
        # round-trip to avoid N+1 queries for trip metadata.
        result = await db.execute(
            select(Consignment)
            .join(Trip, Trip.id == Consignment.trip_id)
            .where(Trip.status.in_(_ACTIVE_STATUSES))
        )
        consignments: list[Consignment] = result.scalars().all()

        logger.info(
            "pp_sync: found %d active consignment(s) to refresh",
            len(consignments),
        )

        for consignment in consignments:
            # Skip consignments where PP already confirmed delivery in a prior poll.
            # poddate is written into pp_raw_json by _serialise_waybill() on every sync,
            # so a non-empty value here means PP has definitively closed the delivery.
            prior_poddate: str = (
                (consignment.pp_raw_json or {}).get("details", {}).get("poddate", "")
            )
            if prior_poddate:
                logger.info(
                    "pp_sync: skipping consignment id=%s — POD already confirmed (%s)",
                    consignment.id,
                    prior_poddate,
                )
                pods_confirmed += 1
                continue

            try:
                sync_result = await fetch_and_sync_consignment(
                    db=db,
                    pp_reference=consignment.parcel_perfect_reference,
                    trip_id=consignment.trip_id,
                )
                if sync_result.warning:
                    logger.warning(
                        "pp_sync: consignment id=%s pp_reference=%s: %s",
                        consignment.id,
                        consignment.parcel_perfect_reference,
                        sync_result.warning,
                    )
                updated = sync_result.consignment
                await db.commit()
                synced += 1

                # Detect a freshly confirmed POD in this sync cycle.
                new_poddate: str = (
                    (updated.pp_raw_json or {}).get("details", {}).get("poddate", "")
                )
                if new_poddate:
                    pods_confirmed += 1
                    logger.info(
                        "pp_sync: POD confirmed for consignment id=%s pp_reference=%s poddate=%s",
                        updated.id,
                        consignment.parcel_perfect_reference,
                        new_poddate,
                    )
                else:
                    logger.info(
                        "pp_sync: synced consignment id=%s pp_reference=%s",
                        consignment.id,
                        consignment.parcel_perfect_reference,
                    )
            except Exception as exc:
                # Roll back only this consignment's in-progress changes so the
                # session remains usable for subsequent consignments.
                await db.rollback()
                errors += 1
                logger.error(
                    "pp_sync: failed to sync consignment id=%s pp_reference=%s: %r",
                    consignment.id,
                    consignment.parcel_perfect_reference,
                    exc,
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
        # Celery workers are synchronous; asyncio.run() drives the async
        # implementation without requiring an async worker (e.g. gevent).
        return asyncio.run(_sync_all_active())
    except Exception as exc:
        logger.error(
            "pp_sync: unhandled exception — scheduling retry (%d/%d): %r",
            self.request.retries,
            self.max_retries,
            exc,
        )
        # self.retry() raises celery.exceptions.Retry, which Celery catches
        # and reschedules. Re-raising ensures the task is marked RETRY not SUCCESS.
        raise self.retry(exc=exc)
