"""Hand-built Audit Pack manifests for unit tests — no DB. Defaults describe a closed,
uneventful trip; each test overrides only what it is about."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.schemas.audit_pack import (
    AuditPackManifest,
    AuditPackOptions,
    CheckpointRecord,
    CoverageGap,
    DriverRecord,
    ExceptionRecord,
    LocationCoverage,
    PhaseRecord,
    PositionFix,
    StopRecord,
    TripSummary,
)

T0 = datetime(2026, 9, 12, 8, 0, tzinfo=UTC)


def make_phase(seq: int, phase_type: str, **overrides: Any) -> PhaseRecord:
    base: dict[str, Any] = dict(
        phase_event_id=uuid.uuid4(), sequence_number=seq, phase_type=phase_type,
        status="completed", anchor_status="not_required", trip_stop_id=None, precinct_name=None,
        slot_time=None, completed_at=T0 + timedelta(hours=seq), driver_captured_at=None,
        driver_phone=None, vehicle_tracker=None, trailer_fixes=[], location_assessment=None,
        location_warning_acknowledged_at=None, location_warning_reason=None,
        overridden_by_dispatcher=False, override_note=None, seal_number=None,
        parcel_count_origin=None, parcel_count_destination=None, driver_visual_count=None,
        evidence=[], anchored_fields=[], anchor_receipt_id=None, tier="recorded",
    )
    base.update(overrides)
    return PhaseRecord(**base)


def make_exception(exception_type: str, severity: str, **overrides: Any) -> ExceptionRecord:
    base: dict[str, Any] = dict(
        exception_id=uuid.uuid4(), exception_type=exception_type, source="driver",
        severity=severity, description="d", raised_at=T0 + timedelta(hours=4), position=None,
        phase_event_id=None, checkpoint_id=None, consignment_id=None, review_status="recorded",
        review_outcome=None, reviewed_at=None, reviewer_name=None, contact_method=None,
        review_note=None, evidence=[], tier="recorded",
    )
    base.update(overrides)
    return ExceptionRecord(**base)


def make_manifest(
    *,
    phases: list[PhaseRecord],
    status: str = "closed",
    exceptions: list[ExceptionRecord] | None = None,
    gaps: list[CoverageGap] | None = None,
    stops: list[StopRecord] | None = None,
    trail: list[PositionFix] | None = None,
    checkpoints: list[CheckpointRecord] | None = None,
) -> AuditPackManifest:
    return AuditPackManifest(
        generated_at=T0 + timedelta(days=1),
        options=AuditPackOptions(),
        trip=TripSummary(
            trip_id=uuid.uuid4(), trip_reference="FP-0042", order_number="ORD-1", trip_type="loaded",
            status=status, operator_name="LFG", client_names=[], pulsit_trip_reference_id=None,
            journey_lock_hash=None, created_at=T0, planned_departure_at=None,
            planned_arrival_at=None, actual_departure_at=None, actual_arrival_at=None, closed_at=None,
        ),
        stops=stops or [], vehicles=[],
        driver=DriverRecord(
            driver_id=uuid.uuid4(), full_name="Driver", id_number="*********9087",
            id_number_masked=True, license_number="DRV-1", license_expiry=None,
            license_valid_on_trip_date=None, trip_idvs_status="verified", trip_idvs_checked_at=None,
            substitutions=[],
        ),
        consignments=[], phases=phases, checkpoints=checkpoints or [], exceptions=exceptions or [],
        record_changes=[], location_trail=trail or [],
        location_coverage=LocationCoverage(
            window_start=None, window_end=None, fix_counts={}, first_fix_at=None,
            last_fix_at=None, gaps=gaps or [], stationary_periods=[],
        ),
        anchored_records=[], observations=[], redactions=[],
    )
