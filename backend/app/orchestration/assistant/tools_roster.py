"""Roster tool (coverage audit item 4, B35): how many drivers, horses, trailers and depots there are.

Active drivers and vehicles come from the Drivers and Vehicles pages' own reads (`fleet.drivers.list_drivers`,
`fleet.vehicles.list_vehicles`), so the counts are the lists' counts. Those reads return ACTIVE records only, so the
pages can't list inactive ones (their "Inactive only" filter has nothing to show: an existing app gap, reported to
Tom, not changed here under rule 15); the inactive totals are counted here directly, read-only.

Depots are the Precincts page's read (`fleet.precincts.list_precincts`: the organisation's own plus shared ones),
with name, address and whether they're ours. Never coordinates (spec §5.2).
"""

from typing import Literal

from pydantic import Field
from sqlalchemy import func, select

from app.db.models.enums import VehicleType
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.orchestration.assistant.results import CrewName, DepotLine, RosterGroup, RosterResult
from app.orchestration.assistant.tools_base import AssistantTool, ToolContext, ToolInput, ToolOutcome, expect
from app.orchestration.fleet.drivers import list_drivers
from app.orchestration.fleet.precincts import list_precincts
from app.orchestration.fleet.vehicles import list_vehicles
from app.schemas.assistant import RecordRef, RosterCard, RosterDepot, RosterGroupCard

RosterKind = Literal["driver", "horse", "trailer", "depot"]
MAX_NAMES = 40
LISTS_RULE = (
    "Counts are of active records, as the Drivers and Vehicles pages list them; inactive ones are kept on record but "
    "not listed there. Depots are our own and those shared with us, as the Precincts page lists them."
)


class RosterInput(ToolInput):
    kinds: list[RosterKind] = Field(min_length=1, description="driver, horse, trailer and/or depot.")


async def _inactive(context: ToolContext, kind: RosterKind) -> int:
    if kind == "driver":
        query = select(func.count(Driver.id)).where(
            Driver.organization_id == context.organization_id, Driver.is_active.is_(False),
        )
    else:
        query = select(func.count(Vehicle.id)).where(
            Vehicle.organization_id == context.organization_id, Vehicle.is_active.is_(False),
            Vehicle.vehicle_type == (VehicleType.HORSE if kind == "horse" else VehicleType.TRAILER),
        )
    return int((await context.db.execute(query)).scalar_one())


async def _crew_group(context: ToolContext, kind: RosterKind) -> tuple[RosterGroup, RosterGroupCard]:
    if kind == "driver":
        records = [RecordRef(kind="driver", id=d.id, label=d.full_name) for d in await list_drivers(context.db, context.organization_id)]
    else:
        wanted = VehicleType.HORSE if kind == "horse" else VehicleType.TRAILER
        records = [
            RecordRef(kind="vehicle", id=v.id, label=v.registration, detail=wanted.value)
            for v in await list_vehicles(context.db, context.organization_id) if VehicleType(v.vehicle_type) == wanted
        ]
    inactive = await _inactive(context, kind)
    shown = records[:MAX_NAMES]
    truncated = len(records) > len(shown)
    group = RosterGroup(
        kind=kind, active_total=len(records), inactive_total=inactive,
        names=[CrewName(ref=context.refs.tag(record), label=record.label) for record in shown], depots=[], truncated=truncated,
    )
    card = RosterGroupCard(kind=kind, active_total=len(records), inactive_total=inactive, records=shown, depots=[], truncated=truncated)
    return group, card


async def _depot_group(context: ToolContext) -> tuple[RosterGroup, RosterGroupCard]:
    precincts = await list_precincts(context.db, context.organization_id)
    shown = precincts[:MAX_NAMES]
    lines: list[DepotLine] = []
    depots: list[RosterDepot] = []
    for precinct in shown:
        record = RecordRef(kind="precinct", id=precinct.id, label=precinct.name)
        owned = precinct.principal_organization_id == context.organization_id
        lines.append(DepotLine(
            ref=context.refs.tag(record), name=precinct.name, address=precinct.address,
            ownership="ours" if owned else "shared with us",
        ))
        depots.append(RosterDepot(depot=record, address=precinct.address, owned=owned))
    truncated = len(precincts) > len(shown)
    group = RosterGroup(kind="depot", active_total=len(precincts), inactive_total=None, names=[], depots=lines, truncated=truncated)
    card = RosterGroupCard(kind="depot", active_total=len(precincts), inactive_total=None, records=[], depots=depots, truncated=truncated)
    return group, card


async def _roster(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, RosterInput)
    groups: list[RosterGroup] = []
    cards: list[RosterGroupCard] = []
    for kind in dict.fromkeys(inputs.kinds):
        group, card = await (_depot_group(context) if kind == "depot" else _crew_group(context, kind))
        groups.append(group)
        cards.append(card)
    return ToolOutcome.done(RosterResult(groups=groups, lists_rule=LISTS_RULE), RosterCard(groups=cards))


ROSTER_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="roster",
        description=(
            "How many active drivers, horses, trailers and depots there are, with their names (and each depot's "
            "address, ours or shared), plus how many drivers and vehicles are marked inactive. Use for 'how many "
            "drivers do we have', 'which depots do we use', 'how many trailers are out of service'. Never coordinates."
        ),
        input_model=RosterInput,
        runner=_roster,
    ),
)
