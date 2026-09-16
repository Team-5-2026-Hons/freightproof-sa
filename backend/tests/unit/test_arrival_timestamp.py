"""Trip arrival records the final driving phase, independently of delivery paperwork."""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.orchestration import phase_service
from app.schemas.phases import ConfirmationCompleteRequest, InTransitCompleteRequest


@pytest.fixture
def arrival_context(monkeypatch: pytest.MonkeyPatch) -> tuple[AsyncMock, Trip, PhaseEvent]:
    """Keep timestamp orchestration real while isolating DB and external corroboration."""
    trip = Trip(
        id=uuid.uuid4(), driver_id=uuid.uuid4(), operator_organization_id=uuid.uuid4(),
        status=TripStatus.ACTIVE,
    )
    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=uuid.uuid4(),
        phase_type=PhaseType.IN_TRANSIT, sequence_number=4, status=PhaseStatus.PENDING,
    )
    db = AsyncMock(spec=AsyncSession)
    db.execute.return_value = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = None
    monkeypatch.setattr(phase_service, "_gate_and_load", AsyncMock(return_value=(trip, event)))
    # Corroboration now returns the tracker fix for proximity assessment. This fixture
    # models an unavailable tracker explicitly rather than letting AsyncMock return a
    # truthy mock object whose fake timestamp reaches the evaluator.
    monkeypatch.setattr(
        phase_service.corroboration_service,
        "record_phase_corroboration",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(phase_service, "_raise_position_disagreement_if_unrecorded", AsyncMock())
    monkeypatch.setattr(phase_service, "recompute_position", AsyncMock())
    monkeypatch.setattr(phase_service, "enqueue_event", MagicMock())
    monkeypatch.setattr(phase_service, "get_trip_detail", AsyncMock())
    return db, trip, event


async def test_final_driver_arrival_uses_phase_completion_timestamp(
    arrival_context: tuple[AsyncMock, Trip, PhaseEvent],
) -> None:
    db, trip, event = arrival_context

    await phase_service.advance_in_transit(
        db, trip_id=trip.id, driver_id=trip.driver_id, phase_event_id=event.id,
        payload=InTransitCompleteRequest(
            phase_type=PhaseType.IN_TRANSIT, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert event.completed_at is not None
    assert trip.actual_arrival_at == event.completed_at


async def test_intermediate_driver_arrival_leaves_trip_arrival_unset(
    arrival_context: tuple[AsyncMock, Trip, PhaseEvent],
) -> None:
    db, trip, event = arrival_context
    db.execute.return_value.scalar_one_or_none.return_value = uuid.uuid4()

    await phase_service.advance_in_transit(
        db, trip_id=trip.id, driver_id=trip.driver_id, phase_event_id=event.id,
        payload=InTransitCompleteRequest(
            phase_type=PhaseType.IN_TRANSIT, idempotency_key=str(uuid.uuid4()),
        ),
    )

    assert event.completed_at is not None
    assert trip.actual_arrival_at is None


async def test_overridden_arrival_does_not_claim_actual_arrival(
    arrival_context: tuple[AsyncMock, Trip, PhaseEvent],
) -> None:
    db, trip, event = arrival_context
    event.status = PhaseStatus.OVERRIDDEN

    await phase_service._finish_phase(
        db, trip=trip, event=event, idempotency_key=str(uuid.uuid4()),
    )

    assert event.completed_at is not None
    assert trip.actual_arrival_at is None


@pytest.mark.parametrize("has_arrival", [False, True])
async def test_confirmation_preserves_arrival_or_its_absence(
    arrival_context: tuple[AsyncMock, Trip, PhaseEvent],
    monkeypatch: pytest.MonkeyPatch, has_arrival: bool,
) -> None:
    db, trip, event = arrival_context
    event.phase_type = PhaseType.CONFIRMATION
    arrival = datetime.now(UTC) - timedelta(hours=1) if has_arrival else None
    trip.actual_arrival_at = arrival
    pod_photo_id = uuid.uuid4()
    pod_signature_id = uuid.uuid4()
    monkeypatch.setattr(
        phase_service,
        "_assert_artifacts_belong_to_trip",
        AsyncMock(return_value={pod_photo_id: "a" * 64, pod_signature_id: "b" * 64}),
    )
    monkeypatch.setattr(phase_service.scan_service, "load_consignments_at_stop", AsyncMock(return_value=[]))
    monkeypatch.setattr(phase_service, "_dispatch_anchor", MagicMock())

    await phase_service.advance_confirmation(
        db, trip_id=trip.id, driver_id=trip.driver_id, phase_event_id=event.id,
        payload=ConfirmationCompleteRequest(
            phase_type=PhaseType.CONFIRMATION,
            idempotency_key=str(uuid.uuid4()), driver_visual_count=0,
            pod_photo_artifact_id=pod_photo_id, pod_signature_artifact_id=pod_signature_id,
        ),
    )

    assert event.status == PhaseStatus.COMPLETED
    assert trip.actual_arrival_at == arrival
