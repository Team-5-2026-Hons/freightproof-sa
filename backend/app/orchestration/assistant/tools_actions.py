"""Action tools (assistant spec §5.1 rows 9–11, D2, D2a–c, D4, B30): buttons that OPEN a page. Nothing is saved.

- `open_trip_form`: the trip form, filled in with what the dispatcher said, and nothing else (D2a). Every name is
  resolved to one record first (asking back if two match); times must be exact moments in the future; then two
  pre-checks said in the chat before the click (D2b): a licence or disc that expires before the trip ends (B32), crew
  clashes by the FP-139 rule
  (`trips.availability`, through `tools_crew.bookings_for`), and for a manifest, that it exists, can become a trip
  and isn't already on a live one (`consignments.manifest_import.preview_pp_manifest`, `trips.listing.list_trips`).
  A manifest that can't become a trip gets no button. The form re-checks everything when the dispatcher presses
  Create; the journey lock is only ever written by that Create (D2).
- `open_page`: a list or record page, with only the filters that page already reads from its address.
- `analytics_redirect`: fleet figures belong to the Analytics page's own chat. Its button opens that chat with the
  question already typed (Tom, option A); the dispatcher presses Ask there.

The button carries ids, never names (D2c); the frontend builds the URL from ROUTES.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import select

from app.analytics.fleet.periods import OPERATIONS_TZ
from app.core.exceptions import ManifestLookupUnsupportedError, ManifestNotFoundError, PPUnavailableError
from app.db.models.enums import VehicleType
from app.db.models.people import Driver
from app.db.models.vehicles import Vehicle
from app.orchestration.analytics_chat.service import chat_enabled as analytics_chat_enabled
from app.orchestration.assistant.resolve import EntityKind
from app.orchestration.assistant.results import AnalyticsRedirectResult, PageResult, TripFormResult
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    record_of,
)
from app.orchestration.assistant.tools_crew import bookings_for
from app.orchestration.assistant.when import INSTANT_WIDTH, When, WhenError, resolve
from app.orchestration.consignments.manifest_import import preview_pp_manifest
from app.orchestration.trips.availability import OCCUPYING_STATUSES, format_when
from app.orchestration.trips.listing import list_trips
from app.schemas.assistant import (
    FormPreviewCard,
    OpenPageAction,
    OpenTripFormAction,
    PageName,
    RecordRef,
    TripFormParams,
)
from app.schemas.pp_manifest import PPManifestPreviewResponse

OPEN_FORM_LABEL = "Open trip form"
NOTHING_SAVED = "Nothing is saved: the dispatcher checks the form and presses Create. Never say a trip was created."
# What the form's datetime-local fields hold, on the operator's clock.
_FORM_TIME = "%Y-%m-%dT%H:%M"
# Two trailers is an interlink; more is not a combination the form allows.
MAX_TRAILERS = 2
# Detail pages and the record kind each shows.
_DETAIL_PAGES: dict[str, EntityKind] = {"trip": "trip", "driver": "driver", "vehicle": "vehicle", "precinct": "precinct"}
_PAGE_WORDS: dict[str, str] = {
    "dashboard": "the Dashboard", "history": "Trip History", "exceptions": "Exceptions", "incidents": "Incidents",
    "drivers": "Drivers", "vehicles": "Vehicles", "precincts": "Precincts", "parcels": "Parcel Search",
    "analytics": "Analytics", "add_precinct": "the Add precinct form",
    "add_driver": "the Add driver form", "add_vehicle": "the Add vehicle form",
}


def form_time(moment: datetime) -> str:
    return moment.astimezone(OPERATIONS_TZ).strftime(_FORM_TIME)


class OpenTripFormInput(ToolInput):
    mode: Literal["empty_leg", "manifest"] = Field(description="manifest: a Parcel Perfect manifest; empty_leg: no cargo.")
    manifest_number: int | None = Field(description="manifest mode only.")
    driver_name: str | None = Field(description="As typed, or null.")
    driver_ref: str | None = Field(description="As a ref, or null.")
    horse_name: str | None = Field(description="Horse registration as typed, or null.")
    horse_ref: str | None = Field(description="As a ref, or null.")
    trailer_names: list[str] = Field(description="Trailer registrations as typed (0 to 2).")
    trailer_refs: list[str] = Field(description="Trailers as refs (0 to 2).")
    origin_name: str | None = Field(description="empty_leg: depot, hub code or city as typed.")
    origin_ref: str | None = Field(description="As a ref, or null.")
    destination_name: str | None = Field(description="empty_leg: depot, hub code or city as typed.")
    destination_ref: str | None = Field(description="As a ref, or null.")
    departure: When | None = Field(description="An exact moment (a day with time_of_day), or null.")
    arrival: When | None = Field(description="An exact moment the DISPATCHER chose (D4), or null to leave blank.")


class _Picked:
    """The records and times one open_trip_form call resolved."""

    def __init__(self) -> None:
        self.driver: RecordRef | None = None
        self.horse: RecordRef | None = None
        self.trailers: list[RecordRef] = []
        self.origin: RecordRef | None = None
        self.destination: RecordRef | None = None
        self.departure: datetime | None = None
        self.arrival: datetime | None = None


async def _one(
    context: ToolContext, what: EntityKind, name: str | None, ref: str | None, vehicle_type: VehicleType | None = None,
) -> RecordRef | ToolOutcome | None:
    match = await find(context, what, name=name, ref=ref, vehicle_type=vehicle_type)
    if match is None or isinstance(match, ToolOutcome):
        return match
    return record_of(match)


async def _records(context: ToolContext, inputs: OpenTripFormInput, picked: _Picked) -> ToolOutcome | None:
    """Fill `picked` with one record per name; the first not-found or "which one?" is returned instead."""
    singles: list[tuple[str, EntityKind, str | None, str | None, VehicleType | None]] = [
        ("driver", "driver", inputs.driver_name, inputs.driver_ref, None),
        ("horse", "vehicle", inputs.horse_name, inputs.horse_ref, VehicleType.HORSE),
        ("origin", "precinct", inputs.origin_name, inputs.origin_ref, None),
        ("destination", "precinct", inputs.destination_name, inputs.destination_ref, None),
    ]
    for slot, what, name, ref, vehicle_type in singles:
        found = await _one(context, what, name, ref, vehicle_type)
        if isinstance(found, ToolOutcome):
            return found
        setattr(picked, slot, found)
    for name, ref in [*((n, None) for n in inputs.trailer_names), *((None, r) for r in inputs.trailer_refs)]:
        trailer = await _one(context, "vehicle", name, ref, VehicleType.TRAILER)
        if isinstance(trailer, ToolOutcome):
            return trailer
        if trailer is not None and trailer not in picked.trailers:
            picked.trailers.append(trailer)
    return None


def _moment(context: ToolContext, when: When | None, label: str) -> datetime | ToolOutcome | None:
    if when is None:
        return None
    try:
        resolved = resolve(when, now=context.now)
    except WhenError as exc:
        return ToolOutcome.failed(str(exc))
    if not resolved.is_instant:
        return ToolOutcome.failed(f"The {label} needs a time of day. Ask the dispatcher what time.")
    if resolved.start <= context.now:
        return ToolOutcome.failed(f"The {label} ({format_when(resolved.start)}) has already passed. Ask the dispatcher.")
    return resolved.start


def _times(context: ToolContext, inputs: OpenTripFormInput, picked: _Picked) -> ToolOutcome | None:
    departure = _moment(context, inputs.departure, "departure")
    arrival = _moment(context, inputs.arrival, "arrival")
    for value in (departure, arrival):
        if isinstance(value, ToolOutcome):
            return value
    picked.departure = departure if isinstance(departure, datetime) else None
    picked.arrival = arrival if isinstance(arrival, datetime) else None
    if picked.departure and picked.arrival and picked.arrival <= picked.departure:
        return ToolOutcome.failed("The arrival is not after the departure. Ask the dispatcher for the right times.")
    return None


async def _manifest(context: ToolContext, number: int, warnings: list[str]) -> PPManifestPreviewResponse | ToolOutcome | None:
    """The manifest's preview, a refusal to send back (no button), or None when Parcel Perfect can't be asked now."""
    on_trips = await list_trips(context.db, context.organization_id, pp_manifest_number=number)
    live = [trip for trip in on_trips if trip.status in OCCUPYING_STATUSES]
    if live:
        return ToolOutcome.failed(
            f"Manifest {number} is already on trip {live[0].trip_reference} ({live[0].status.value}). Tell the "
            "dispatcher; there is no form to open for it."
        )
    try:
        preview = await preview_pp_manifest(context.db, manifest_number=number, operator_organization_id=context.organization_id)
    except ManifestNotFoundError:
        return ToolOutcome.failed(f"Parcel Perfect has no manifest {number}. Ask the dispatcher to check the number.")
    except (ManifestLookupUnsupportedError, PPUnavailableError):
        warnings.append("Parcel Perfect couldn't be checked just now: the form will look the manifest up when it opens.")
        return None
    if not preview.can_create:
        blocking = "; ".join(warning.message for warning in preview.warnings if warning.blocking)
        return ToolOutcome.failed(f"Manifest {number} can't become a trip: {blocking or 'Parcel Perfect refused it'}.")
    return preview


def _summary(preview: PPManifestPreviewResponse) -> str:
    origin = preview.origin.precinct_name or preview.origin.hub_code
    destination = preview.destination.precinct_name or preview.destination.hub_code
    leaves = f", leaves {format_when(preview.planned_departure_at)}" if preview.planned_departure_at else ""
    return f"{origin} → {destination}, {preview.totals.waybills} waybills, {preview.totals.parcels} parcels{leaves}"


async def _clashes(context: ToolContext, picked: _Picked, start: datetime | None, end: datetime | None) -> list[str]:
    """The FP-139 clashes the form would show, said before the click."""
    if start is None:
        return []
    until = end or start + INSTANT_WIDTH
    found: list[str] = []
    for record in [r for r in (picked.driver, picked.horse, *picked.trailers) if r is not None]:
        if not record.is_active:
            found.append(f"{record.label} is marked inactive, so the form won't offer them.")
        for row in await bookings_for(context, record, start, until):
            end_text = format_when(row.busy_until) if row.busy_until else "the trip is closed"
            found.append(f"{record.label} is booked on {row.trip_reference} from {format_when(row.busy_from)} until {end_text}.")
    return found


async def _expiring(context: ToolContext, picked: _Picked, start: datetime | None, end: datetime | None) -> list[str]:
    """A driver's licence or a vehicle's disc that runs out before the trip ends (B32: Timothy Gultig's expires on the
    day of Tom's own example). The form doesn't refuse it; the dispatcher should know before opening it."""
    if start is None:
        return []
    last_day = (end or start).astimezone(OPERATIONS_TZ).date()
    found: list[str] = []
    if picked.driver is not None:
        expiry = (await context.db.execute(select(Driver.license_expiry).where(Driver.id == picked.driver.id))).scalar_one()
        if expiry is not None and expiry <= last_day:
            found.append(f"{picked.driver.label}'s licence expires {expiry:%a} {expiry.day} {expiry:%b %Y}, before this trip ends.")
    for vehicle in [v for v in (picked.horse, *picked.trailers) if v is not None]:
        disc = (await context.db.execute(select(Vehicle.licence_disc_expiry).where(Vehicle.id == vehicle.id))).scalar_one()
        if disc is not None and disc <= last_day:
            found.append(f"{vehicle.label}'s licence disc expires {disc:%a} {disc.day} {disc:%b %Y}, before this trip ends.")
    return found


def _blanks(mode: str, picked: _Picked) -> list[str]:
    """What the dispatcher still fills in: crew always; route and times only for an empty leg (a manifest brings its own)."""
    wanted: dict[str, object] = {"driver": picked.driver, "horse": picked.horse}
    if mode == "empty_leg":
        wanted.update({
            "origin": picked.origin, "destination": picked.destination,
            "departure": picked.departure, "arrival": picked.arrival,
        })
    return [name for name, value in wanted.items() if value is None]


async def _open_trip_form(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, OpenTripFormInput)
    if (inputs.mode == "manifest") != (inputs.manifest_number is not None):
        return ToolOutcome.failed("manifest mode needs manifest_number; empty_leg must leave it null.")
    if len(inputs.trailer_names) + len(inputs.trailer_refs) > MAX_TRAILERS:
        return ToolOutcome.failed("At most 2 trailers (an interlink).")
    picked = _Picked()
    problem = await _records(context, inputs, picked) or _times(context, inputs, picked)
    if problem is not None:
        return problem
    warnings: list[str] = []
    preview: PPManifestPreviewResponse | None = None
    if inputs.manifest_number is not None:
        checked = await _manifest(context, inputs.manifest_number, warnings)
        if isinstance(checked, ToolOutcome):
            return checked
        preview = checked
    start = picked.departure or (preview.planned_departure_at if preview else None)
    end = picked.arrival or (preview.expected_arrival_at if preview else None)
    warnings.extend(await _clashes(context, picked, start, end))
    warnings.extend(await _expiring(context, picked, start, end))
    return _form_outcome(context, inputs, picked, preview, warnings)


def _form_outcome(
    context: ToolContext, inputs: OpenTripFormInput, picked: _Picked,
    preview: PPManifestPreviewResponse | None, warnings: list[str],
) -> ToolOutcome:
    params = TripFormParams(
        mode=inputs.mode, manifest_number=inputs.manifest_number,
        driver_id=picked.driver.id if picked.driver else None, horse_id=picked.horse.id if picked.horse else None,
        trailer_ids=[trailer.id for trailer in picked.trailers],
        origin_precinct_id=picked.origin.id if picked.origin else None,
        destination_precinct_id=picked.destination.id if picked.destination else None,
        departure=form_time(picked.departure) if picked.departure else None,
        arrival=form_time(picked.arrival) if picked.arrival else None,
    )
    summary = _summary(preview) if preview else None
    for record in (picked.driver, picked.horse, picked.origin, picked.destination, *picked.trailers):
        if record is not None:
            context.refs.tag(record)
    result = TripFormResult(
        button=OPEN_FORM_LABEL, mode=inputs.mode, manifest_number=inputs.manifest_number, manifest_route=summary,
        driver=picked.driver.label if picked.driver else None, horse=picked.horse.label if picked.horse else None,
        trailers=[trailer.label for trailer in picked.trailers],
        origin=picked.origin.label if picked.origin else None,
        destination=picked.destination.label if picked.destination else None,
        departure=format_when(picked.departure) if picked.departure else None,
        arrival=format_when(picked.arrival) if picked.arrival else None,
        still_blank=_blanks(inputs.mode, picked), warnings=warnings, rule=NOTHING_SAVED,
    )
    card = FormPreviewCard(
        mode=inputs.mode, manifest_number=inputs.manifest_number, manifest_summary=summary,
        driver=picked.driver, horse=picked.horse, trailers=picked.trailers, origin=picked.origin,
        destination=picked.destination, departure=picked.departure, arrival=picked.arrival, warnings=warnings,
    )
    action = OpenTripFormAction(label=OPEN_FORM_LABEL, params=params)
    return ToolOutcome.done(result, card, actions=(action,))


class OpenPageInput(ToolInput):
    page: PageName = Field(description="trip/driver/vehicle/precinct are one record's page and need record_ref.")
    record_ref: str | None = Field(description="The record for a detail page, as a ref from an earlier result.")
    exceptions_severity: Literal["critical", "warning", "info"] | None = Field(description="exceptions page only.")
    search: str | None = Field(description="exceptions page only: its search box (e.g. a trip reference).")
    barcode: str | None = Field(description="parcels page only.")
    waybill: str | None = Field(description="parcels page only.")


def _page_filters(inputs: OpenPageInput) -> dict[str, str] | ToolOutcome:
    """Only the filters the chosen page already reads from its address."""
    allowed = {"exceptions": {"severity": inputs.exceptions_severity, "q": inputs.search},
               "parcels": {"barcode": inputs.barcode, "waybill": inputs.waybill}}.get(inputs.page, {})
    given = {"severity": inputs.exceptions_severity, "q": inputs.search, "barcode": inputs.barcode, "waybill": inputs.waybill}
    stray = [key for key, value in given.items() if value is not None and key not in allowed]
    if stray:
        return ToolOutcome.failed(f"The {inputs.page} page doesn't take {', '.join(stray)}.")
    return {key: value for key, value in allowed.items() if value}


async def _open_page(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, OpenPageInput)
    filters = _page_filters(inputs)
    if isinstance(filters, ToolOutcome):
        return filters
    kind = _DETAIL_PAGES.get(inputs.page)
    record_id: uuid.UUID | None = None
    label = f"Open {_PAGE_WORDS.get(inputs.page, inputs.page)}"
    if kind is not None:
        if inputs.record_ref is None:
            return ToolOutcome.failed(f"The {inputs.page} page needs record_ref: look the {kind} up first.")
        record = await _one(context, kind, None, inputs.record_ref)
        if not isinstance(record, RecordRef):
            return record or ToolOutcome.failed("Unknown record_ref.")
        record_id, label = record.id, f"Open {record.label}"
    elif inputs.record_ref is not None:
        return ToolOutcome.failed(f"The {inputs.page} page is a list: leave record_ref null.")
    action = OpenPageAction(label=label, page=inputs.page, record_id=record_id, filters=filters)
    return ToolOutcome.done(PageResult(button=label), actions=(action,))


class AnalyticsRedirectInput(ToolInput):
    question: str = Field(max_length=500, description="The dispatcher's question, word for word, to carry over.")


async def _analytics_redirect(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, AnalyticsRedirectInput)
    on = analytics_chat_enabled()
    label = "Ask in Analytics" if on else "Open Analytics"
    action = OpenPageAction(
        label=label, page="analytics", record_id=None, filters={"ask": inputs.question.strip()} if on else {},
    )
    result = AnalyticsRedirectResult(
        button=label, analytics_chat_on=on,
        rule=(
            "Fleet figures belong to the Analytics page's own chat: say so briefly, and that the button opens it with "
            "the question typed for them to send. Give no figures yourself."
            if on else "The Analytics chat is switched off: say the figures are on the Analytics page. Give no figures."
        ),
    )
    return ToolOutcome.done(result, actions=(action,))


ACTION_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="open_trip_form",
        description=(
            "Show an 'Open trip form' button that opens the trip form filled in with what the dispatcher said (and "
            "nothing else), after checking the names, the times, crew clashes and the manifest. It never creates a "
            "trip. For an empty leg with no arrival time, call route_time and ask the dispatcher first (D4)."
        ),
        input_model=OpenTripFormInput,
        runner=_open_trip_form,
    ),
    AssistantTool(
        name="open_page",
        description=(
            "Show a button that opens a page: the Dashboard (live trips), Trip History (closed and cancelled), "
            "Exceptions, Incidents, Drivers, Vehicles, Precincts, Parcel Search or Analytics; or one record's page "
            "(trip, driver, vehicle, precinct) by ref. There is no separate trips list page."
        ),
        input_model=OpenPageInput,
        runner=_open_page,
    ),
    AssistantTool(
        name="analytics_redirect",
        description=(
            "For fleet-wide figures (on-time rates, trends, costs, problem rates): a button that opens the Analytics "
            "page's own chat with the question typed. Never for one driver or vehicle (use trip_history)."
        ),
        input_model=AnalyticsRedirectInput,
        runner=_analytics_redirect,
    ),
)
