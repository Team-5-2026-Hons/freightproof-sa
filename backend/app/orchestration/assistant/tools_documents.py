"""Expiring documents tool (assistant spec B29): drivers' licences and vehicles' licence discs.

"Are any drivers' or trucks' licences expiring in the next 30 days?" needs both: a driver's licence expiry
(`Driver.license_expiry`, the Drivers page's Licence expiry column) and a vehicle's disc
(`Vehicle.licence_disc_expiry`). The first version checked only discs, and the model then told Tom that driver
licence dates "are not recorded" (21 Oct): a made-up absence. One tool now answers both, for the whole fleet or
one named driver or vehicle.

Active records only, as the Drivers and Vehicles pages' pickers list them. Expired documents are always included
(they're the most urgent). The default window is the drivers list's red band (`EXPIRY_BAND_EDGES_DAYS[0]`, 30
days), so "expiring soon" means what the page's red dates mean. Records with no date recorded are counted, so a
"none expiring" answer can say how many it couldn't check.

The date is a document's expiry, not personal detail; the licence NUMBER is never sent (spec §5.2).
"""

from collections.abc import Sequence
from datetime import date, timedelta
from typing import Literal

from pydantic import Field
from sqlalchemy import select

from app.analytics.fleet.periods import today_sast
from app.db.models.enums import VehicleType
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.orchestration.assistant.resolve import EntityKind
from app.orchestration.assistant.results import ExpiryLine, ExpiryResult
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    record_of,
)
from app.orchestration.assistant.tools_fleet import DISC_WARNING_DAYS
from app.orchestration.fleet.drivers import list_drivers
from app.orchestration.fleet.vehicles import list_vehicles
from app.schemas.assistant import DocumentKind, ExpiryListCard, ExpiryRow, RecordRef

MAX_WINDOW_DAYS = 365
MAX_ROWS = 25
_DOCUMENT_WORDS: dict[DocumentKind, str] = {"driver_licence": "driver licence", "vehicle_disc": "vehicle disc"}

Document = Literal["driver_licence", "vehicle_disc"]


def _day(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b %Y}"


def _line(context: ToolContext, record: RecordRef, document: DocumentKind, expiry: date | None, today: date) -> ExpiryLine:
    return ExpiryLine(
        ref=context.refs.tag(record), label=record.label, document=_DOCUMENT_WORDS[document],
        detail=record.detail if document == "vehicle_disc" else None,
        expiry=_day(expiry) if expiry else None, expired=expiry < today if expiry else None,
        days_left=(expiry - today).days if expiry else None,
    )


def _row(record: RecordRef, document: DocumentKind, expiry: date | None, today: date) -> ExpiryRow:
    return ExpiryRow(record=record, document=document, expiry=expiry, expired=bool(expiry and expiry < today))


class ExpiringDocumentsInput(ToolInput):
    within_days: int | None = Field(description=f"Expired or expiring within this many days, 1 to {MAX_WINDOW_DAYS}. Null = {DISC_WARNING_DAYS}.")
    documents: list[Document] = Field(
        min_length=1, description="driver_licence and/or vehicle_disc. 'Licences' for drivers and trucks: both.",
    )
    driver_name: str | None = Field(description="One driver instead of the fleet, as typed.")
    driver_ref: str | None = Field(description="One driver, as a ref.")
    vehicle_name: str | None = Field(description="One vehicle instead of the fleet, registration as typed.")
    vehicle_ref: str | None = Field(description="One vehicle, as a ref.")


async def _one_record(context: ToolContext, inputs: ExpiringDocumentsInput) -> ToolOutcome:
    """One named driver's licence or vehicle's disc, whatever its date."""
    asks_driver = inputs.driver_name is not None or inputs.driver_ref is not None
    what: EntityKind = "driver" if asks_driver else "vehicle"
    match = await find(
        context, what, name=inputs.driver_name if asks_driver else inputs.vehicle_name,
        ref=inputs.driver_ref if asks_driver else inputs.vehicle_ref,
    )
    if match is None or isinstance(match, ToolOutcome):
        return match or ToolOutcome.failed("Give a driver or a vehicle.")
    record = record_of(match)
    today = today_sast(context.now)
    if asks_driver:
        expiry = (await context.db.execute(select(Driver.license_expiry).where(Driver.id == record.id))).scalar_one()
        document: DocumentKind = "driver_licence"
    else:
        expiry = (await context.db.execute(select(Vehicle.licence_disc_expiry).where(Vehicle.id == record.id))).scalar_one()
        document = "vehicle_disc"
    line = _line(context, record, document, expiry, today)
    result = ExpiryResult(
        scope=f"one {what}", driver_licences=[line] if asks_driver else [], vehicle_discs=[] if asks_driver else [line],
        drivers_checked=int(asks_driver), vehicles_checked=int(not asks_driver),
        drivers_without_date=int(asks_driver and expiry is None), vehicles_without_date=int(not asks_driver and expiry is None),
        truncated=False,
    )
    card = ExpiryListCard(
        within_days=None, rows=[_row(record, document, expiry, today)], without_date=int(expiry is None), truncated=False,
    )
    return ToolOutcome.done(result, card)


def _due(dated: Sequence[tuple[RecordRef, date | None]], limit: date) -> list[tuple[RecordRef, date]]:
    """The records whose date is on or before `limit` (expired ones included), soonest first."""
    due = [(record, expiry) for record, expiry in dated if expiry is not None and expiry <= limit]
    return sorted(due, key=lambda pair: (pair[1], pair[0].label))


async def _fleet(context: ToolContext, inputs: ExpiringDocumentsInput, days: int) -> ToolOutcome:
    today = today_sast(context.now)
    limit = today + timedelta(days=days)
    drivers: list[tuple[RecordRef, date | None]] = []
    vehicles: list[tuple[RecordRef, date | None]] = []
    if "driver_licence" in inputs.documents:
        drivers = [
            (RecordRef(kind="driver", id=driver.id, label=driver.full_name), driver.license_expiry)
            for driver in await list_drivers(context.db, context.organization_id)
        ]
    if "vehicle_disc" in inputs.documents:
        vehicles = [
            (RecordRef(kind="vehicle", id=v.id, label=v.registration, detail=VehicleType(v.vehicle_type).value), v.licence_disc_expiry)
            for v in await list_vehicles(context.db, context.organization_id)
        ]
    due_drivers, due_vehicles = _due(drivers, limit), _due(vehicles, limit)
    truncated = len(due_drivers) > MAX_ROWS or len(due_vehicles) > MAX_ROWS
    shown_drivers, shown_vehicles = due_drivers[:MAX_ROWS], due_vehicles[:MAX_ROWS]
    result = ExpiryResult(
        scope=f"expired or expiring within {days} days",
        driver_licences=[_line(context, record, "driver_licence", expiry, today) for record, expiry in shown_drivers],
        vehicle_discs=[_line(context, record, "vehicle_disc", expiry, today) for record, expiry in shown_vehicles],
        drivers_checked=len(drivers), vehicles_checked=len(vehicles),
        drivers_without_date=sum(expiry is None for _, expiry in drivers),
        vehicles_without_date=sum(expiry is None for _, expiry in vehicles),
        truncated=truncated,
    )
    rows = [_row(record, "driver_licence", expiry, today) for record, expiry in shown_drivers] + [
        _row(record, "vehicle_disc", expiry, today) for record, expiry in shown_vehicles
    ]
    without_date = result.drivers_without_date + result.vehicles_without_date
    return ToolOutcome.done(result, ExpiryListCard(within_days=days, rows=rows, without_date=without_date, truncated=truncated))


async def _expiring_documents(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, ExpiringDocumentsInput)
    names_driver = inputs.driver_name is not None or inputs.driver_ref is not None
    names_vehicle = inputs.vehicle_name is not None or inputs.vehicle_ref is not None
    if names_driver and names_vehicle:
        return ToolOutcome.failed("Ask about one driver or one vehicle per call, not both.")
    if names_driver or names_vehicle:
        return await _one_record(context, inputs)
    days = inputs.within_days or DISC_WARNING_DAYS
    if not 1 <= days <= MAX_WINDOW_DAYS:
        return ToolOutcome.failed(f"within_days must be 1 to {MAX_WINDOW_DAYS}.")
    return await _fleet(context, inputs, days)


DOCUMENT_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="expiring_documents",
        description=(
            "Drivers' licences and vehicles' licence discs that have expired or expire soon (default: the next "
            f"{DISC_WARNING_DAYS} days), across active drivers and vehicles; or one named driver's licence or "
            "vehicle's disc date. Use for 'any licences expiring this month', 'is Tim's licence valid', 'whose discs "
            "expire soon'. Both dates are recorded."
        ),
        input_model=ExpiringDocumentsInput,
        runner=_expiring_documents,
    ),
)
