"""How many drivers, horses, trailers and depots (coverage audit item 4, B35): the pages' own lists, plus the inactive
counts those lists can't show."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import VehicleType
from app.db.models.organisations import Precinct
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.orchestration.fleet.drivers import list_drivers
from app.schemas.assistant import RosterCard
from tests.integration._fleet_seed import new_driver, new_vehicle, other_operator

NOW = datetime.now(UTC)


async def _run(db: AsyncSession, organization_id: Any, kinds: list[str]) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=organization_id, now=NOW, refs=RefBook())
    return await run_tool(context, name="roster", arguments={"kinds": kinds})


def _groups(outcome: ToolOutcome) -> dict[str, dict[str, Any]]:
    assert outcome.error is None and outcome.result is not None, outcome.error
    result: dict[str, Any] = outcome.result
    return {group["kind"]: group for group in result["groups"]}


async def test_roster_counts_active_like_the_lists_and_inactive_separately(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    db_session.add_all([
        new_driver(org), new_driver(org, is_active=False),
        new_vehicle(org, VehicleType.TRAILER), new_vehicle(org, VehicleType.TRAILER, is_active=False),
    ])
    await db_session.flush()
    listed = await list_drivers(db_session, org)

    groups = _groups(await _run(db_session, org, ["driver", "horse", "trailer"]))

    assert groups["driver"]["active_total"] == len(listed) == 2
    assert groups["driver"]["inactive_total"] == 1
    assert (groups["horse"]["active_total"], groups["horse"]["inactive_total"]) == (1, 0)
    assert (groups["trailer"]["active_total"], groups["trailer"]["inactive_total"]) == (1, 1)


async def test_roster_depots_own_and_shared_with_address_never_coordinates(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    other = await other_operator(db_session)
    tag = uuid.uuid4().hex[:6]
    db_session.add_all([
        Precinct(id=uuid.uuid4(), name=f"Ours {tag}", principal_organization_id=org, latitude="-26.1234567", longitude="28.7654321", address="1 Rail Rd, Durban"),
        Precinct(id=uuid.uuid4(), name=f"Shared {tag}", principal_organization_id=other.org.id, latitude="-33.1", longitude="18.1", is_shared=True),
        Precinct(id=uuid.uuid4(), name=f"Theirs {tag}", principal_organization_id=other.org.id, latitude="-33.2", longitude="18.2"),
    ])
    await db_session.flush()

    outcome = await _run(db_session, org, ["depot"])

    depots = {line["name"]: line for line in _groups(outcome)["depot"]["depots"]}
    assert depots[f"Ours {tag}"]["ownership"] == "ours" and depots[f"Ours {tag}"]["address"] == "1 Rail Rd, Durban"
    assert depots[f"Shared {tag}"]["ownership"] == "shared with us"
    assert f"Theirs {tag}" not in depots
    sent = str(outcome.result) + "".join(card.model_dump_json() for card in outcome.cards)
    assert "-26.1234567" not in sent and "28.7654321" not in sent
    [card] = outcome.cards
    assert isinstance(card, RosterCard)


async def test_roster_never_counts_another_organisations_drivers(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)
    db_session.add(new_driver(other.org.id, is_active=False))
    await db_session.flush()

    groups = _groups(await _run(db_session, seed["org"].id, ["driver"]))

    assert (groups["driver"]["active_total"], groups["driver"]["inactive_total"]) == (1, 0)
