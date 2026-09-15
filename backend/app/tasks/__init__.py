"""Celery application and task registry.

This module exposes the Celery app instance that the worker container loads
via ``celery -A app.tasks worker``. Tasks themselves live in sibling modules
(e.g. ``app/tasks/blockchain.py``) and are auto-discovered via ``autodiscover_tasks``.

No tasks are defined here in the scaffolding phase. Feature tickets that need
async work (FP-005 Hedera anchoring, later integration polling) register tasks
in their own modules.
"""

from celery import Celery

from app.core.config import settings

# Broker + result backend both point at Redis. The scaffolding uses the same
# Redis instance for both — Sprint 1 has no need to separate them.
celery: Celery = Celery(
    "freightproof",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery.conf.broker_connection_retry_on_startup = True

# Auto-discover tasks in any ``app.tasks.*`` module that defines them.
# autodiscover_tasks() scans for a tasks.py inside each listed package — it
# will not find sibling modules like parcel_perfect.py automatically, so we
# keep the original single-package entry and register sibling modules below.
celery.autodiscover_tasks(["app.tasks"])

# Beat schedule: polls Parcel Perfect for active-trip consignment updates.
# The interval is driven by PP_POLL_INTERVAL_SECONDS so it can be tuned per
# environment without a code change (e.g. shorter in dev, longer in production).
celery.conf.beat_schedule = {
    "pp-sync-active-consignments": {
        "task": "tasks.pp.sync_active_consignments",
        "schedule": settings.PP_POLL_INTERVAL_SECONDS,
    },
}

# Explicit import registers the parcel_perfect tasks with the Celery registry.
# autodiscover_tasks() only scans for a tasks.py in each listed package; it will not
# find sibling modules like parcel_perfect.py without this explicit import. It must
# stay below `celery = Celery(...)` above, since parcel_perfect.py imports `celery`
# back from this module (E402 is a false positive on a required circular-import guard).
from app.tasks.parcel_perfect import sync_active_consignments as sync_active_consignments  # noqa: E402