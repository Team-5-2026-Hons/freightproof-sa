"""Unit tests for the busy-window rule in orchestration/trips/availability.py (FP-139, FP-175).

Pure functions only: the window, the overlap test and the wording. The database half (who
occupies what, the locks) is covered by the integration tests in test_trips.py and
test_creation_concurrency.py.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.db.models.enums import TripStatus
from app.orchestration.trips.availability import (
    as_utc, busy_until, clash_message, format_when, hold_start, planned_window, windows_overlap,
)
from app.schemas.availability import BusyEntry, CrewResourceType

_T0 = datetime(2026, 10, 16, 6, 0, tzinfo=UTC)
_HOUR = timedelta(hours=1)


def _entry(**overrides: object) -> BusyEntry:
    fields: dict[str, object] = {
        "resource_type": CrewResourceType.HORSE, "resource_id": uuid.uuid4(), "label": "CA 441 892",
        "trip_id": uuid.uuid4(), "trip_reference": "TRP-0038", "trip_status": TripStatus.CREATED,
        "busy_from": _T0, "busy_until": _T0 + 8 * _HOUR, "planned_until": _T0 + 8 * _HOUR,
    }
    fields.update(overrides)
    return BusyEntry.model_validate(fields)


def test_windows_overlap_touching_end_to_start_is_not_a_clash():
    assert windows_overlap(_T0, _T0 + 8 * _HOUR, _T0 + 8 * _HOUR, _T0 + 12 * _HOUR) is False


def test_windows_overlap_touching_start_to_end_is_not_a_clash():
    assert windows_overlap(_T0 + 8 * _HOUR, _T0 + 12 * _HOUR, _T0, _T0 + 8 * _HOUR) is False


def test_windows_overlap_one_minute_overlap_is_a_clash():
    assert windows_overlap(_T0, _T0 + 8 * _HOUR, _T0 + 8 * _HOUR - timedelta(minutes=1), _T0 + 12 * _HOUR) is True


def test_windows_overlap_contained_window_is_a_clash():
    assert windows_overlap(_T0, _T0 + 8 * _HOUR, _T0 + 2 * _HOUR, _T0 + 3 * _HOUR) is True


def test_windows_overlap_identical_windows_clash():
    assert windows_overlap(_T0, _T0 + _HOUR, _T0, _T0 + _HOUR) is True


def test_windows_overlap_open_end_clashes_with_anything_after_its_start():
    assert windows_overlap(_T0, None, _T0 + 1000 * _HOUR, _T0 + 1001 * _HOUR) is True


def test_windows_overlap_open_end_does_not_reach_back_before_its_start():
    assert windows_overlap(_T0, None, _T0 - 2 * _HOUR, _T0) is False


def test_planned_window_prefers_trip_level_times():
    assert planned_window(_T0, _T0 + 8 * _HOUR, [_T0 - _HOUR, _T0 + 20 * _HOUR]) == (_T0, _T0 + 8 * _HOUR)


def test_planned_window_falls_back_to_first_and_last_stop_slots():
    assert planned_window(None, None, [_T0, _T0 + 3 * _HOUR, _T0 + 6 * _HOUR]) == (_T0, _T0 + 6 * _HOUR)


def test_planned_window_single_timed_stop_has_no_end():
    assert planned_window(None, None, [_T0]) == (_T0, None)


def test_planned_window_with_nothing_scheduled_is_empty():
    assert planned_window(None, None, []) == (None, None)


def test_busy_until_created_trip_frees_at_its_planned_end_even_when_past():
    assert busy_until(TripStatus.CREATED, _T0, now=_T0 + 5 * _HOUR) == _T0


def test_busy_until_active_trip_before_its_planned_end_uses_the_plan():
    assert busy_until(TripStatus.ACTIVE, _T0 + 8 * _HOUR, now=_T0) == _T0 + 8 * _HOUR


@pytest.mark.parametrize("status", [TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD])
def test_busy_until_live_trip_past_its_planned_end_is_busy_until_closed(status: TripStatus):
    assert busy_until(status, _T0, now=_T0 + _HOUR) is None


def test_busy_until_live_trip_exactly_at_its_planned_end_is_busy_until_closed():
    assert busy_until(TripStatus.ACTIVE, _T0, now=_T0) is None


def test_busy_until_trip_with_no_end_is_busy_until_closed():
    assert busy_until(TripStatus.CREATED, None, now=_T0) is None


def test_busy_until_accepts_a_status_read_back_as_a_plain_string():
    """Trip.status can come back from the database as a plain str. A set lookup would miss it
    (a str-Enum member hashes by name), which is why LIVE_STATUSES is a tuple."""
    assert busy_until("active", _T0, now=_T0 + _HOUR) is None  # type: ignore[arg-type]



@pytest.mark.parametrize("status", [TripStatus.ACTIVE, TripStatus.EXCEPTION_HOLD])
def test_hold_start_live_trip_started_early_holds_from_now(status: TripStatus):
    assert hold_start(status, _T0 + 2 * _HOUR, _T0) == _T0


def test_hold_start_booked_trip_still_waits_for_its_planned_start():
    assert hold_start(TripStatus.CREATED, _T0 + 2 * _HOUR, _T0) == _T0 + 2 * _HOUR


def test_hold_start_live_trip_past_its_planned_start_keeps_the_plan():
    assert hold_start(TripStatus.ACTIVE, _T0 - _HOUR, _T0) == _T0 - _HOUR


def test_format_when_uses_operator_time_without_a_leading_zero():
    assert format_when(datetime(2026, 10, 9, 14, 0, tzinfo=UTC)) == "Fri 9 Oct, 16:00"


def test_as_utc_reads_a_naive_datetime_as_utc():
    assert as_utc(datetime(2026, 10, 16, 6, 0)) == _T0


def test_clash_message_names_the_kind_label_trip_and_free_time():
    message = clash_message([_entry()])

    assert message == "Horse CA 441 892 is on TRP-0038 until Fri 16 Oct, 16:00. Pick another horse, or move this departure."


def test_clash_message_for_a_live_trip_says_it_is_still_under_way():
    message = clash_message([_entry(
        resource_type=CrewResourceType.TRAILER, label="CA 789 013", trip_status=TripStatus.ACTIVE,
        busy_until=None,
    )])

    assert message == "Trailer CA 789 013 is on TRP-0038, which is still under way. Pick another trailer."


def test_clash_message_for_a_trip_with_no_arrival_says_so():
    message = clash_message([_entry(
        resource_type=CrewResourceType.DRIVER, label="Sipho Dlamini", busy_until=None, planned_until=None,
    )])

    assert message == "Driver Sipho Dlamini is on TRP-0038, which has no planned arrival. Pick another driver, or cancel that trip."


def test_clash_message_names_only_the_first_clash():
    first = _entry(trip_reference="TRP-0001")

    message = clash_message([first, _entry(trip_reference="TRP-0002")])

    assert "TRP-0001" in message
    assert "TRP-0002" not in message
