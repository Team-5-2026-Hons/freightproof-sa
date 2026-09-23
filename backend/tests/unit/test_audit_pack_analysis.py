"""Unit tests for orchestration/audit_pack_analysis.py — pure functions, no DB, no HTTP.

Coordinates are real points on the N3 (Johannesburg → Durban), the corridor the
beachhead trips run on.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.orchestration.audit_pack_analysis import (
    COVERAGE_GAP_THRESHOLD,
    STATIONARY_MIN_DURATION,
    derive_observations,
    find_coverage_gaps,
    find_stationary_periods,
    is_valid_on,
    last_fix_before,
    mask_id_number,
    summarise_incident,
)
from app.core.display import format_sast
from tests.unit.audit_pack_factories import make_exception as _exception
from tests.unit.audit_pack_factories import make_manifest as _manifest
from tests.unit.audit_pack_factories import make_phase as _phase
from app.schemas.audit_pack import (
    AuditPackManifest,
    IncidentDeclarationRecord,
    AnchoredRecord,
    AnchoredField,
    CoverageGap,
    PositionFix,
    StopRecord,
)

T0 = datetime(2026, 9, 12, 8, 0, tzinfo=UTC)

# Harrismith truck stop, and a point ~1 km along the N3 from it.
HARRISMITH = (-28.2726, 29.1294)
HARRISMITH_1KM = (-28.2636, 29.1294)
# Johannesburg depot precinct used as the "approved stop".
JHB_DEPOT = (-26.2041, 28.0473)


def _phone(lat_lng: tuple[float, float], at: datetime) -> PositionFix:
    return PositionFix(lat=lat_lng[0], lng=lat_lng[1], source="driver_phone", recorded_at=at)


def _stop(lat_lng: tuple[float, float], radius: int = 300) -> StopRecord:
    return StopRecord(
        trip_stop_id=uuid.uuid4(), sequence=1, precinct_id=uuid.uuid4(), precinct_name="Depot",
        address=None, lat=lat_lng[0], lng=lat_lng[1], geofence_radius_metres=radius, slot_time=None,
    )


# ── mask_id_number ────────────────────────────────────────────────────────────


def test_mask_id_number_keeps_last_four_digits():
    # Arrange
    id_number = "8001015009087"

    # Act
    masked = mask_id_number(id_number)

    # Assert
    assert masked == "*********9087"


def test_mask_id_number_masks_short_value_completely():
    # Arrange
    id_number = "123"

    # Act
    masked = mask_id_number(id_number)

    # Assert
    assert masked == "***"


# ── is_valid_on ───────────────────────────────────────────────────────────────


def test_is_valid_on_expiry_after_trip_date_is_true():
    assert is_valid_on(date(2027, 1, 1), date(2026, 9, 12)) is True


def test_is_valid_on_expiry_before_trip_date_is_false():
    assert is_valid_on(date(2026, 9, 11), date(2026, 9, 12)) is False


def test_is_valid_on_expiry_on_trip_date_is_true():
    assert is_valid_on(date(2026, 9, 12), date(2026, 9, 12)) is True


def test_is_valid_on_unknown_expiry_is_none():
    assert is_valid_on(None, date(2026, 9, 12)) is None


# ── find_coverage_gaps ────────────────────────────────────────────────────────


def test_find_coverage_gaps_reports_gap_longer_than_threshold():
    # Arrange
    long_gap = COVERAGE_GAP_THRESHOLD + timedelta(minutes=17)
    times = [T0, T0 + timedelta(minutes=5), T0 + timedelta(minutes=5) + long_gap]

    # Act
    gaps = find_coverage_gaps(times, window_start=T0, window_end=times[-1])

    # Assert
    assert gaps == [CoverageGap(
        start=T0 + timedelta(minutes=5), end=times[-1], minutes=int(long_gap.total_seconds() // 60),
    )]


def test_find_coverage_gaps_ignores_gap_exactly_at_threshold():
    # Arrange
    times = [T0, T0 + COVERAGE_GAP_THRESHOLD]

    # Act
    gaps = find_coverage_gaps(times, window_start=T0, window_end=times[-1])

    # Assert
    assert gaps == []


def test_find_coverage_gaps_counts_window_edges_without_fixes():
    # Arrange: the only fix sits in the middle of a 3-hour window.
    window_end = T0 + timedelta(hours=3)
    times = [T0 + timedelta(minutes=90)]

    # Act
    gaps = find_coverage_gaps(times, window_start=T0, window_end=window_end)

    # Assert
    assert [(g.start, g.end) for g in gaps] == [(T0, times[0]), (times[0], window_end)]


def test_find_coverage_gaps_whole_window_is_gap_when_no_fixes():
    # Arrange
    window_end = T0 + timedelta(hours=2)

    # Act
    gaps = find_coverage_gaps([], window_start=T0, window_end=window_end)

    # Assert
    assert gaps == [CoverageGap(start=T0, end=window_end, minutes=120)]


def test_find_coverage_gaps_ignores_fixes_outside_window_and_sorts_input():
    # Arrange: unsorted, with a fix hours before the window opens.
    times = [T0 + timedelta(minutes=20), T0 - timedelta(hours=5), T0 + timedelta(minutes=10)]

    # Act
    gaps = find_coverage_gaps(times, window_start=T0, window_end=T0 + timedelta(minutes=30))

    # Assert
    assert gaps == []


def test_find_coverage_gaps_without_window_returns_nothing():
    assert find_coverage_gaps([T0], window_start=None, window_end=None) == []


# ── find_stationary_periods ──────────────────────────────────────────────────


def test_find_stationary_periods_flags_long_stop_outside_any_precinct():
    # Arrange: pings every 5 min at Harrismith for longer than the minimum duration.
    steps = int(STATIONARY_MIN_DURATION.total_seconds() // 300) + 2
    fixes = [_phone(HARRISMITH, T0 + timedelta(minutes=5 * i)) for i in range(steps)]

    # Act
    periods = find_stationary_periods(fixes, stops=[_stop(JHB_DEPOT)])

    # Assert
    assert len(periods) == 1
    assert periods[0].start == fixes[0].recorded_at
    assert periods[0].end == fixes[-1].recorded_at


def test_find_stationary_periods_ignores_stop_inside_a_precinct():
    # Arrange
    steps = int(STATIONARY_MIN_DURATION.total_seconds() // 300) + 2
    fixes = [_phone(JHB_DEPOT, T0 + timedelta(minutes=5 * i)) for i in range(steps)]

    # Act
    periods = find_stationary_periods(fixes, stops=[_stop(JHB_DEPOT)])

    # Assert
    assert periods == []


def test_find_stationary_periods_ignores_short_stop():
    # Arrange: two pings 5 minutes apart — well under the minimum.
    fixes = [_phone(HARRISMITH, T0), _phone(HARRISMITH, T0 + timedelta(minutes=5))]

    # Act
    periods = find_stationary_periods(fixes, stops=[])

    # Assert
    assert periods == []


def test_find_stationary_periods_ignores_moving_vehicle():
    # Arrange: alternating between two points 1 km apart.
    fixes = [
        _phone(HARRISMITH if i % 2 == 0 else HARRISMITH_1KM, T0 + timedelta(minutes=5 * i))
        for i in range(12)
    ]

    # Act
    periods = find_stationary_periods(fixes, stops=[])

    # Assert
    assert periods == []


def test_find_stationary_periods_does_not_bridge_a_coverage_gap():
    # Arrange: same spot either side of a gap longer than the threshold — nobody knows
    # what happened in between, so it must not be reported as one long stop.
    after_gap = T0 + COVERAGE_GAP_THRESHOLD + timedelta(minutes=5)
    fixes = [_phone(HARRISMITH, T0), _phone(HARRISMITH, after_gap)]

    # Act
    periods = find_stationary_periods(fixes, stops=[])

    # Assert
    assert periods == []


# ── last_fix_before ───────────────────────────────────────────────────────────


def test_last_fix_before_returns_latest_fix_not_after_instant():
    # Arrange
    early = _phone(HARRISMITH, T0)
    late = _phone(HARRISMITH_1KM, T0 + timedelta(minutes=10))
    after = _phone(JHB_DEPOT, T0 + timedelta(minutes=30))

    # Act
    result = last_fix_before([after, early, late], T0 + timedelta(minutes=15))

    # Assert
    assert result == late


def test_last_fix_before_none_when_all_fixes_later():
    assert last_fix_before([_phone(HARRISMITH, T0)], T0 - timedelta(minutes=1)) is None


# ── format_sast ───────────────────────────────────────────────────────────────


def test_format_sast_converts_utc_to_south_african_time():
    assert format_sast(datetime(2026, 9, 12, 12, 32, tzinfo=UTC)) == "12 Sep 2026 14:32 SAST"


# ── derive_observations ──────────────────────────────────────────────────────


def _codes(manifest: AuditPackManifest) -> dict[str, str]:
    return {o.code: o.level for o in derive_observations(manifest)}


def test_derive_observations_complete_trip_reports_custody_as_info():
    # Arrange
    manifest = _manifest(phases=[_phase(0, "trip_creation"), _phase(1, "activation")])

    # Act
    codes = _codes(manifest)

    # Assert
    assert codes["custody.completeness"] == "info"
    assert "trip.incomplete" not in codes


def test_derive_observations_unfinished_trip_names_last_completed_phase():
    # Arrange: a hijacked trip stops at departure; later phases stay pending.
    phases = [
        _phase(0, "trip_creation"),
        _phase(1, "departure"),
        _phase(2, "in_transit", status="pending", completed_at=None),
        _phase(3, "unloading", status="pending", completed_at=None),
    ]
    manifest = _manifest(phases=phases, status="exception_hold")

    # Act
    observations = {o.code: o for o in derive_observations(manifest)}

    # Assert
    incomplete = observations["trip.incomplete"]
    assert incomplete.level == "attention"
    assert "exception_hold" in incomplete.text
    assert "departure" in incomplete.text.lower()
    assert "2 phases pending" in incomplete.text
    assert observations["custody.completeness"].level == "attention"


def test_derive_observations_seal_match_is_info():
    # Arrange
    manifest = _manifest(phases=[
        _phase(1, "departure", seal_number="ABC123"),
        _phase(3, "unloading", seal_number=" abc123 "),
    ])

    # Act
    codes = _codes(manifest)

    # Assert
    assert codes["seal.continuity"] == "info"


def test_derive_observations_seal_mismatch_is_attention():
    # Arrange
    manifest = _manifest(phases=[
        _phase(1, "departure", seal_number="ABC123"),
        _phase(3, "unloading", seal_number="XYZ999"),
    ])

    # Act
    observations = {o.code: o for o in derive_observations(manifest)}

    # Assert
    assert observations["seal.continuity"].level == "attention"
    assert "ABC123" in observations["seal.continuity"].text
    assert "XYZ999" in observations["seal.continuity"].text


def test_derive_observations_count_shortfall_is_attention():
    # Arrange
    manifest = _manifest(phases=[
        _phase(1, "loading", parcel_count_origin=10),
        _phase(4, "confirmation", parcel_count_destination=9, driver_visual_count=9),
    ])

    # Act
    observations = {o.code: o for o in derive_observations(manifest)}

    # Assert
    assert observations["counts.reconciliation"].level == "attention"
    assert "10" in observations["counts.reconciliation"].text
    assert "9" in observations["counts.reconciliation"].text


def test_derive_observations_pending_anchor_is_attention_never_success():
    # Arrange
    manifest = _manifest(phases=[_phase(4, "confirmation", anchor_status="pending")])

    # Act
    codes = _codes(manifest)

    # Assert
    assert codes["anchors.status"] == "attention"


def test_derive_observations_anchor_field_mismatch_is_attention():
    # Arrange
    phase = _phase(
        1, "departure", anchor_status="anchored",
        anchored_fields=[AnchoredField(name="seal_number", value="XYZ", matches_anchor=False)],
    )

    # Act
    codes = _codes(_manifest(phases=[phase]))

    # Assert
    assert codes["anchors.field_mismatch"] == "attention"


def test_derive_observations_override_is_attention_with_note():
    # Arrange
    phase = _phase(2, "loading", status="overridden", overridden_by_dispatcher=True,
                   override_note="Scanner offline")

    # Act
    observations = {o.code: o for o in derive_observations(_manifest(phases=[phase]))}

    # Assert
    assert observations["custody.override"].level == "attention"
    assert "Scanner offline" in observations["custody.override"].text


def test_derive_observations_unreviewed_critical_exception_is_attention():
    # Arrange
    exception = _exception("panic_button", "critical")

    # Act
    observations = [o for o in derive_observations(_manifest(phases=[], exceptions=[exception]))
                    if o.code == "exceptions.unreviewed"]

    # Assert
    assert len(observations) == 1
    assert observations[0].evidence_ids == [exception.exception_id]


def test_derive_observations_reviewed_exception_reports_response_minutes():
    # Arrange
    exception = _exception(
        "panic_button", "critical", review_status="reviewed", review_outcome="handled_externally",
        reviewed_at=T0 + timedelta(hours=4, minutes=6), contact_method="phone",
    )

    # Act
    observations = {o.code: o for o in derive_observations(_manifest(phases=[], exceptions=[exception]))}

    # Assert
    assert "6 min" in observations["exceptions.response"].text
    assert "phone" in observations["exceptions.response"].text


def test_derive_observations_reports_each_coverage_gap():
    # Arrange
    gap = CoverageGap(start=T0, end=T0 + timedelta(minutes=47), minutes=47)

    # Act
    observations = [o for o in derive_observations(_manifest(phases=[], gaps=[gap]))
                    if o.code == "location.gap"]

    # Assert
    assert len(observations) == 1
    assert "47 min" in observations[0].text


def test_derive_observations_receipt_payload_not_matching_hash_is_attention():
    # Arrange
    record = AnchoredRecord(
        receipt_id=uuid.uuid4(), subject_type="phase_event", subject_id=uuid.uuid4(),
        receipt_type="pickup", canonical_payload='{"a":1}', data_hash="00" * 32,
        hedera_topic_id="0.0.1", hedera_sequence_number=1, hedera_tx_id="tx",
        hedera_consensus_at=T0, payload_matches_hash=False,
    )
    manifest = _manifest(phases=[]).model_copy(update={"anchored_records": [record]})

    # Act
    observations = [o for o in derive_observations(manifest) if o.code == "anchors.receipt_integrity"]

    # Assert
    assert len(observations) == 1
    assert observations[0].level == "attention"
    assert observations[0].evidence_ids == [record.receipt_id]


def test_derive_observations_in_progress_phase_counts_as_pending():
    # Arrange
    manifest = _manifest(
        phases=[_phase(0, "trip_creation"), _phase(1, "activation", status="in_progress", completed_at=None)],
        status="active",
    )

    # Act
    observations = {o.code: o for o in derive_observations(manifest)}

    # Assert
    assert observations["custody.completeness"].text.startswith("1 of 2 phases resolved; 1 pending")


# ── summarise_incident ────────────────────────────────────────────────────────


def test_summarise_incident_none_without_critical_exception():
    # Arrange
    exceptions = [_exception("dispatcher_note", "info")]

    # Act / Assert
    assert summarise_incident(exceptions, fixes=[]) is None


def test_summarise_incident_uses_first_critical_and_last_prior_fix():
    # Arrange
    first = _exception("panic_button", "critical", raised_at=T0 + timedelta(hours=5),
                       review_status="reviewed", reviewed_at=T0 + timedelta(hours=5, minutes=6))
    later = _exception("seal_broken_in_transit", "critical", raised_at=T0 + timedelta(hours=6))
    before = _phone(HARRISMITH, T0 + timedelta(hours=4, minutes=50))
    after = _phone(HARRISMITH_1KM, T0 + timedelta(hours=5, minutes=10))

    # Act
    incident = summarise_incident([later, first], fixes=[after, before])

    # Assert
    assert incident is not None
    assert incident.exception_ids == [first.exception_id, later.exception_id]
    assert incident.first_exception_type == "panic_button"
    assert incident.last_known_position == before
    assert incident.minutes_to_first_review == 6


def test_summarise_incident_unreviewed_has_no_review_minutes():
    # Arrange
    panic = _exception("panic_button", "critical")

    # Act
    incident = summarise_incident([panic], fixes=[])

    # Assert
    assert incident is not None
    assert incident.first_reviewed_at is None
    assert incident.minutes_to_first_review is None


# ── Declared notifications ────────────────────────────────────────────────────


def _declaration(declared_at: datetime, **facts: Any) -> IncidentDeclarationRecord:
    fields: dict[str, Any] = dict(
        declaration_id=uuid.uuid4(), exception_id=None, saps_station=None, saps_cas_number=None, saps_officer=None,
        reported_to_saps_at=None, tracking_company_notified_at=None, insurer_notified_at=None,
        client_notified_at=None, insurer_claim_reference=None, note=None, declared_by_name="Ops Desk",
        declared_at=declared_at,
    )
    fields.update(facts)
    return IncidentDeclarationRecord(**fields)


def _incident_manifest(declarations: list[IncidentDeclarationRecord]) -> AuditPackManifest:
    panic = _exception("panic_button", "critical", raised_at=T0 + timedelta(hours=4))
    manifest = _manifest(phases=[], exceptions=[panic])
    return manifest.model_copy(update={
        "incident": summarise_incident([panic], fixes=[]), "declarations": declarations,
    })


def test_derive_observations_incident_without_declaration_asks_for_police_details():
    # Act
    codes = _codes(_incident_manifest([]))

    # Assert
    assert codes["notifications.undeclared"] == "attention"


def test_derive_observations_declared_police_report_states_delay_and_case():
    # Arrange
    declaration = _declaration(
        T0 + timedelta(days=1), saps_station="Harrismith SAPS", saps_cas_number="123/09/2026",
        reported_to_saps_at=T0 + timedelta(hours=4, minutes=45),
    )

    # Act
    observations = {o.code: o for o in derive_observations(_incident_manifest([declaration]))}

    # Assert
    saps = observations["notifications.saps"]
    assert "Declared" in saps.text
    assert "45 min" in saps.text
    assert "123/09/2026" in saps.text
    assert "Harrismith SAPS" in saps.text
    assert "notifications.undeclared" not in observations


def test_derive_observations_client_told_after_24_hours_is_attention():
    # Arrange: TAPA TSR 9.3.1 expects the client told within 24 hours of a suspected theft.
    declaration = _declaration(T0 + timedelta(days=3), client_notified_at=T0 + timedelta(hours=4 + 30))

    # Act
    observations = {o.code: o for o in derive_observations(_incident_manifest([declaration]))}

    # Assert
    assert observations["notifications.client"].level == "attention"
    assert "24 hours" in observations["notifications.client"].text


def test_derive_observations_client_told_within_24_hours_is_info():
    declaration = _declaration(T0 + timedelta(days=1), client_notified_at=T0 + timedelta(hours=5))
    observations = {o.code: o for o in derive_observations(_incident_manifest([declaration]))}
    assert observations["notifications.client"].level == "info"


def test_derive_observations_later_declaration_supersedes_earlier_value():
    # Arrange: a correction is a new declaration; the newest value of each fact is used.
    first = _declaration(T0 + timedelta(days=1), saps_cas_number="WRONG/1")
    correction = _declaration(T0 + timedelta(days=2), saps_cas_number="123/09/2026",
                              reported_to_saps_at=T0 + timedelta(hours=5))

    # Act
    observations = {o.code: o for o in derive_observations(_incident_manifest([correction, first]))}

    # Assert
    assert "123/09/2026" in observations["notifications.saps"].text
    assert "WRONG/1" not in observations["notifications.saps"].text
