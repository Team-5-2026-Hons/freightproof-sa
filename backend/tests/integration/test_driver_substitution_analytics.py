"""FP-83 C7: driver analytics after a handover (migration tim_dsub_driver_analytics).

Reuses the analytics suite's seeding and its `views` fixture, which replays every analytics view
migration in Alembic order, ending with the handover-aware driver view.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.driver_metrics import get_driver_metrics
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import DriverSubstitution, Trip
from tests.integration import test_analytics as analytics
from tests.integration.test_analytics import Operator, _single_leg, _start, _trip

views = analytics.views
operator = analytics.operator
lane = analytics.lane
month = analytics.month

_ORIGINAL_PHASES = {PhaseType.ACTIVATION, PhaseType.LOADING, PhaseType.DEPARTURE}


async def _handed_over_trip(db: AsyncSession, op: Operator, stops: list[Precinct], in_month: date) -> tuple[Trip, Driver]:
    operator = op
    trip = await _trip(db, operator, start=_start(in_month, 10), steps=_single_leg(), stops=stops)
    b = Driver(
        id=uuid.uuid4(), organization_id=operator.org.id, full_name="Incoming",
        id_number=str(uuid.uuid4().int)[:13], phone_number="+27821239999", license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    db.add(b)
    await db.flush()
    db.add(DriverSubstitution(
        id=uuid.uuid4(), trip_id=trip.id, original_driver_id=operator.driver.id, substituting_driver_id=b.id,
        exchange_location="Depot", approving_dispatcher_user_id=operator.dispatcher.id, is_planned=True,
        substitution_at=datetime.now(UTC), sequence_number=1,
    ))
    for phase in (await db.execute(select(PhaseEvent).where(PhaseEvent.trip_id == trip.id))).scalars():
        if phase.phase_type == PhaseType.TRIP_CREATION:
            continue
        original = phase.phase_type in _ORIGINAL_PHASES
        phase.performed_by_driver_id = operator.driver.id if original else b.id
        phase.custody_sequence = 0 if original else 1
    await db.flush()
    return trip, b


def _exception(trip: Trip, *, actor: uuid.UUID | None) -> TripException:
    return TripException(
        trip_id=trip.id, exception_type=ExceptionType.MECHANICAL,
        source=ExceptionSource.DRIVER if actor else ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        review_status=ExceptionReviewStatus.NEEDS_REVIEW, description="x", performed_by_driver_id=actor,
        custody_sequence=1 if actor else None,
    )


@pytest.mark.usefixtures("views")
async def test_later_driver_events_are_not_counted_against_original_driver(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
):
    trip, b = await _handed_over_trip(db_session, operator, lane, month)
    db_session.add_all([_exception(trip, actor=b.id), _exception(trip, actor=None)])
    await db_session.flush()

    metrics = {m.driver_id: m for m in await get_driver_metrics(
        db_session, organization_id=operator.org.id, start_month=month, end_month=month,
    )}

    a, incoming = metrics[operator.driver.id], metrics[b.id]
    assert (a.total_exceptions_count, incoming.total_exceptions_count) == (0, 1)
    assert (a.trip_count, incoming.trip_count, a.shared_trip_count, incoming.shared_trip_count) == (0, 0, 1, 1)
    assert (a.loading_dwell_events_count, a.departure_dwell_events_count, a.unloading_dwell_events_count) == (1, 1, 0)
    assert (incoming.unloading_dwell_events_count, incoming.confirmation_dwell_events_count) == (1, 1)
    assert (incoming.unloading_dwell_minutes_sum, incoming.confirmation_dwell_minutes_sum) == (40.0, 20.0)
    assert a.activation_dwell_events_count == 0
    assert (a.phase_events_count, incoming.phase_events_count) == (3, 3)


@pytest.mark.usefixtures("views")
async def test_a_trip_without_a_handover_is_measured_exactly_as_before(
    db_session: AsyncSession, operator: Operator, lane: list[Precinct], month: date,
):
    await _trip(db_session, operator, start=_start(month, 10), steps=_single_leg(), stops=lane)

    [m] = await get_driver_metrics(db_session, organization_id=operator.org.id, start_month=month, end_month=month)

    assert (m.trip_count, m.shared_trip_count, m.phase_events_count) == (1, 0, 7)
    assert (m.activation_dwell_minutes_sum, m.loading_dwell_minutes_sum, m.confirmation_dwell_minutes_sum) == (30.0, 60.0, 20.0)
