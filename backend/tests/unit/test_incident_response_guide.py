"""Unit tests for orchestration/incidents/response_guide.py: the hijacking checklist derived
from what was recorded. Pure — no DB, plain facts in, step states out.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.models.enums import IncidentExternalAction, TripStatus
from app.orchestration.incidents.response_guide import GuideFacts, build_response_guide
from app.schemas.audit_pack import IncidentDeclarationRecord

_NOW = datetime(2026, 10, 20, 14, 0, tzinfo=UTC)


def _declaration(**facts) -> IncidentDeclarationRecord:
    base = {
        "saps_station": None, "saps_cas_number": None, "saps_officer": None, "reported_to_saps_at": None,
        "tracking_company_notified_at": None, "insurer_notified_at": None, "client_notified_at": None,
        "insurer_claim_reference": None, "note": None,
    }
    return IncidentDeclarationRecord(
        declaration_id=uuid.uuid4(), exception_id=None, incident_id=uuid.uuid4(),
        declared_by_name="Dispatcher", declared_at=_NOW, **{**base, **facts},
    )


def _facts(**overrides) -> GuideFacts:
    base: dict[str, Any] = {"trip_stopped_at": None, "trip_status": TripStatus.ACTIVE, "actions": [], "declarations": [], "pack_issued_at": None}
    return GuideFacts(**{**base, **overrides})


def _states(facts: GuideFacts) -> dict[str, str]:
    return {step.key: step.state for step in build_response_guide(facts)}


def test_guide_nothing_recorded_everything_todo():
    states = _states(_facts())

    assert list(states) == [
        "trip_stopped", "tracking_company_alerted", "saps_reported", "insurer_notified",
        "client_notified", "driver_welfare_check", "audit_pack_issued",
    ]
    assert set(states.values()) == {"todo"}


def test_guide_trip_stopped_done_with_time():
    steps = build_response_guide(_facts(trip_stopped_at=_NOW, trip_status=TripStatus.CANCELLED))

    assert steps[0].state == "done" and steps[0].done_at == _NOW


def test_guide_trip_already_finished_not_applicable():
    assert _states(_facts(trip_status=TripStatus.CLOSED))["trip_stopped"] == "not_applicable"


def test_guide_tracking_alert_from_external_action_uses_earliest_time():
    later, earlier = _NOW, _NOW - timedelta(minutes=10)

    steps = build_response_guide(_facts(actions=[
        (IncidentExternalAction.TRACKING_COMPANY_ALERTED, later),
        (IncidentExternalAction.TRACKING_COMPANY_ALERTED, earlier),
    ]))

    tracking = next(s for s in steps if s.key == "tracking_company_alerted")
    assert tracking.state == "done" and tracking.done_at == earlier


def test_guide_tracking_alert_from_declaration():
    states = _states(_facts(declarations=[_declaration(tracking_company_notified_at=_NOW)]))

    assert states["tracking_company_alerted"] == "done"


def test_guide_saps_reported_without_cas_in_progress():
    states = _states(_facts(actions=[(IncidentExternalAction.SAPS_REPORTED, _NOW)]))

    assert states["saps_reported"] == "in_progress"


def test_guide_saps_with_cas_done_and_names_case():
    steps = build_response_guide(_facts(declarations=[
        _declaration(saps_station="Harrismith", saps_cas_number="CAS 123/10/2026", reported_to_saps_at=_NOW),
    ]))

    saps = next(s for s in steps if s.key == "saps_reported")
    assert saps.state == "done"
    assert saps.detail is not None and "CAS 123/10/2026" in saps.detail and "Harrismith" in saps.detail


def test_guide_insurer_notified_carries_claim_reference():
    steps = build_response_guide(_facts(declarations=[
        _declaration(insurer_notified_at=_NOW, insurer_claim_reference="CLM-77"),
    ]))

    insurer = next(s for s in steps if s.key == "insurer_notified")
    assert insurer.state == "done" and insurer.detail is not None and "CLM-77" in insurer.detail


def test_guide_welfare_and_client_from_actions():
    states = _states(_facts(actions=[
        (IncidentExternalAction.DRIVER_WELFARE_CHECK, _NOW), (IncidentExternalAction.CLIENT_NOTIFIED, _NOW),
    ]))

    assert states["driver_welfare_check"] == "done" and states["client_notified"] == "done"


def test_guide_audit_pack_issued():
    assert _states(_facts(pack_issued_at=_NOW))["audit_pack_issued"] == "done"
