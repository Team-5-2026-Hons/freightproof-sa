"""Celery application and task registry.

Exposes the Celery app instance the worker container loads via
``celery -A app.tasks worker``. Tasks live in sibling modules
(e.g. ``app/tasks/blockchain.py``) and are auto-discovered.
"""

from celery import Celery

from app.core.config import settings

celery: Celery = Celery(
    "freightproof",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery.conf.broker_connection_retry_on_startup = True

celery.autodiscover_tasks(["app.tasks"])

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

from app.tasks.blockchain import (  # noqa: E402
    PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    anchor_phase_event_task as anchor_phase_event_task,
    recover_phase_anchors_task as recover_phase_anchors_task,
)
from app.tasks.evidence_anchors import (  # noqa: E402
    EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    anchor_event_task as anchor_event_task,
    recover_events_task as recover_events_task,
)
from app.tasks.driver_substitutions import (  # noqa: E402
    CUSTODY_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    anchor_record_task as anchor_record_task,
    recover_records_task as recover_records_task,
)
from app.tasks.parcel_perfect import sync_active_consignments as sync_active_consignments  # noqa: E402
from app.tasks.verification import sweep_abandoned as sweep_abandoned  # noqa: E402

celery.conf.beat_schedule["recover-phase-anchors"] = {
    "task": "tasks.blockchain.recover_phase_anchors",
    "schedule": PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    "options": {"expires": PHASE_ANCHOR_RECOVERY_INTERVAL_SECONDS},
}

celery.conf.beat_schedule["recover-evidence-anchors"] = {
    "task": "tasks.evidence_anchors.recover_events",
    "schedule": EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    "options": {"expires": EVIDENCE_ANCHOR_RECOVERY_INTERVAL_SECONDS},
}

celery.conf.beat_schedule["recover-custody-anchors"] = {
    "task": "tasks.driver_substitutions.recover_records",
    "schedule": CUSTODY_ANCHOR_RECOVERY_INTERVAL_SECONDS,
    "options": {"expires": CUSTODY_ANCHOR_RECOVERY_INTERVAL_SECONDS},
}
