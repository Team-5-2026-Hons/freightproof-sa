"""The incident register (coverage audit item 7, B35): open, closed or all, by type and date, as the Incidents page
lists it; never the typed summary or closure reason."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    IncidentConfidence,
    IncidentOutcome,
    IncidentReportChannel,
    IncidentReporterRole,
    IncidentStatus,
    IncidentType,
)
from app.db.models.incidents import Incident
from app.orchestration.assistant.refs import RefBook
from app.orchestration.assistant.tools import run_tool
from app.orchestration.assistant.tools_base import ToolContext, ToolOutcome
from app.schemas.assistant import IncidentListCard
from tests.integration._fleet_seed import days_ago, operator_from_seed, seed_trip

NOW = datetime.now(UTC)
_NULL_WHEN: dict[str, object] = {"n": None, "weekday": None, "day": None, "end_day": None, "time_of_day": None}
TYPED = "The driver said the truck was stopped near Beaufort West"


async def _incident(db: AsyncSession, seed: dict[str, Any], number: int, *, kind: IncidentType, received: datetime, closed: bool) -> Incident:
    trip = (await seed_trip(db, operator_from_seed(seed), stops=[seed["origin"], seed["dest"]], start=days_ago(40))).trip
    incident = Incident(
        id=uuid.uuid4(), trip_id=trip.id, incident_number=number, incident_type=kind, summary=TYPED,
        reporter_role=IncidentReporterRole.DRIVER, report_channel=IncidentReportChannel.PHONE, received_at=received,
        recorded_by_user_id=seed["dispatcher"].id, status=IncidentStatus.CLOSED if closed else IncidentStatus.OPEN,
        confidence=IncidentConfidence.REPORTED, assigned_to_user_id=seed["dispatcher"].id,
        outcome=IncidentOutcome.CARGO_RECOVERED if closed else None, closed_at=received + timedelta(days=1) if closed else None,
        closure_reason="Recovered by the tracking company" if closed else None,
    )
    db.add(incident)
    await db.flush()
    return incident


def _result(outcome: ToolOutcome) -> dict[str, Any]:
    assert outcome.error is None, outcome.error
    assert outcome.result is not None
    return outcome.result


async def _run(db: AsyncSession, organization_id: Any, **fields: object) -> ToolOutcome:
    context = ToolContext(db=db, organization_id=organization_id, now=NOW, refs=RefBook())
    arguments: dict[str, object] = {"incident_status": "all", "incident_type": None, "when": None, **fields}
    return await run_tool(context, name="incidents", arguments=arguments)


async def test_incidents_by_status_type_and_window(seed: dict, db_session: AsyncSession) -> None:
    org = seed["org"].id
    await _incident(db_session, seed, 1, kind=IncidentType.HIJACKING, received=NOW - timedelta(days=3), closed=True)
    await _incident(db_session, seed, 2, kind=IncidentType.HIJACKING, received=NOW - timedelta(days=60), closed=False)
    await _incident(db_session, seed, 3, kind=IncidentType.PARCEL_SHORTAGE, received=NOW - timedelta(days=2), closed=False)

    recent_hijackings = await _run(
        db_session, org, incident_type="hijacking", when={**_NULL_WHEN, "preset": "last_n_days", "n": 30},
    )
    open_ones = await _run(db_session, org, incident_status="open")

    result = _result(recent_hijackings)
    assert [line["reference"] for line in result["incidents"]] == ["INC1"]
    line = result["incidents"][0]
    assert (line["status"], line["outcome"], line["investigated_by"]) == ("closed", "cargo_recovered", seed["dispatcher"].full_name)
    assert {line["reference"] for line in _result(open_ones)["incidents"]} == {"INC2", "INC3"}
    [card] = recent_hijackings.cards
    assert isinstance(card, IncidentListCard) and card.title == "Incidents"


async def test_incidents_never_send_the_typed_summary_or_closure_reason(seed: dict, db_session: AsyncSession) -> None:
    await _incident(db_session, seed, 1, kind=IncidentType.HIJACKING, received=NOW - timedelta(days=3), closed=True)

    outcome = await _run(db_session, seed["org"].id)

    sent = str(outcome.result) + "".join(card.model_dump_json() for card in outcome.cards)
    assert TYPED not in sent and "Recovered by the tracking company" not in sent
