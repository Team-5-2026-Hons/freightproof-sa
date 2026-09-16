"""Celery application and task registry.

Exposes the Celery app instance the worker container loads via
``celery -A app.tasks worker``. Tasks live in sibling modules
(e.g. ``app/tasks/blockchain.py``) and are auto-discovered.
"""

from celery import Celery

from app.core.config import settings

# Broker and result backend share one Redis instance; no need to separate them.
celery: Celery = Celery(
    "freightproof",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery.conf.broker_connection_retry_on_startup = True

# autodiscover_tasks() scans for a tasks.py inside each listed package —
# won't find sibling modules like parcel_perfect.py, which are registered
# via explicit imports below.
celery.autodiscover_tasks(["app.tasks"])

# Polls Parcel Perfect for active-trip consignment updates; interval is
# tunable per environment via PP_POLL_INTERVAL_SECONDS.
celery.conf.beat_schedule = {
    "pp-sync-active-consignments": {
        "task": "tasks.pp.sync_active_consignments",
        "schedule": settings.PP_POLL_INTERVAL_SECONDS,
    },
    "idvs-sweep-abandoned-verifications": {
        "task": "tasks.verification.sweep_abandoned",
        "schedule": settings.IDVS_SWEEP_INTERVAL_SECONDS,
    },
}

# Explicit imports register sibling task modules with the Celery registry
# (see autodiscover_tasks note above). Must stay below `celery = Celery(...)`
# since each module imports `celery` back from this one (E402 is a false
# positive on a required circular-import guard).
from app.tasks.blockchain import (  # noqa: E402
    PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    anchor_phase_event_task as anchor_phase_event_task,
    recover_phase_anchors_task as recover_phase_anchors_task,
)
from app.tasks.parcel_perfect import sync_active_consignments as sync_active_consignments  # noqa: E402
from app.tasks.verification import sweep_abandoned as sweep_abandoned  # noqa: E402

celery.conf.beat_schedule["recover-phase-anchors"] = {
    "task": "tasks.blockchain.recover_phase_anchors",
    "schedule": PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    "options": {"expires": PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS},
}
