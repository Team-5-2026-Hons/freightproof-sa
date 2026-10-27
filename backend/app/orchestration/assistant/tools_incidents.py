"""Incidents tool (coverage audit item 7, B35): "have we had any hijackings this month?", "who's investigating?".

`needs_attention` lists the OPEN incidents among what needs attention now. This is the incident register itself, as
the Incidents page lists it (`incidents.queries.list_incidents`, one call per status, the page's own read): open
(open + investigating), closed, or all; by type; and by when the incident was received. A separate tool, not more
inputs on `needs_attention`, because "what happened last month" is a different question from "what needs me now"
(the D5 rule, recorded as B35).

Never sent: an incident's summary or closure reason (a person typed them, spec §5.2). The outcome's CODE is fine.
"""

from typing import Literal

from pydantic import Field

from app.db.models.enums import IncidentStatus, IncidentType
from app.orchestration.assistant.results import IncidentsResult
from app.orchestration.assistant.tools_base import AssistantTool, ToolContext, ToolInput, ToolOutcome, expect, when_text
from app.orchestration.assistant.tools_trips import incident_line, incident_row
from app.orchestration.assistant.when import When, WhenError, resolve
from app.orchestration.incidents.queries import list_incidents
from app.schemas.assistant import IncidentListCard
from app.schemas.incidents import IncidentListFilters, IncidentRead

StatusGroup = Literal["open", "closed", "all"]
IncidentKind = Literal["hijacking", "parcel_shortage", "parcel_damage"]
_STATUSES: dict[StatusGroup, tuple[IncidentStatus, ...]] = {
    "open": (IncidentStatus.OPEN, IncidentStatus.INVESTIGATING),
    "closed": (IncidentStatus.CLOSED,),
    "all": (IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED),
}
MAX_ROWS = 25


class IncidentsInput(ToolInput):
    incident_status: StatusGroup = Field(description="open (open or investigating), closed, or all.")
    incident_type: IncidentKind | None = Field(description="Null for any.")
    when: When | None = Field(description="Only incidents received in this window (e.g. this_month). Null: any date.")


async def _incidents(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, IncidentsInput)
    window = None
    if inputs.when is not None:
        try:
            window = resolve(inputs.when, now=context.now).as_window()
        except WhenError as exc:
            return ToolOutcome.failed(str(exc))
    found: list[IncidentRead] = []
    for status in _STATUSES[inputs.incident_status]:
        found.extend(await list_incidents(
            context.db, organization_id=context.organization_id,
            filters=IncidentListFilters(
                status=status, incident_type=IncidentType(inputs.incident_type) if inputs.incident_type else None,
            ),
        ))
    if window is not None:
        found = [incident for incident in found if window[0] <= incident.received_at < window[1]]
    found.sort(key=lambda incident: incident.received_at, reverse=True)
    shown = found[:MAX_ROWS]
    truncated = len(found) > len(shown)
    result = IncidentsResult(
        status=inputs.incident_status, incident_type=inputs.incident_type,
        window=when_text(*window) if window else "any date", total=len(found), shown=len(shown), truncated=truncated,
        incidents=[incident_line(incident) for incident in shown],
    )
    title = f"{inputs.incident_status.capitalize()} incidents" if inputs.incident_status != "all" else "Incidents"
    card = IncidentListCard(title=title, rows=[incident_row(incident) for incident in shown], truncated=truncated)
    return ToolOutcome.done(result, card)


INCIDENT_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="incidents",
        description=(
            "The incident register, as the Incidents page lists it: open, closed or all; by type (hijacking, parcel "
            "shortage, parcel damage); received in a window. Each with its trip, status, who's investigating, outcome "
            "and unresolved parcels. Use for 'any hijackings this month', 'who's investigating INC1', 'closed incidents "
            "last month'. Never advise on responding: the incident page has the response guide."
        ),
        input_model=IncidentsInput,
        runner=_incidents,
    ),
)
