"""Which coordinates a phase event records, and what it says about where they came from.

The property that matters: a position the dev panel staged is written AND stamped
`simulated`, and a position the handset reported is written AND stamped `device`. The
stamp is what keeps a demo walk from ever being presentable as a real capture — see
app/orchestration/phases/driver_position.py and app/dev/services/demo_phone.py.
"""

import uuid
from decimal import Decimal

import pytest

from app.db.models.enums import DriverPositionSource
from app.db.models.phases import PhaseEvent
from app.orchestration.phases import demo_position
from app.orchestration.phases.driver_position import _record_driver_position
from app.db.models.enums import PhaseType
from app.schemas.phases import InTransitCompleteRequest

REPORTED_LAT, REPORTED_LNG = -26.0942, 28.1342
STAGED_LAT, STAGED_LNG = Decimal("-33.9188610"), Decimal("18.4233000")


@pytest.fixture(autouse=True)
def no_provider_by_default() -> object:
    """Every test starts with no provider installed — a normal deployment's state."""
    demo_position.configure_demo_position_provider(None)
    yield
    demo_position.configure_demo_position_provider(None)


def _event() -> PhaseEvent:
    return PhaseEvent(id=uuid.uuid4(), trip_id=uuid.uuid4())


def _payload(**overrides: object) -> InTransitCompleteRequest:
    fields: dict[str, object] = {
        "phase_type": PhaseType.IN_TRANSIT,
        "idempotency_key": str(uuid.uuid4()),
        "driver_phone_lat": REPORTED_LAT,
        "driver_phone_lng": REPORTED_LNG,
    }
    fields.update(overrides)
    return InTransitCompleteRequest(**fields)  # type: ignore[arg-type]


def _stage(lat: Decimal, lng: Decimal) -> None:
    async def provider(_trip_id: uuid.UUID) -> tuple[Decimal, Decimal]:
        return lat, lng

    demo_position.configure_demo_position_provider(provider)


async def test_a_real_capture_is_recorded_and_stamped_device() -> None:
    event = _event()

    await _record_driver_position(event, _payload())

    assert event.driver_phone_lat == Decimal(str(REPORTED_LAT))
    assert event.driver_phone_lng == Decimal(str(REPORTED_LNG))
    assert event.driver_position_source == DriverPositionSource.DEVICE.value


async def test_a_staged_position_replaces_the_capture_and_is_stamped_simulated() -> None:
    event = _event()
    _stage(STAGED_LAT, STAGED_LNG)

    await _record_driver_position(event, _payload())

    assert event.driver_phone_lat == STAGED_LAT
    assert event.driver_phone_lng == STAGED_LNG
    assert event.driver_position_source == DriverPositionSource.SIMULATED.value


async def test_a_staged_position_is_recorded_even_when_the_handset_had_no_fix() -> None:
    event = _event()
    _stage(STAGED_LAT, STAGED_LNG)

    await _record_driver_position(
        event, _payload(driver_phone_lat=None, driver_phone_lng=None),
    )

    assert event.driver_phone_lat == STAGED_LAT
    assert event.driver_position_source == DriverPositionSource.SIMULATED.value


async def test_no_fix_and_no_staging_records_nothing_and_claims_nothing() -> None:
    event = _event()

    await _record_driver_position(
        event, _payload(driver_phone_lat=None, driver_phone_lng=None),
    )

    assert event.driver_phone_lat is None
    assert event.driver_phone_lng is None
    assert event.driver_position_source is None


async def test_a_replayed_submission_without_a_fix_cannot_erase_a_stored_one() -> None:
    event = _event()
    await _record_driver_position(event, _payload())

    await _record_driver_position(
        event, _payload(driver_phone_lat=None, driver_phone_lng=None),
    )

    assert event.driver_phone_lat == Decimal(str(REPORTED_LAT))
    assert event.driver_position_source == DriverPositionSource.DEVICE.value


async def test_a_provider_returning_none_leaves_the_real_capture_alone() -> None:
    event = _event()

    async def provider(_trip_id: uuid.UUID) -> None:
        return None

    demo_position.configure_demo_position_provider(provider)

    await _record_driver_position(event, _payload())

    assert event.driver_phone_lat == Decimal(str(REPORTED_LAT))
    assert event.driver_position_source == DriverPositionSource.DEVICE.value


async def test_a_failing_provider_never_breaks_a_submission() -> None:
    event = _event()

    async def provider(_trip_id: uuid.UUID) -> tuple[Decimal, Decimal]:
        raise RuntimeError("redis is down")

    demo_position.configure_demo_position_provider(provider)

    await _record_driver_position(event, _payload())

    assert event.driver_phone_lat == Decimal(str(REPORTED_LAT))
    assert event.driver_position_source == DriverPositionSource.DEVICE.value


async def test_the_provider_is_asked_about_this_events_own_trip() -> None:
    event = _event()
    asked: list[uuid.UUID] = []

    async def provider(trip_id: uuid.UUID) -> None:
        asked.append(trip_id)
        return None

    demo_position.configure_demo_position_provider(provider)

    await _record_driver_position(event, _payload())

    assert asked == [event.trip_id]


async def test_no_provider_configured_is_the_normal_path() -> None:
    assert demo_position.demo_position_provider_configured() is False
    assert await demo_position.staged_demo_position(uuid.uuid4()) is None
