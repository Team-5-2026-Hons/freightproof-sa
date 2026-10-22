"""Drivers' licences and vehicles' discs expiring (assistant spec B29): the question the first version got wrong.

Tom asked "are any drivers or trucks licences expiring in the next 30 days?" on 21 Oct; the answer checked discs
only and claimed driver licence dates "are not recorded", while Timothy Gultig's licence expired in 2 days.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import today_sast
from app.db.models.enums import VehicleType
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.schemas.assistant import ExpiryListCard
from tests.integration._fleet_seed import new_driver, new_vehicle, operator_from_seed, other_operator

NOW = datetime.now(UTC)
TODAY = today_sast(NOW)


def _args(**fields: object) -> dict[str, object]:
    blank: dict[str, object] = {
        "within_days": None, "documents": ["driver_licence", "vehicle_disc"],
        "driver_name": None, "driver_ref": None, "vehicle_name": None, "vehicle_ref": None,
    }
    return {**blank, **fields}


async def _run(db: AsyncSession, organization_id: Any, arguments: dict[str, object]) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=organization_id, now=NOW, refs=RefBook())
    return await run_tool(context, name="expiring_documents", arguments=arguments)


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


async def _driver(db: AsyncSession, org_id: Any, name: str, expiry_in_days: int | None, *, active: bool = True) -> Any:
    driver = new_driver(org_id, license_expiry=None if expiry_in_days is None else TODAY + timedelta(days=expiry_in_days), is_active=active)
    driver.full_name = name
    db.add(driver)
    await db.flush()
    return driver


async def test_both_licences_and_discs_due_in_the_window_are_listed(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    await _driver(db_session, org, "Timothy Gultig", 2)
    await _driver(db_session, org, "Expired Driver", -5)
    await _driver(db_session, org, "Fine Driver", 100)
    await _driver(db_session, org, "Retired Driver", 1, active=False)
    await _driver(db_session, org, "No Date Driver", None)
    soon = new_vehicle(org, VehicleType.TRAILER, licence_disc_expiry=TODAY + timedelta(days=10))
    db_session.add_all([soon, new_vehicle(org, VehicleType.HORSE, licence_disc_expiry=TODAY + timedelta(days=200))])
    await db_session.flush()

    outcome = await _run(db_session, org, _args())

    result = _result(outcome)
    assert [line["label"] for line in result["driver_licences"]] == ["Expired Driver", "Timothy Gultig"]
    assert [line["expired"] for line in result["driver_licences"]] == [True, False]
    assert result["driver_licences"][1]["days_left"] == 2
    assert [line["label"] for line in result["vehicle_discs"]] == [soon.registration]
    assert result["drivers_without_date"] >= 1
    [card] = outcome.cards
    assert isinstance(card, ExpiryListCard) and card.within_days == 30
    assert {row.document for row in card.rows} == {"driver_licence", "vehicle_disc"}


async def test_only_driver_licences_when_asked(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    await _driver(db_session, org, "Timothy Gultig", 2)
    db_session.add(new_vehicle(org, VehicleType.TRAILER, licence_disc_expiry=TODAY + timedelta(days=3)))
    await db_session.flush()

    result = _result(await _run(db_session, org, _args(documents=["driver_licence"])))

    assert [line["label"] for line in result["driver_licences"]] == ["Timothy Gultig"]
    assert result["vehicle_discs"] == [] and result["vehicles_checked"] == 0


async def test_one_named_driver_gives_their_date_whatever_the_window(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    await _driver(db_session, org, "Timothy Gultig", 400)

    result = _result(await _run(db_session, org, _args(driver_name="Tim Giltig")))

    [line] = result["driver_licences"]
    assert (line["label"], line["days_left"], line["expired"]) == ("Timothy Gultig", 400, False)
    assert result["scope"] == "one driver"


async def test_never_lists_another_organisations_drivers(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)
    await _driver(db_session, other.org.id, "Their Driver", 1)

    result = _result(await _run(db_session, seed["org"].id, _args(documents=["driver_licence"])))

    assert "Their Driver" not in [line["label"] for line in result["driver_licences"]]


async def test_bad_window_and_two_records_error(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    operator = operator_from_seed(seed)

    too_long = await _run(db_session, org, _args(within_days=400))
    both = await _run(db_session, org, _args(driver_name=operator.driver.full_name, vehicle_name=operator.horse.registration))

    assert too_long.error is not None and "1 to 365" in too_long.error
    assert both.error is not None and "one driver or one vehicle" in both.error


async def test_never_sends_the_licence_number(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    driver = await _driver(db_session, org, "Timothy Gultig", 2)

    outcome = await _run(db_session, org, _args())

    assert driver.license_number not in str(outcome.result)
    assert driver.license_number not in "".join(card.model_dump_json() for card in outcome.cards)
