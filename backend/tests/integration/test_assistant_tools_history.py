"""One driver's or vehicle's trip history (assistant spec B31), counted as their own page lists them.

Tom asked "how many trips has tim done" on 21 Oct; there was no tool for it, and the model wrongly pointed to the
Analytics chat, which has no per-driver figures by design.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import TripStatus, VehicleType
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.orchestration.fleet.drivers import get_driver_detail
from app.schemas.assistant import HistoryCard
from tests.integration._fleet_seed import days_ago, new_driver, new_vehicle, not_started, operator_from_seed, other_operator, seed_trip

NOW = datetime.now(UTC)
_NULL_WHEN: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}


def _args(**fields: object) -> dict[str, object]:
    return {"driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None, "when": None, **fields}


async def _run(db: AsyncSession, organization_id: Any, arguments: dict[str, object]) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=organization_id, now=NOW, refs=RefBook())
    return await run_tool(context, name="trip_history", arguments=arguments)


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


async def test_driver_history_counts_by_status_as_their_page_lists_them(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    stops = [seed["origin"], seed["dest"]]
    tim = new_driver(operator.org.id)
    tim.full_name = "Timothy Gultig"
    db_session.add(tim)
    await db_session.flush()
    for days in (3, 10):
        await seed_trip(db_session, operator, stops=stops, start=days_ago(days), driver=tim)
    await seed_trip(db_session, operator, stops=stops, start=days_ago(5), driver=tim, status=TripStatus.CANCELLED)
    await seed_trip(db_session, operator, stops=stops, start=days_ago(0), driver=tim, status=TripStatus.ACTIVE, steps=not_started())
    await seed_trip(db_session, operator, stops=stops, start=days_ago(2))  # someone else's trip

    outcome = await _run(db_session, operator.org.id, _args(driver_name="Tim Giltig"))

    result = _result(outcome)
    assert result["who"]["label"] == "Timothy Gultig"
    assert (result["total"], result["completed"], result["cancelled"], result["live"], result["booked"]) == (4, 2, 1, 1, 0)
    assert result["window"] == "all time"
    assert "took part in" in result["counted_as"]
    page = await get_driver_detail(db_session, tim.id, operator.org.id)
    [card] = outcome.cards
    assert isinstance(card, HistoryCard)
    assert {row.trip_id for row in card.recent} == set(page.trip_ids)


async def test_vehicle_history_counts_trips_it_pulled_as_a_trailer(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trailer = new_vehicle(operator.org.id, VehicleType.TRAILER)
    db_session.add(trailer)
    await db_session.flush()
    await seed_trip(db_session, operator, stops=[seed["origin"], seed["dest"]], start=days_ago(4), trailers=(trailer,))

    result = _result(await _run(db_session, operator.org.id, _args(vehicle_name=trailer.registration)))

    assert (result["total"], result["completed"]) == (1, 1)
    assert "horse or trailer" in result["counted_as"]


async def test_history_in_a_window(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    stops = [seed["origin"], seed["dest"]]
    recent = await seed_trip(db_session, operator, stops=stops, start=days_ago(3))
    await seed_trip(db_session, operator, stops=stops, start=days_ago(40))

    result = _result(await _run(
        db_session, operator.org.id,
        _args(driver_name=seed["driver"].full_name, when={"preset": "range", **_NULL_WHEN,
              "day": days_ago(10).date().isoformat(), "end_day": days_ago(0).date().isoformat()}),
    ))

    assert result["total"] == 1
    assert [line["trip_reference"] for line in result["recent"]] == [recent.trip.trip_reference]


async def test_history_needs_exactly_one_record_and_never_ranks(seed: dict, db_session: AsyncSession) -> None:
    neither = await _run(db_session, seed["org"].id, _args())

    assert neither.error is not None and "ranking" in neither.error


async def test_history_never_finds_another_organisations_driver(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)
    other.driver.full_name = "Someone Elsewhere"
    await db_session.flush()

    outcome = await _run(db_session, seed["org"].id, _args(driver_name="Someone Elsewhere"))

    assert outcome.error is not None and "No driver" in outcome.error
