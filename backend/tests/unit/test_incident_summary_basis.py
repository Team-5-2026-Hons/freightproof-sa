"""Unit tests for audit_packs.analysis.summarise_incident's choice of anchor: the first critical
exception, or a dispatcher-recorded hijacking when nothing critical came first. Pure.
"""

import uuid
from datetime import UTC, datetime, timedelta

from app.orchestration.audit_packs.analysis import summarise_incident
from app.schemas.audit_pack import ExceptionRecord, InvestigationRecord, PositionFix

_T0 = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


def _panic(at: datetime) -> ExceptionRecord:
    return ExceptionRecord(
        exception_id=uuid.uuid4(), exception_type="panic_button", source="driver", severity="critical",
        description="Driver activated panic button.", raised_at=at, position=None, phase_event_id=None,
        checkpoint_id=None, consignment_id=None, review_status="needs_review", review_outcome=None,
        reviewed_at=None, reviewer_name=None, contact_method=None, review_note=None, evidence=[], tier="recorded",
    )


def _hijacking(*, occurred: datetime | None, received: datetime, incident_type: str = "hijacking") -> InvestigationRecord:
    return InvestigationRecord(
        incident_id=uuid.uuid4(), reference="INC1", incident_type=incident_type, summary="Truck taken",
        reporter_role="tracking_company", report_channel="phone",
        reported_occurred_at=occurred, received_at=received, confidence="reported", status="open", outcome=None,
        closure_reason=None, closed_at=None, trip_stopped_at=None, assigned_to_name=None, exception_ids=[],
        parcels=[], entries=[],
    )


def test_summary_none_without_critical_exception_or_hijacking():
    assert summarise_incident([], fixes=[], investigations=[_hijacking(occurred=None, received=_T0, incident_type="parcel_shortage")]) is None


def test_summary_from_phone_reported_hijacking_uses_reported_time_and_last_fix():
    fix = PositionFix(lat=-28.2, lng=29.1, source="vehicle_tracker", recorded_at=_T0 - timedelta(minutes=5))
    later_fix = PositionFix(lat=-28.0, lng=29.0, source="vehicle_tracker", recorded_at=_T0 + timedelta(minutes=5))

    summary = summarise_incident(
        [], fixes=[fix, later_fix], investigations=[_hijacking(occurred=_T0, received=_T0 + timedelta(hours=1))],
    )

    assert summary is not None
    assert summary.basis == "investigation"
    assert summary.first_raised_at == _T0
    assert summary.last_known_position == fix


def test_summary_falls_back_to_received_time_when_occurrence_unknown():
    received = _T0 + timedelta(minutes=30)

    summary = summarise_incident([], fixes=[], investigations=[_hijacking(occurred=None, received=received)])

    assert summary is not None and summary.first_raised_at == received


def test_summary_earlier_panic_outranks_later_report():
    summary = summarise_incident(
        [_panic(_T0)], fixes=[], investigations=[_hijacking(occurred=_T0 + timedelta(minutes=20), received=_T0 + timedelta(hours=1))],
    )

    assert summary is not None
    assert summary.basis == "exception" and summary.first_exception_type == "panic_button"


def test_summary_tie_prefers_captured_exception():
    summary = summarise_incident([_panic(_T0)], fixes=[], investigations=[_hijacking(occurred=_T0, received=_T0)])

    assert summary is not None and summary.basis == "exception"
