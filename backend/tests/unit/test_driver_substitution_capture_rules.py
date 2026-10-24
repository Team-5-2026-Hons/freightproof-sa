"""The takeover seal rule: a loaded trip's seals are read only once it has departed."""

import pytest

from app.db.models.enums import PhaseType, TripType
from app.db.models.trips import Trip
from app.orchestration.substitutions.capture_validation import seal_expected


def _trip(trip_type: TripType, phase: PhaseType | None) -> Trip:
    return Trip(trip_type=trip_type.value, current_phase=phase.value if phase else None)


@pytest.mark.parametrize("phase", [PhaseType.TRIP_CREATION, PhaseType.ACTIVATION, PhaseType.LOADING])
def test_seal_expected_loaded_trip_before_departure_is_false(phase: PhaseType):
    trip = _trip(TripType.LOADED, phase)

    result = seal_expected(trip)

    assert result is False


@pytest.mark.parametrize("phase", [PhaseType.DEPARTURE, PhaseType.IN_TRANSIT, PhaseType.UNLOADING, None])
def test_seal_expected_loaded_trip_from_departure_is_true(phase: PhaseType | None):
    trip = _trip(TripType.LOADED, phase)

    result = seal_expected(trip)

    assert result is True


@pytest.mark.parametrize("phase", [PhaseType.LOADING, PhaseType.IN_TRANSIT])
def test_seal_expected_empty_leg_is_always_false(phase: PhaseType):
    trip = _trip(TripType.EMPTY_LEG, phase)

    result = seal_expected(trip)

    assert result is False
