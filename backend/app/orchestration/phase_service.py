"""Compatibility facade: phase completion now lives in app.orchestration.phases.

Every name that used to be defined here is re-exported so existing imports keep resolving.
New code imports from the phases.* module that owns the name; tests must patch the module
that looks a name up, never this one (check B8).
"""

from app.core.geo import KM_THRESHOLD_METRES as _SEPARATION_KM_THRESHOLD_METRES, format_distance as _format_separation
from app.orchestration.phases.payloads import (
    PHASE_PAYLOAD_VERSION_V2, _override_commitment, _phase_payload_base,
    compute_activation_canonical_payload_v2, compute_arrival_canonical_payload_v2,
    compute_confirmation_canonical_payload_v1, compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v1, compute_departure_canonical_payload_v2,
    compute_in_transit_canonical_payload_v2, compute_loading_canonical_payload_v2,
    compute_override_canonical_payload_v2, compute_unloading_canonical_payload_v2,
)
from app.orchestration.phases.loaders import (
    _load_phase_event, _load_trip_for_dispatcher, _load_trip_for_driver,
)
from app.orchestration.phases.state import _is_resolved, recompute_position
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.seals import _find_departure_for_leg, _normalized_seal
from app.orchestration.phases.scheduling import (
    _SCHEDULED_DATE_FORMAT, _other_trips_for_driver, _reject_if_an_earlier_trip_is_due,
    _reject_if_another_trip_underway, _reject_if_not_due, _scheduled_departure,
    is_before_scheduled_day, operating_day,
)
from app.orchestration.phases.findings import (
    _phone_tracker_separation_metres, _raise_position_disagreement_if_unrecorded,
    _raise_scan_shortfall_if_unrecorded, _raise_trailer_decoupling_if_unrecorded,
    _record_seal_finding, _seal_unverified_severity,
)
from app.orchestration.phases.anchor_execution import _PHASE_RECEIPT_TYPES, _anchor_or_fail_open, anchor_phase_event, receipt_type_for
from app.orchestration.phases.queries import current_phase_event, list_phases, next_phase
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.anchor_dispatch import (
    _BACKGROUND_ANCHOR_TASKS, _anchor_phase, _dispatch_anchor, _retain_anchor_task,
    _schedule_anchor_after_dispatch_failure,
)
from app.orchestration.phases.anchor_recovery import recover_phase_anchor
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.advance_activation import advance_activation
from app.orchestration.phases.advance_loading import advance_loading
from app.orchestration.phases.advance_departure import advance_departure
from app.orchestration.phases.advance_in_transit import advance_in_transit
from app.orchestration.phases.advance_arrival import advance_arrival
from app.orchestration.phases.advance_unloading import advance_unloading
from app.orchestration.phases.advance_confirmation import advance_confirmation
from app.orchestration.phases.override import override_phase
from app.orchestration.phases.service import _WRAPPER_BY_PHASE_TYPE, _WrapperFn, complete_phase

__all__ = [
    "PHASE_PAYLOAD_VERSION_V2",
    "_BACKGROUND_ANCHOR_TASKS",
    "_PHASE_RECEIPT_TYPES",
    "_SCHEDULED_DATE_FORMAT",
    "_SEPARATION_KM_THRESHOLD_METRES",
    "_WRAPPER_BY_PHASE_TYPE",
    "_WrapperFn",
    "_anchor_or_fail_open",
    "_anchor_phase",
    "_assert_artifacts_belong_to_trip",
    "_dispatch_anchor",
    "_find_departure_for_leg",
    "_finish_phase",
    "_format_separation",
    "_gate_and_load",
    "_is_resolved",
    "_load_phase_event",
    "_load_trip_for_dispatcher",
    "_load_trip_for_driver",
    "_normalized_seal",
    "_other_trips_for_driver",
    "_override_commitment",
    "_phase_payload_base",
    "_phone_tracker_separation_metres",
    "_raise_position_disagreement_if_unrecorded",
    "_raise_scan_shortfall_if_unrecorded",
    "_raise_trailer_decoupling_if_unrecorded",
    "_record_driver_position",
    "_record_seal_finding",
    "_reject_if_an_earlier_trip_is_due",
    "_reject_if_another_trip_underway",
    "_reject_if_not_due",
    "_retain_anchor_task",
    "_schedule_anchor_after_dispatch_failure",
    "_scheduled_departure",
    "_seal_unverified_severity",
    "advance_activation",
    "advance_arrival",
    "advance_confirmation",
    "advance_departure",
    "advance_in_transit",
    "advance_loading",
    "advance_unloading",
    "anchor_phase_event",
    "complete_phase",
    "compute_activation_canonical_payload_v2",
    "compute_arrival_canonical_payload_v2",
    "compute_confirmation_canonical_payload_v1",
    "compute_confirmation_canonical_payload_v2",
    "compute_departure_canonical_payload_v1",
    "compute_departure_canonical_payload_v2",
    "compute_in_transit_canonical_payload_v2",
    "compute_loading_canonical_payload_v2",
    "compute_override_canonical_payload_v2",
    "compute_unloading_canonical_payload_v2",
    "current_phase_event",
    "is_before_scheduled_day",
    "list_phases",
    "next_phase",
    "operating_day",
    "override_phase",
    "receipt_type_for",
    "recompute_position",
    "recover_phase_anchor",
]
