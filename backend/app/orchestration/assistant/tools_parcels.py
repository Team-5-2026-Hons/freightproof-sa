"""Parcel tool (assistant spec §5.1 row 8): "where is waybill 12345?", "find parcel ABC123".

With a **barcode** it runs the parcels page's own trace (`parcel_trace.service`): which trips the parcel
was on, where it is in each journey, and the last depot the evidence puts it at. With **only a waybill**
(what dispatchers usually quote) the parcel trace can't run, because it needs a barcode; instead it lists
the organisation's trips that carry that waybill now, and says a barcode gives the parcel-level detail.

Never sent to the model: exception descriptions and override notes from the trace (typed text), and
any position: the trace's "last recorded location" is a depot name, which is all that is used.
"""

from pydantic import Field, ValidationError
from sqlalchemy import select

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import TripStatus
from app.db.models.trips import Consignment, Trip
from app.orchestration.assistant.results import ParcelResult, ParcelTripLine, WaybillChoice
from app.orchestration.assistant.tools_base import AssistantTool, ToolContext, ToolInput, ToolOutcome, expect
from app.orchestration.assistant.tools_trips import precinct_names
from app.orchestration.parcel_trace.service import lookup_parcels, trace_parcel
from app.orchestration.trips.availability import format_when
from app.schemas.assistant import ParcelCard, ParcelJourneyRow, RecordRef
from app.schemas.parcel_trace import ParcelJourney, ParcelLookupQuery, ParcelTraceQuery

# A waybill is normally on one trip; more means it was moved. The newest few are what matters.
MAX_WAYBILL_TRIPS = 10
BARCODE_DETAIL = "One parcel's journey, from the parcel trace."
WAYBILL_DETAIL = (
    "Waybill only: the trips carrying it now. For where one parcel is in the journey, ask for its barcode."
)
CHOOSE_WAYBILL = "This barcode is on more than one waybill. Ask the dispatcher which waybill they mean."


def _line(context: ToolContext, row: ParcelJourneyRow) -> ParcelTripLine:
    tag = context.refs.tag(RecordRef(kind="trip", id=row.trip_id, label=row.trip_reference, detail=row.trip_status.value))
    return ParcelTripLine(
        trip_ref=tag, trip_reference=row.trip_reference, status=row.trip_status.value,
        origin=row.origin, destination=row.destination,
        where=row.position.replace("_", " ") if row.position else None, phase=row.phase,
        last_depot=row.last_depot, last_recorded=format_when(row.last_recorded_at) if row.last_recorded_at else None,
    )


def _journey_row(journey: ParcelJourney) -> ParcelJourneyRow:
    seen = journey.last_recorded_location
    phase = journey.progress.phase_type
    return ParcelJourneyRow(
        trip_id=journey.trip_id, trip_reference=journey.trip_reference, trip_status=journey.trip_status,
        origin=journey.origin_name or "", destination=journey.destination_name or "",
        position=journey.progress.position, phase=phase.value.replace("_", " ") if phase else None,
        last_depot=seen.precinct_name if seen else None,
        last_recorded_at=(seen.captured_at or seen.phase_completed_at) if seen else None,
    )


async def _by_barcode(context: ToolContext, barcode: str, waybill: str | None) -> ToolOutcome:
    try:
        lookup = await lookup_parcels(
            context.db, organization_id=context.organization_id, query=ParcelLookupQuery(barcode=barcode),
        )
    except ValidationError:
        return ToolOutcome.failed("That barcode has characters a barcode can't have. Ask the dispatcher to check it.")
    waybills = [match.waybill_reference for match in lookup.items]
    if waybill is None:
        if not waybills:
            return ToolOutcome.failed(f"No parcel with barcode {barcode!r} in this fleet's trips.")
        if len(waybills) > 1:
            return ToolOutcome.done(WaybillChoice(barcode=barcode, waybills=waybills, instruction=CHOOSE_WAYBILL))
        waybill = waybills[0]
    try:
        trace = await trace_parcel(
            context.db, organization_id=context.organization_id,
            query=ParcelTraceQuery(barcode=barcode, waybill_reference=waybill),
        )
    except ResourceNotFoundError:
        return ToolOutcome.failed(f"No parcel with barcode {barcode!r} on waybill {waybill!r} in this fleet's trips.")
    rows = [_journey_row(journey) for journey in trace.journeys]
    result = ParcelResult(
        barcode=barcode, waybill=waybill, trips=[_line(context, row) for row in rows], detail_level=BARCODE_DETAIL,
    )
    return ToolOutcome.done(result, ParcelCard(barcode=barcode, waybill=waybill, journeys=rows))


async def _by_waybill(context: ToolContext, waybill: str) -> ToolOutcome:
    rows = (await context.db.execute(
        select(Trip.id, Trip.trip_reference, Trip.status, Trip.origin_precinct_id, Trip.destination_precinct_id, Trip.current_phase)
        .join(Consignment, Consignment.trip_id == Trip.id)
        .where(Consignment.parcel_perfect_reference == waybill, Trip.operator_organization_id == context.organization_id)
        .order_by(Trip.created_at.desc())
        .limit(MAX_WAYBILL_TRIPS),
    )).all()
    if not rows:
        return ToolOutcome.failed(f"No trip in this fleet carries waybill {waybill!r}. Ask the dispatcher to check it.")
    names = await precinct_names(context, {row.origin_precinct_id for row in rows} | {row.destination_precinct_id for row in rows})
    journeys = [
        ParcelJourneyRow(
            trip_id=row.id, trip_reference=row.trip_reference, trip_status=TripStatus(row.status),
            origin=names.get(row.origin_precinct_id, ""), destination=names.get(row.destination_precinct_id, ""),
            position=None, phase=row.current_phase.replace("_", " ") if row.current_phase else None,
            last_depot=None, last_recorded_at=None,
        )
        for row in rows
    ]
    result = ParcelResult(
        barcode=None, waybill=waybill, trips=[_line(context, row) for row in journeys], detail_level=WAYBILL_DETAIL,
    )
    return ToolOutcome.done(result, ParcelCard(barcode=None, waybill=waybill, journeys=journeys))


class ParcelLookupInput(ToolInput):
    barcode: str | None = Field(description="The parcel's barcode as typed. Null if only a waybill was given.")
    waybill: str | None = Field(description="The Parcel Perfect waybill number as typed. Otherwise null.")


async def _parcel_lookup(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, ParcelLookupInput)
    barcode = inputs.barcode.strip() if inputs.barcode else None
    waybill = inputs.waybill.strip() if inputs.waybill else None
    if barcode:
        return await _by_barcode(context, barcode, waybill or None)
    if waybill:
        return await _by_waybill(context, waybill)
    return ToolOutcome.failed("Give a barcode or a waybill number.")


PARCEL_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="parcel_lookup",
        description=(
            "Where a parcel or waybill is. With a barcode: the parcel's journey from the parcel trace (its trip, where "
            "it is in the journey, last depot recorded). With only a waybill: the trips carrying it now. Use for "
            "'where is waybill 12345', 'find parcel ABC123'."
        ),
        input_model=ParcelLookupInput,
        runner=_parcel_lookup,
    ),
)
