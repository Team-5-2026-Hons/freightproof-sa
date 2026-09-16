"""Focused behaviour tests for separation-finding persistence."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import OperationalError

from app.orchestration.action_location_service import record_separation_finding
from app.schemas.action_location import ActionLocationAssessment


def _separated_assessment() -> ActionLocationAssessment:
    evaluated_at = datetime.now(UTC)
    return ActionLocationAssessment(
        policy_version="test-policy",
        evaluated_at=evaluated_at,
        driver_lat=-33.9249,
        driver_lng=18.4241,
        driver_captured_at=evaluated_at,
        driver_accuracy_metres=10.0,
        tracker_lat=-26.2041,
        tracker_lng=28.0473,
        tracker_captured_at=evaluated_at,
        separation_metres=1_000.0,
        proximity="separated",
        reasons=[],
        max_separation_metres=100.0,
        max_age_seconds=60,
        max_skew_seconds=30,
        max_phone_accuracy_metres=50.0,
        expected_trip_stop_id=None,
        precinct_id=None,
        precinct_lat=None,
        precinct_lng=None,
        precinct_radius_metres=None,
        precinct_tolerance_metres=None,
        driver_in_precinct=None,
        truck_in_precinct=None,
    )


async def test_unexpected_database_failure_propagates_from_separation_persistence() -> None:
    """Only the named partial-index race is recoverable; an outage must stay visible."""
    db = SimpleNamespace(execute=AsyncMock(side_effect=OperationalError("SELECT", {}, RuntimeError("down"))))
    trip = SimpleNamespace(id=uuid.uuid4(), operator_organization_id=uuid.uuid4())

    with pytest.raises(OperationalError, match="down"):
        await record_separation_finding(
            db,
            trip=trip,
            phase_event_id=uuid.uuid4(),
            checkpoint_id=None,
            assessment=_separated_assessment(),
        )
