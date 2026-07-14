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
celery = Celery(
    "freightproof",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery.conf.broker_connection_retry_on_startup = True

# Auto-discover tasks in any ``app.tasks.*`` module that defines them.
# Empty today; populated as feature tickets add task files.
celery.autodiscover_tasks(["app.tasks"])