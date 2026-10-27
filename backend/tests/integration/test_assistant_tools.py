"""The assistant's trip and crew tools against a real database (spec §5.1 rows 1–4, §8.1, B5).

Each tool reuses a page's own service, so these tests check what the tool adds: the status groups,
windows and filters, the "which one?" choice, the trimmed result, and that another organisation's
trips never appear.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionType, TripStatus, VehicleType
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.assistant.refs import RefBook
from app.orchestration.exceptions.queries import list_review_queue
from app.orchestration.assistant.tools import TOOLS_BY_NAME, run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.schemas.assistant import BookingsCard, ChooseCard, TripCard, TripListCard
from tests.integration._fleet_seed import (
    ARRIVAL_MINUTE,
    PLANNED_ARRIVAL_MINUTE,
    Operator,
    add_exception,
    at_sast,
    new_driver,
    new_vehicle,
    not_started,
    operator_from_seed,
    other_operator,
    seed_trip,
    today_sast,
)

NOW = datetime.now(UTC)
_NULL_WHEN: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}


def _when(preset: str, **fields: object) -> dict[str, object]:
    return {"preset": preset, **_NULL_WHEN, **fields}


def _trips_args(**fields: object) -> dict[str, object]:
    blank: dict[str, object] = {
        "when": None, "which_time": None, "overdue_only": False, "precinct_name": None, "precinct_ref": None,
        "driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None,
    }
    return {"status_group": "active", **blank, **fields}


def _crew_args(**fields: object) -> dict[str, object]:
    blank: dict[str, object] = {"driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None}
    return {**blank, "when": _when("now"), **fields}


async def _run(db: AsyncSession, operator: Operator, name: str, arguments: dict[str, object]) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=operator.org.id, now=NOW, refs=RefBook())
    return await run_tool(context, name=name, arguments=arguments)


async def _trip(
    db: AsyncSession,
    operator: Operator,
    seed: dict[str, Any],
    *,
    status: TripStatus,
    arrival: datetime,
    driver: Driver | None = None,
    trailers: tuple[Vehicle, ...] = (),
) -> Trip:
    """A trip whose planned arrival is `arrival`. Not started, so nothing has actually arrived."""
    seeded = await seed_trip(
        db, operator, stops=[seed["origin"], seed["dest"]], status=status, steps=not_started(),
        start=arrival - timedelta(minutes=PLANNED_ARRIVAL_MINUTE), driver=driver, trailers=trailers,
    )
    return seeded.trip


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


def _refs(result: dict[str, Any]) -> set[str]:
    return {trip["trip_reference"] for trip in result["trips"]}


async def _driver(db: AsyncSession, operator: Operator, name: str) -> Driver:
    driver = new_driver(operator.org.id)
    driver.full_name = name
    db.add(driver)
    await db.flush()
    return driver


async def test_trips_active_counts_like_the_dashboard(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    booked = await _trip(db_session, operator, seed, status=TripStatus.CREATED, arrival=NOW + timedelta(days=1))
    moving = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=2))
    held = await _trip(db_session, operator, seed, status=TripStatus.EXCEPTION_HOLD, arrival=NOW + timedelta(hours=3))
    await _trip(db_session, operator, seed, status=TripStatus.CLOSED, arrival=NOW - timedelta(days=1))

    outcome = await _run(db_session, operator, "trips", _trips_args())

    result = _result(outcome)
    assert (result["total"], result["on_the_road"], result["booked"], result["on_hold"]) == (3, 1, 1, 1)
    assert _refs(result) == {booked.trip_reference, moving.trip_reference, held.trip_reference}
    [card] = outcome.cards
    assert isinstance(card, TripListCard) and card.total == 3
    assert card.full_list == "dashboard"


async def test_trips_arriving_tomorrow_uses_planned_arrival_in_sast(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    tomorrow = today_sast() + timedelta(days=1)
    due = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=at_sast(tomorrow, 10))
    await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=at_sast(tomorrow + timedelta(days=1), 10))

    outcome = await _run(db_session, operator, "trips", _trips_args(when=_when("tomorrow"), which_time="arrival"))

    assert _refs(_result(outcome)) == {due.trip_reference}


async def test_trips_overdue_is_live_past_planned_arrival(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    late = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW - timedelta(hours=2))
    await _trip(db_session, operator, seed, status=TripStatus.CREATED, arrival=NOW - timedelta(hours=2))
    await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=2))

    every = _result(await _run(db_session, operator, "trips", _trips_args()))
    only = _result(await _run(db_session, operator, "trips", _trips_args(overdue_only=True)))

    assert every["overdue_total"] == 1
    assert _refs(only) == {late.trip_reference}
    assert only["trips"][0]["overdue"] is True


async def test_trips_closed_list_points_to_trip_history(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    await _trip(db_session, operator, seed, status=TripStatus.CLOSED, arrival=NOW - timedelta(hours=5))

    outcome = await _run(db_session, operator, "trips", _trips_args(status_group="closed", when=_when("today")))

    [card] = outcome.cards
    assert isinstance(card, TripListCard) and card.full_list == "history"


async def test_trips_closed_last_week_counts_by_closed_date_like_trip_history(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    closed_in = await _trip(db_session, operator, seed, status=TripStatus.CLOSED, arrival=NOW - timedelta(days=30))
    closed_in.closed_at = NOW - timedelta(days=2)
    closed_out = await _trip(db_session, operator, seed, status=TripStatus.CLOSED, arrival=NOW - timedelta(days=2))
    closed_out.closed_at = NOW + timedelta(minutes=1)
    await db_session.flush()

    result = _result(await _run(
        db_session, operator, "trips",
        _trips_args(status_group="closed", when=_when("last_n_days", n=7), which_time="closed"),
    ))

    assert _refs(result) == {closed_in.trip_reference}
    assert "definition" not in result
    [line] = result["trips"]
    assert line["closed"]


async def test_which_time_closed_is_only_for_finished_trips(seed: dict, db_session: AsyncSession) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "trips", _trips_args(when=_when("today"), which_time="closed"))

    assert outcome.error is not None and "closed and cancelled" in outcome.error


async def test_trips_closed_without_a_window_errors(seed: dict, db_session: AsyncSession) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "trips", _trips_args(status_group="closed"))

    assert outcome.error is not None and "need when" in outcome.error


async def test_trips_one_moment_is_not_a_window(seed: dict, db_session: AsyncSession) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "trips", _trips_args(when=_when("now")))

    assert outcome.error is not None and "not one moment" in outcome.error


async def test_trips_driver_filter_and_choice_between_two(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    tim = await _driver(db_session, operator, "Tim Giltig")
    timothy = await _driver(db_session, operator, "Timothy Nkosi")
    tims_trip = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1), driver=tim)
    await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1), driver=timothy)

    exact = _result(await _run(db_session, operator, "trips", _trips_args(driver_name="tim giltig")))
    vague = await _run(db_session, operator, "trips", _trips_args(driver_name="Tim"))

    assert _refs(exact) == {tims_trip.trip_reference}
    choice = _result(vague)["what"], {option["label"] for option in _result(vague)["options"]}
    assert choice == ("driver", {"Tim Giltig", "Timothy Nkosi"})
    [card] = vague.cards
    assert isinstance(card, ChooseCard) and {option.id for option in card.options} == {tim.id, timothy.id}


async def test_trips_never_show_another_orgs_trips(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    other = await other_operator(db_session)
    await _trip(db_session, other, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))

    result = _result(await _run(db_session, operator, "trips", _trips_args()))

    assert result["total"] == 0


async def test_trip_status_by_suffix_counts_exceptions_waiting(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trip = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))
    kind = next(iter(ExceptionType))
    await add_exception(
        db_session, trip, exception_type=kind, severity=ExceptionSeverity.CRITICAL,
        created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    await add_exception(db_session, trip, exception_type=kind, severity=ExceptionSeverity.WARNING, created_at=NOW)

    outcome = await _run(
        db_session, operator, "trip_status",
        {"trip_reference": trip.trip_reference[-8:].lower(), "trip_ref": None, "manifest_number": None},
    )

    result = _result(outcome)
    assert result["trip"]["trip_reference"] == trip.trip_reference
    assert (result["open_exceptions"]["critical"], result["open_exceptions"]["warning"]) == (1, 0)
    assert result["open_exceptions"]["types"] == [kind.value]
    assert result["stops"] == [seed["origin"].name, seed["dest"].name]
    [card] = outcome.cards
    assert isinstance(card, TripCard) and card.trip.trip_id == trip.id


async def test_trip_status_has_the_trip_pages_info_and_stored_integrity(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    seeded = await seed_trip(db_session, operator, stops=[seed["origin"], seed["dest"]], start=NOW - timedelta(days=2))

    outcome = await _run(
        db_session, operator, "trip_status",
        {"trip_reference": seeded.trip.trip_reference, "trip_ref": None, "manifest_number": None},
    )

    result = _result(outcome)
    assert result["delivery_confirmed"] is not None and result["closed"] is not None
    assert ARRIVAL_MINUTE == PLANNED_ARRIVAL_MINUTE and result["arrival_delay"] == "on time"
    integrity = result["record_integrity"]
    assert (integrity["phase_receipts_owed"], integrity["phase_receipts_anchored"], integrity["phase_receipts_failed"]) == (3, 3, 0)
    assert integrity["journey_lock_anchored"] is False
    assert "Never say the record is untampered" in integrity["rule"]
    [card] = outcome.cards
    assert isinstance(card, TripCard) and card.receipts_anchored == 3 and card.delivery_confirmed_at is not None


async def test_trip_status_unknown_manifest_errors(seed: dict, db_session: AsyncSession) -> None:
    outcome = await _run(
        db_session, operator_from_seed(seed), "trip_status",
        {"trip_reference": None, "trip_ref": None, "manifest_number": 987654},
    )

    assert outcome.error is not None and "manifest 987654" in outcome.error


async def test_needs_attention_ranks_critical_first(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    warned = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))
    critical = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))
    await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))
    kind = next(iter(ExceptionType))
    for trip, severity in ((warned, ExceptionSeverity.WARNING), (critical, ExceptionSeverity.CRITICAL)):
        await add_exception(
            db_session, trip, exception_type=kind, severity=severity,
            created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
        )

    every = _result(await _run(db_session, operator, "needs_attention", {"severity_at_least": None}))
    worst = _result(await _run(db_session, operator, "needs_attention", {"severity_at_least": "critical"}))

    assert [trip["trip_reference"] for trip in every["trips"]] == [critical.trip_reference, warned.trip_reference]
    assert _refs(worst) == {critical.trip_reference}


async def test_needs_attention_queue_counts_every_trip_like_the_exceptions_page(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    live = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=1))
    finished = await _trip(db_session, operator, seed, status=TripStatus.CLOSED, arrival=NOW - timedelta(days=1))
    kind = next(iter(ExceptionType))
    for trip, severity in ((live, ExceptionSeverity.WARNING), (finished, ExceptionSeverity.CRITICAL)):
        await add_exception(
            db_session, trip, exception_type=kind, severity=severity,
            created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
        )
    page = await list_review_queue(db_session, organization_id=operator.org.id)

    outcome = await _run(db_session, operator, "needs_attention", {"severity_at_least": None})

    queue = _result(outcome)["review_queue"]
    assert queue["total"] == len(page) == 2
    assert (queue["critical"], queue["warning"], queue["on_finished_trips"], queue["unclaimed"]) == (1, 1, 1, 2)
    assert outcome.cards[0].type == "review_queue"


async def test_crew_bookings_driver_busy_now_and_free_driver(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trip = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=3))
    free = await _driver(db_session, operator, "Sipho Mokoena")

    busy = await _run(db_session, operator, "crew_bookings", _crew_args(driver_name=seed["driver"].full_name))
    idle = _result(await _run(db_session, operator, "crew_bookings", _crew_args(driver_name=free.full_name)))

    booked = _result(busy)
    assert booked["nothing_booked"] is False
    assert [booking["trip_reference"] for booking in booked["bookings"]] == [trip.trip_reference]
    assert idle["nothing_booked"] is True and "never 'available'" in idle["wording_rule"]
    [card] = busy.cards
    assert isinstance(card, BookingsCard) and card.who.id == seed["driver"].id


async def test_crew_bookings_trailer_in_the_next_week(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trailer = new_vehicle(operator.org.id, VehicleType.TRAILER)
    db_session.add(trailer)
    await db_session.flush()
    trip = await _trip(
        db_session, operator, seed, status=TripStatus.CREATED, arrival=NOW + timedelta(days=3), trailers=(trailer,),
    )

    outcome = await _run(
        db_session, operator, "crew_bookings",
        _crew_args(vehicle_name=trailer.registration.lower(), when=_when("next_n_days", n=7)),
    )

    result = _result(outcome)
    assert result["who"]["kind"] == "trailer"
    assert [booking["trip_reference"] for booking in result["bookings"]] == [trip.trip_reference]


async def test_crew_bookings_needs_exactly_one_of_driver_or_vehicle(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)

    neither = await _run(db_session, operator, "crew_bookings", _crew_args())
    both = await _run(db_session, operator, "crew_bookings", _crew_args(driver_name="x", vehicle_name="y"))

    assert neither.error is not None and both.error is not None


async def test_run_tool_unknown_tool_and_extra_field_error(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)

    unknown = await _run(db_session, operator, "drop_tables", {})
    extra = await _run(db_session, operator, "needs_attention", {"severity_at_least": None, "organization_id": "x"})

    assert unknown.error == "Unknown tool: drop_tables"
    assert extra.error is not None and "organization_id" in extra.error


async def test_tool_results_never_carry_personal_numbers_or_typed_text(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trip = await _trip(db_session, operator, seed, status=TripStatus.ACTIVE, arrival=NOW + timedelta(hours=3))
    exception = await add_exception(
        db_session, trip, exception_type=next(iter(ExceptionType)), severity=ExceptionSeverity.CRITICAL,
        created_at=NOW, review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    driver = seed["driver"]
    calls: list[tuple[str, dict[str, object]]] = [
        ("trips", _trips_args()),
        ("trip_status", {"trip_reference": trip.trip_reference, "trip_ref": None, "manifest_number": None}),
        ("needs_attention", {"severity_at_least": None}),
        ("crew_bookings", _crew_args(driver_name=driver.full_name)),
    ]
    assert {name for name, _ in calls} <= set(TOOLS_BY_NAME)

    for name, arguments in calls:
        outcome = await _run(db_session, operator, name, arguments)
        sent = json.dumps(_result(outcome)) + "".join(card.model_dump_json() for card in outcome.cards)
        for secret in (driver.id_number, driver.phone_number, driver.license_number, exception.description):
            assert secret not in sent, f"{name} leaked {secret!r}"
        assert str(driver.id) not in json.dumps(outcome.result), f"{name} sent a database id to the model"
