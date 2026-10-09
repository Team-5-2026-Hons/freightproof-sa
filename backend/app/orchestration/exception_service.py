"""Compatibility facade: exception orchestration now lives in app.orchestration.exceptions.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the exceptions.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.orchestration.exceptions.creation import (
    _CLIENT_REPORT_ID_INDEX,
    _CRITICAL_TYPES,
    _DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS,
    _driver_report_assessment,
    _find_by_client_report_id,
    _resolve_breakdown_vehicle,
    _resolve_phase_context,
    pick_breakdown_vehicle,
    raise_exception,
)
from app.orchestration.exceptions.queries import (
    _HISTORY_REVIEW_STATUSES,
    _SEVERITY_RANK,
    _exception_read_query,
    _load_trip_contexts,
    _to_list_item,
    _TripContext,
    get_exception_detail,
    list_exception_history,
    list_review_queue,
)
from app.orchestration.exceptions.review import (
    _enqueue_claim_changed,
    _lock_for_review,
    _read_with_names,
    _read_with_trip,
    claim_exception,
    release_exception,
    review_exception,
    review_exceptions_batch,
)

__all__ = [
    "_CLIENT_REPORT_ID_INDEX",
    "_CRITICAL_TYPES",
    "_DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS",
    "_HISTORY_REVIEW_STATUSES",
    "_SEVERITY_RANK",
    "_TripContext",
    "_driver_report_assessment",
    "_enqueue_claim_changed",
    "_exception_read_query",
    "_find_by_client_report_id",
    "_load_trip_contexts",
    "_lock_for_review",
    "_read_with_names",
    "_read_with_trip",
    "_resolve_breakdown_vehicle",
    "_resolve_phase_context",
    "_to_list_item",
    "claim_exception",
    "get_exception_detail",
    "list_exception_history",
    "list_review_queue",
    "pick_breakdown_vehicle",
    "raise_exception",
    "release_exception",
    "review_exception",
    "review_exceptions_batch",
]
