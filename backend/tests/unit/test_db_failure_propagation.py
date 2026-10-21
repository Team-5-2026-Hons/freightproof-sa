"""FP-275 regressions: optional work and cleanup must preserve the primary error."""

import asyncio
from decimal import Decimal
from typing import NoReturn
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConsignmentAlreadyAssignedError, PPSyncError
from app.db.cleanup import rollback_after_error
from app.db.errors import DatabaseUnavailableError
from app.db.models.enums import PhaseStatus, PhaseType
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Trip
from app.integrations.idvs import IdvsDecisionStatus
from app.orchestration.evidence import corroboration
from app.orchestration.exceptions.creation import _driver_report_assessment
from app.orchestration.handover import receiver_verification
from app.orchestration.phases import completion, findings
from app.orchestration.trips.creation import _sync_cargo_entry


@pytest.fixture
def trip() -> Trip:
    return Trip(id=uuid4(), horse_id=uuid4(), operator_organization_id=uuid4())


@pytest.fixture
def phase(trip: Trip) -> PhaseEvent:
    return PhaseEvent(
        id=uuid4(), trip_id=trip.id, phase_type=PhaseType.LOADING,
        status=PhaseStatus.COMPLETED, pulsit_geofence_confirmed=False,
        horse_gps_lat=Decimal("0"), horse_gps_lng=Decimal("0"),
    )


@pytest.mark.parametrize("operation", ["phase", "checkpoint", "position", "trailer", "driver-report"])
async def test_optional_work_propagates_database_availability_error(
    operation: str, trip: Trip, phase: PhaseEvent,
) -> None:
    failure = DatabaseUnavailableError("command_timeout", "command")
    db = AsyncMock(spec=AsyncSession)
    db.execute.side_effect = failure

    with pytest.raises(DatabaseUnavailableError) as caught:
        if operation == "phase":
            await corroboration.record_phase_corroboration(db, trip=trip, event=phase)
        elif operation == "checkpoint":
            await corroboration.record_checkpoint_corroboration(
                db, trip=trip, checkpoint=Checkpoint(id=uuid4(), trip_id=trip.id),
            )
        elif operation == "position":
            await findings._raise_position_disagreement_if_unrecorded(db, trip=trip, event=phase)
        elif operation == "trailer":
            phase.pulsit_geofence_confirmed = True
            await findings._raise_trailer_decoupling_if_unrecorded(db, trip=trip, event=phase)
        else:
            await _driver_report_assessment(
                db, trip=trip, exc=TripException(id=uuid4(), trip_id=trip.id),
                driver_captured_at=None, driver_accuracy_metres=None,
            )

    assert caught.value is failure
    db.execute.assert_awaited_once()


async def test_receiver_finding_propagates_database_availability_error(
    trip: Trip, monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = DatabaseUnavailableError("command_timeout", "command")
    db = AsyncMock(spec=AsyncSession)
    monkeypatch.setattr(receiver_verification, "register_exception", AsyncMock(side_effect=failure))
    verdict = receiver_verification.resolve_verdict(status=IdvsDecisionStatus.DECLINED, identity_match=False)

    with pytest.raises(DatabaseUnavailableError) as caught:
        await receiver_verification.raise_verification_exception(
            db, trip=trip, phase_event_id=uuid4(), trip_stop_id=None, verdict=verdict,
        )

    assert caught.value is failure
    db.flush.assert_not_awaited()


@pytest.mark.parametrize("database_failure", [True, False])
async def test_phase_assessment_propagates_database_outage_but_keeps_optional_fallback(
    database_failure: bool, trip: Trip, phase: PhaseEvent, monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = DatabaseUnavailableError("command_timeout", "command") if database_failure else TimeoutError()
    db = AsyncMock(spec=AsyncSession)
    monkeypatch.setattr(completion, "_raise_position_disagreement_if_unrecorded", AsyncMock())
    monkeypatch.setattr(completion, "_raise_trailer_decoupling_if_unrecorded", AsyncMock())
    monkeypatch.setattr(completion.action_location, "build_phase_assessment", AsyncMock(side_effect=failure))
    followup = AsyncMock()
    monkeypatch.setattr(completion, "recompute_position", followup)

    if database_failure:
        with pytest.raises(DatabaseUnavailableError) as caught:
            await completion._finish_phase(db, trip=trip, event=phase, idempotency_key=uuid4().hex)
        assert caught.value is failure
        followup.assert_not_awaited()
    else:
        # Stop at the next operation: the optional assessment should let completion continue.
        followup.side_effect = LookupError("completion continued")
        with pytest.raises(LookupError, match="completion continued"):
            await completion._finish_phase(db, trip=trip, event=phase, idempotency_key=uuid4().hex)
        followup.assert_awaited_once()


@pytest.mark.parametrize("primary", [
    ConsignmentAlreadyAssignedError("test-waybill", "existing-trip"),
    DatabaseUnavailableError("command_timeout", "command"),
    ValueError("invalid partner response"),
])
async def test_cargo_failure_keeps_its_error_mapping_when_rollback_fails(primary: Exception) -> None:
    db = AsyncMock(spec=AsyncSession)
    db.rollback.side_effect = DatabaseUnavailableError("cleanup_timeout", "rollback")

    async def failed_sync() -> NoReturn:
        raise primary

    expected = PPSyncError if isinstance(primary, ValueError) else type(primary)
    with pytest.raises(expected) as caught:
        await _sync_cargo_entry(db, "test-waybill", failed_sync())

    if isinstance(primary, ValueError):
        assert caught.value.__cause__ is primary
    else:
        assert caught.value is primary
    db.rollback.assert_awaited_once()


async def test_rollback_failure_logs_only_its_type(caplog: pytest.LogCaptureFixture) -> None:
    db = AsyncMock(spec=AsyncSession)
    db.rollback.side_effect = RuntimeError("sensitive driver parameters")

    assert await rollback_after_error(db) is False

    assert "Database rollback failed error_type=RuntimeError" in caplog.text
    assert "sensitive driver parameters" not in caplog.text


async def test_cancellation_during_error_rollback_still_propagates() -> None:
    db = AsyncMock(spec=AsyncSession)
    cancellation = asyncio.CancelledError()
    db.rollback.side_effect = cancellation

    with pytest.raises(asyncio.CancelledError) as caught:
        await rollback_after_error(db)

    assert caught.value is cancellation
