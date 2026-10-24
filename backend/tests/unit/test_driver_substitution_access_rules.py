"""FP-83 C2: the pure rules behind the access gate and the reservation window."""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.exceptions import CustodyContextChangedError, CustodyContextRequiredError
from app.orchestration.substitutions.access import CurrentCustody, check_custody_sequence
from app.orchestration.substitutions.availability import reservation_window
import uuid

_DRIVER = uuid.uuid4()
_BASE = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
_HOUR = timedelta(hours=1)


def _custody(sequence: int) -> CurrentCustody:
    return CurrentCustody(driver_id=_DRIVER, sequence=sequence, substitution_id=None if sequence == 0 else uuid.uuid4())


def test_omitted_sequence_is_accepted_before_any_handover():
    assert check_custody_sequence(_custody(0), None) is None


def test_omitted_sequence_is_required_once_custody_has_moved():
    assert isinstance(check_custody_sequence(_custody(1), None), CustodyContextRequiredError)


def test_matching_sequence_is_accepted():
    assert check_custody_sequence(_custody(2), 2) is None


@pytest.mark.parametrize(("current", "claimed"), [(2, 0), (1, 0), (0, 1)])
def test_a_different_sequence_is_a_changed_context(current: int, claimed: int):
    # (2, 0) is A -> B -> A: A is current again, but the capture belongs to A's first period.
    assert isinstance(check_custody_sequence(_custody(current), claimed), CustodyContextChangedError)


def test_reservation_runs_from_the_exchange_to_the_planned_end():
    assert reservation_window(expected_at=_BASE + 4 * _HOUR, planned_end=_BASE + 8 * _HOUR, now=_BASE) == (
        _BASE + 4 * _HOUR, _BASE + 8 * _HOUR,
    )


@pytest.mark.parametrize("planned_end", [None, _BASE + _HOUR, _BASE + 4 * _HOUR])
def test_reservation_with_no_usable_end_stays_open(planned_end: datetime | None):
    # None: no promised end. 1h: the trip has already overrun it. 4h: it does not follow the exchange.
    window = reservation_window(expected_at=_BASE + 4 * _HOUR, planned_end=planned_end, now=_BASE + 2 * _HOUR)

    assert window == (_BASE + 4 * _HOUR, None)


def test_overdue_reservation_never_starts_later_than_now_and_stays_open():
    now = _BASE + 5 * _HOUR

    start, end = reservation_window(expected_at=_BASE + 2 * _HOUR, planned_end=_BASE + 8 * _HOUR, now=now)

    assert start <= now
    assert end is None
