"""The assistant's page-opening actions (spec §5.1 rows 9–11, D2, D2a–c, D4, B30): buttons that open a page and
never save anything. Parcel Perfect is faked where the tool calls it; CI never calls it."""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.periods import today_sast
from app.core.exceptions import ManifestNotFoundError, PPUnavailableError
from app.db.models.enums import TripStatus
from app.db.models.organisations import Precinct
from app.orchestration.assistant import tools_actions
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.schemas.assistant import FormPreviewCard, OpenPageAction, OpenTripFormAction, RecordRef
from tests.integration._fleet_seed import (
    PLANNED_ARRIVAL_MINUTE,
    Operator,
    new_driver,
    not_started,
    operator_from_seed,
    seed_trip,
)

NOW = datetime.now(UTC)
TOMORROW = today_sast(NOW) + timedelta(days=1)
_NULL_WHEN: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}


def _at(day: Any, time_of_day: str) -> dict[str, object]:
    return {**_NULL_WHEN, "preset": "date", "day": day.isoformat(), "time_of_day": time_of_day}


def _form(**fields: object) -> dict[str, object]:
    blank: dict[str, object] = {
        "mode": "empty_leg", "manifest_number": None, "driver_name": None, "driver_ref": None, "horse_name": None,
        "horse_ref": None, "trailer_names": [], "trailer_refs": [], "origin_name": None, "origin_ref": None,
        "destination_name": None, "destination_ref": None, "departure": None, "arrival": None,
    }
    return {**blank, **fields}


def _page(**fields: object) -> dict[str, object]:
    blank: dict[str, object] = {
        "page": "dashboard", "record_ref": None, "exceptions_severity": None, "search": None, "barcode": None, "waybill": None,
    }
    return {**blank, **fields}


async def _run(db: AsyncSession, operator: Operator, name: str, arguments: dict[str, object], refs: RefBook | None = None) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=operator.org.id, now=NOW, refs=refs or RefBook())
    return await run_tool(context, name=name, arguments=arguments)


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


async def _depots(db: AsyncSession, operator: Operator) -> tuple[Precinct, Precinct]:
    tag = uuid.uuid4().hex[:6]
    depots = (
        Precinct(id=uuid.uuid4(), name=f"Epping {tag}", principal_organization_id=operator.org.id, latitude="-33.93", longitude="18.53"),
        Precinct(id=uuid.uuid4(), name=f"Linbro {tag}", principal_organization_id=operator.org.id, latitude="-26.08", longitude="28.11"),
    )
    db.add_all(depots)
    await db.flush()
    return depots


async def test_empty_leg_form_fills_exactly_what_was_said(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    origin, dest = await _depots(db_session, operator)

    outcome = await _run(db_session, operator, "open_trip_form", _form(
        driver_name=seed["driver"].full_name, horse_name=seed["horse"].registration,
        origin_name=origin.name, destination_name=dest.name,
        departure=_at(TOMORROW, "17:00"), arrival=_at(TOMORROW + timedelta(days=1), "06:00"),
    ))

    result = _result(outcome)
    assert result["still_blank"] == [] and result["warnings"] == []
    assert "Never say a trip was created" in result["rule"]
    [action] = outcome.actions
    assert isinstance(action, OpenTripFormAction)
    params = action.params
    assert (params.mode, params.driver_id, params.horse_id) == ("empty_leg", seed["driver"].id, seed["horse"].id)
    assert (params.origin_precinct_id, params.destination_precinct_id) == (origin.id, dest.id)
    assert params.departure == f"{TOMORROW.isoformat()}T17:00"
    assert params.arrival == f"{(TOMORROW + timedelta(days=1)).isoformat()}T06:00"
    [card] = outcome.cards
    assert isinstance(card, FormPreviewCard) and card.driver is not None and card.driver.id == seed["driver"].id


async def test_empty_leg_without_arrival_leaves_it_blank(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)

    result = _result(await _run(db_session, operator, "open_trip_form", _form(departure=_at(TOMORROW, "17:00"))))

    assert set(result["still_blank"]) == {"driver", "horse", "origin", "destination", "arrival"}


async def test_two_matching_drivers_ask_back_with_no_button(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    for name in ("Tim Giltig", "Timothy Nkosi"):
        driver = new_driver(operator.org.id)
        driver.full_name = name
        db_session.add(driver)
    await db_session.flush()

    outcome = await _run(db_session, operator, "open_trip_form", _form(driver_name="Tim"))

    assert _result(outcome)["what"] == "driver"
    assert outcome.actions == ()


@pytest.mark.parametrize(
    ("departure", "arrival", "message"),
    [
        ({**_NULL_WHEN, "preset": "tomorrow"}, None, "needs a time of day"),
        (_at(today_sast(NOW) - timedelta(days=1), "08:00"), None, "already passed"),
        (_at(TOMORROW, "17:00"), _at(TOMORROW, "09:00"), "not after the departure"),
    ],
)
async def test_bad_times_are_sent_back_with_no_button(
    seed: dict, db_session: AsyncSession, departure: dict[str, object], arrival: dict[str, object] | None, message: str,
) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "open_trip_form", _form(departure=departure, arrival=arrival))

    assert outcome.error is not None and message in outcome.error
    assert outcome.actions == ()


async def test_a_clash_is_warned_before_the_click(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    departure = datetime.combine(TOMORROW, datetime.min.time(), tzinfo=UTC) + timedelta(hours=8)
    busy = await seed_trip(
        db_session, operator, stops=[seed["origin"], seed["dest"]], status=TripStatus.CREATED, steps=not_started(),
        start=departure + timedelta(hours=1) - timedelta(minutes=PLANNED_ARRIVAL_MINUTE),
    )

    result = _result(await _run(db_session, operator, "open_trip_form", _form(
        driver_name=seed["driver"].full_name, departure=_at(TOMORROW, "08:00"), arrival=_at(TOMORROW, "18:00"),
    )))

    assert any(busy.trip.trip_reference in warning and seed["driver"].full_name in warning for warning in result["warnings"])


async def test_a_licence_expiring_before_the_trip_ends_is_warned(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    driver = new_driver(operator.org.id, license_expiry=TOMORROW)
    driver.full_name = "Timothy Gultig"
    db_session.add(driver)
    await db_session.flush()

    result = _result(await _run(db_session, operator, "open_trip_form", _form(
        driver_name="Timothy Gultig", departure=_at(TOMORROW, "17:00"), arrival=_at(TOMORROW + timedelta(days=1), "06:00"),
    )))

    assert any("Timothy Gultig's licence expires" in warning for warning in result["warnings"])


async def test_manifest_already_on_a_live_trip_gets_no_button(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    live = await seed_trip(
        db_session, operator, stops=[seed["origin"], seed["dest"]], status=TripStatus.ACTIVE, steps=not_started(),
        start=NOW - timedelta(hours=1),
    )
    # A manifest key is all three parts or none (ck_trips_pp_manifest_all_or_none).
    live.trip.pp_manifest_issuer_account, live.trip.pp_manifest_origin_hub, live.trip.pp_manifest_number = "ACC001", "CPT", 81
    await db_session.flush()

    outcome = await _run(db_session, operator, "open_trip_form", _form(mode="manifest", manifest_number=81))

    assert outcome.error is not None and live.trip.trip_reference in outcome.error
    assert outcome.actions == ()


def _preview(*, can_create: bool = True) -> SimpleNamespace:
    hub = SimpleNamespace(precinct_name="Epping", hub_code="CPT")
    return SimpleNamespace(
        can_create=can_create, origin=hub, destination=SimpleNamespace(precinct_name="Linbro", hub_code="JNB"),
        totals=SimpleNamespace(waybills=3, parcels=48), planned_departure_at=None, expected_arrival_at=None,
        warnings=[SimpleNamespace(message="Every waybill is on another trip", blocking=True)],
    )


@pytest.mark.parametrize(
    ("behaviour", "outcome_check"),
    [
        ("missing", lambda outcome: outcome.error is not None and "no manifest 81" in outcome.error and outcome.actions == ()),
        ("blocked", lambda outcome: outcome.error is not None and "can't become a trip" in outcome.error),
        ("down", lambda outcome: outcome.error is None and "couldn't be checked" in outcome.result["warnings"][0] and outcome.actions),
        ("fine", lambda outcome: outcome.error is None and "3 waybills, 48 parcels" in outcome.result["manifest_route"]),
    ],
)
async def test_manifest_pre_check(
    seed: dict, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, behaviour: str, outcome_check: Any,
) -> None:
    async def fake_preview(db: Any, *, manifest_number: int, operator_organization_id: Any) -> Any:
        if behaviour == "missing":
            raise ManifestNotFoundError(manifest_number)
        if behaviour == "down":
            raise PPUnavailableError("down")
        return _preview(can_create=behaviour == "fine")

    monkeypatch.setattr(tools_actions, "preview_pp_manifest", fake_preview)

    outcome = await _run(db_session, operator_from_seed(seed), "open_trip_form", _form(mode="manifest", manifest_number=81))

    assert outcome_check(outcome)


async def test_manifest_mode_needs_its_number(seed: dict, db_session: AsyncSession) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "open_trip_form", _form(mode="manifest"))

    assert outcome.error is not None and "manifest_number" in outcome.error


async def test_open_page_for_a_record_and_a_filtered_list(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    refs = RefBook()
    tag = refs.tag(RecordRef(kind="driver", id=seed["driver"].id, label=seed["driver"].full_name))

    driver_page = await _run(db_session, operator, "open_page", _page(page="driver", record_ref=tag), refs)
    exceptions = await _run(db_session, operator, "open_page", _page(page="exceptions", exceptions_severity="critical"))

    [action] = driver_page.actions
    assert isinstance(action, OpenPageAction) and (action.page, action.record_id) == ("driver", seed["driver"].id)
    [listed] = exceptions.actions
    assert isinstance(listed, OpenPageAction) and listed.filters == {"severity": "critical"}


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        (_page(page="driver"), "needs record_ref"),
        (_page(page="dashboard", barcode="ABC"), "doesn't take barcode"),
        (_page(page="dashboard", record_ref="d1"), "is a list"),
    ],
)
async def test_open_page_refuses_what_the_page_cannot_take(
    seed: dict, db_session: AsyncSession, arguments: dict[str, object], message: str,
) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "open_page", arguments)

    assert outcome.error is not None and message in outcome.error


@pytest.mark.parametrize("what", ["precinct", "driver", "vehicle"])
async def test_open_page_add_forms_open_empty(seed: dict, db_session: AsyncSession, what: str) -> None:
    outcome = await _run(db_session, operator_from_seed(seed), "open_page", _page(page=f"add_{what}"))

    [action] = outcome.actions
    assert isinstance(action, OpenPageAction)
    assert (action.page, action.record_id, action.filters, action.label) == (f"add_{what}", None, {}, f"Open the Add {what} form")


@pytest.mark.parametrize("page", ["trips", "sla"])
async def test_open_page_never_offers_a_page_that_does_not_exist_or_has_no_data(
    seed: dict, db_session: AsyncSession, page: str,
) -> None:
    """No trips list page exists (live trips are on the Dashboard) and /sla always shows "No data" (audit L0, S1)."""
    outcome = await _run(db_session, operator_from_seed(seed), "open_page", _page(page=page))

    assert outcome.error is not None and "Invalid input" in outcome.error


@pytest.mark.parametrize(("on", "label", "filters"), [(True, "Ask in Analytics", {"ask": "On-time rate?"}), (False, "Open Analytics", {})])
async def test_analytics_redirect_carries_the_question_when_that_chat_is_on(
    seed: dict, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, on: bool, label: str, filters: dict[str, str],
) -> None:
    monkeypatch.setattr(tools_actions, "analytics_chat_enabled", lambda: on)

    outcome = await _run(db_session, operator_from_seed(seed), "analytics_redirect", {"question": " On-time rate? "})

    [action] = outcome.actions
    assert isinstance(action, OpenPageAction)
    assert (action.label, action.page, action.filters) == (label, "analytics", filters)
