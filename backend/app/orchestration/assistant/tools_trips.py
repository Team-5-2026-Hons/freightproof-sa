"""Trip tools (assistant spec §5.1, rows 1–3): trips by status and date, one trip, needs attention.

Each reuses what the dispatcher's own pages use: `trips.listing.list_trips` (the dashboard and trips
list, current driver after a handover included), `trips.detail.get_trip_detail` (the trip page) and
`incidents.queries.list_incidents` (the incidents page). Nothing here queries trips its own way, so
the chat and the pages count the same trips.

"Active" means what the dashboard tile means (spec D10): booked, on the road or on hold, the same
tuple `trips.availability` treats as occupying crew.
"""

import uuid
from collections import Counter
from collections.abc import Collection, Sequence
from datetime import UTC, datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import select

from app.db.models.enums import (
    AnchorStatus,
    BlockchainReceiptType,
    ExceptionReviewStatus,
    IncidentStatus,
    PhaseStatus,
    PhaseType,
    TripStatus,
    TripType,
)
from app.db.models.organisations import Precinct
from app.db.models.trips import Trip
from app.orchestration.assistant.resolve import EntityKind
from app.orchestration.assistant.results import (
    ACTIVE_DEFINITION,
    AttentionResult,
    Counts,
    ReviewQueue,
    IncidentLine,
    OpenExceptions,
    RecordIntegrity,
    TripLine,
    TripsResult,
    TripStatusResult,
)
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    when_text,
)
from app.orchestration.assistant.when import When, WhenError, resolve
from app.orchestration.assistant.tools_route import duration_text
from app.orchestration.exceptions.queries import list_review_queue
from app.orchestration.incidents.queries import list_incidents
from app.orchestration.phases.state import RESOLVED_PHASE_STATUSES
from app.orchestration.trips.availability import LIVE_STATUSES, OCCUPYING_STATUSES, format_when
from app.orchestration.trips.detail import get_trip_detail
from app.orchestration.trips.listing import list_trips
from app.schemas.assistant import (
    IncidentListCard,
    IncidentRow,
    NeedsReview,
    RecordRef,
    ReviewQueueCard,
    TripCard,
    TripListCard,
    TripRow,
)
from app.schemas.incidents import IncidentListFilters, IncidentRead
from app.schemas.phases import PhaseEventRead
from app.schemas.trips import TripDetailResponse, TripListItemResponse

StatusGroup = Literal["active", "on_the_road", "booked", "on_hold", "closed", "cancelled"]
WhichTime = Literal["departure", "arrival", "closed"]

STATUS_GROUPS: dict[StatusGroup, tuple[TripStatus, ...]] = {
    "active": OCCUPYING_STATUSES,
    "on_the_road": (TripStatus.ACTIVE,),
    "booked": (TripStatus.CREATED,),
    "on_hold": (TripStatus.EXCEPTION_HOLD,),
    "closed": (TripStatus.CLOSED,),
    "cancelled": (TripStatus.CANCELLED,),
}
# Finished trips pile up for ever; listing them all would be the whole history.
NEEDS_A_WINDOW: frozenset[StatusGroup] = frozenset({"closed", "cancelled"})
# A list longer than this is read on the trips page, not in a chat; the totals still count all.
MAX_ROWS = 25
OPEN_INCIDENT_STATUSES: tuple[IncidentStatus, ...] = (IncidentStatus.OPEN, IncidentStatus.INVESTIGATING)
_SEVERITY_ORDER = ("critical", "warning", "info")
# Sorts a trip with no time last.
_NEVER = datetime.max.replace(tzinfo=UTC)


async def precinct_names(context: ToolContext, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await context.db.execute(select(Precinct.id, Precinct.name).where(Precinct.id.in_(set(ids))))
    return {precinct_id: name for precinct_id, name in rows.all()}


def _overdue(status: TripStatus, planned_arrival: datetime | None, arrived: datetime | None, now: datetime) -> bool:
    return status in LIVE_STATUSES and arrived is None and planned_arrival is not None and planned_arrival < now


def _shown(moment: datetime | None) -> str | None:
    return format_when(moment) if moment is not None else None


def row_of(item: TripListItemResponse, names: dict[uuid.UUID, str], now: datetime) -> TripRow:
    attention = item.attention
    return TripRow(
        trip_id=item.id, trip_reference=item.trip_reference,
        manifest=item.pp_manifest.display if item.pp_manifest else None,
        status=item.status, trip_type=item.trip_type,
        origin=names.get(item.origin_precinct_id, ""), destination=names.get(item.destination_precinct_id, ""),
        driver_id=item.driver.id, driver=item.driver.full_name,
        horse_id=item.horse.id, horse=item.horse.registration, trailers=[t.registration for t in item.trailers],
        planned_departure_at=item.planned_departure_at, planned_arrival_at=item.planned_arrival_at,
        actual_departure_at=item.actual_departure_at, actual_arrival_at=item.actual_arrival_at,
        current_phase=item.current_phase, current_stop=item.current_stop,
        phase_completed=item.phase_completed, phase_total=item.phase_total,
        needs_review=NeedsReview(critical=attention.critical, warning=attention.warning, info=attention.info),
        overdue=_overdue(item.status, item.planned_arrival_at, item.actual_arrival_at, now),
    )


def line_of(row: TripRow, context: ToolContext) -> TripLine:
    tag = context.refs.tag(RecordRef(kind="trip", id=row.trip_id, label=row.trip_reference, detail=row.status.value))
    context.refs.tag(RecordRef(kind="driver", id=row.driver_id, label=row.driver))
    context.refs.tag(RecordRef(kind="vehicle", id=row.horse_id, label=row.horse, detail="horse"))
    return TripLine(
        ref=tag, trip_reference=row.trip_reference, manifest=row.manifest, status=row.status.value,
        trip_type=row.trip_type.value, origin=row.origin, destination=row.destination,
        driver=row.driver, horse=row.horse, trailers=row.trailers,
        planned_departure=_shown(row.planned_departure_at), planned_arrival=_shown(row.planned_arrival_at),
        actual_departure=_shown(row.actual_departure_at), actual_arrival=_shown(row.actual_arrival_at),
        phase=row.current_phase.replace("_", " ") if row.current_phase else None,
        progress=f"{row.phase_completed} of {row.phase_total} steps done",
        exceptions_to_review=Counts(
            critical=row.needs_review.critical, warning=row.needs_review.warning, info=row.needs_review.info,
        ),
        overdue=row.overdue,
    )


def _time_of(item: TripListItemResponse, which: WhichTime, closed: dict[uuid.UUID, datetime] | None = None) -> datetime | None:
    """What happened beats what was planned: a trip that left at 06:10 departed at 06:10. "closed" is when it was
    closed or cancelled, Trip History's own date (`trips.listing.list_trip_history` filters on `closed_at`)."""
    if which == "closed":
        return (closed or {}).get(item.id)
    if which == "departure":
        return item.actual_departure_at or item.planned_departure_at
    return item.actual_arrival_at or item.planned_arrival_at


class TripsInput(ToolInput):
    status_group: StatusGroup = Field(
        description=(
            "active = booked, on the road or on hold (the dashboard's Active trips); on_the_road; booked (not "
            "started); on_hold; closed and cancelled need when."
        ),
    )
    when: When | None = Field(description="Only trips departing or arriving in this window. Null: any date.")
    which_time: WhichTime | None = Field(
        description="With when: departure, arrival (finishing), closed (closed or cancelled in it, as Trip History "
        "counts; closed and cancelled groups only), or null for departure or arrival.",
    )
    overdue_only: bool = Field(description="Only live trips past their planned arrival.")
    precinct_name: str | None = Field(description="Depot filter, as typed.")
    precinct_ref: str | None = Field(description="Depot filter, as a ref.")
    driver_name: str | None = Field(description="Driver filter, as typed.")
    driver_ref: str | None = Field(description="Driver filter, as a ref.")
    vehicle_name: str | None = Field(description="Horse or trailer filter, registration as typed.")
    vehicle_ref: str | None = Field(description="Vehicle filter, as a ref.")


class _Filters:
    """The record filters a TripsInput named, resolved to ids."""

    def __init__(self, precinct: uuid.UUID | None, driver: uuid.UUID | None, vehicle: uuid.UUID | None) -> None:
        self.precinct, self.driver, self.vehicle = precinct, driver, vehicle

    def keeps(self, item: TripListItemResponse, which: WhichTime | None) -> bool:
        if self.driver is not None and item.driver.id != self.driver:
            return False
        if self.vehicle is not None and self.vehicle not in {item.horse.id, *(t.id for t in item.trailers)}:
            return False
        if self.precinct is None:
            return True
        ends = {
            "departure": {item.origin_precinct_id},
            "arrival": {item.destination_precinct_id},
        }.get(which or "", {item.origin_precinct_id, item.destination_precinct_id})
        return self.precinct in ends


async def _filters(context: ToolContext, inputs: TripsInput) -> _Filters | ToolOutcome:
    found: list[uuid.UUID | None] = []
    named: tuple[tuple[EntityKind, str | None, str | None], ...] = (
        ("precinct", inputs.precinct_name, inputs.precinct_ref),
        ("driver", inputs.driver_name, inputs.driver_ref),
        ("vehicle", inputs.vehicle_name, inputs.vehicle_ref),
    )
    for what, name, ref in named:
        match = await find(context, what, name=name, ref=ref)
        if isinstance(match, ToolOutcome):
            return match
        found.append(match.id if match is not None else None)
    return _Filters(*found)


async def _closed_at(context: ToolContext, items: Sequence[TripListItemResponse]) -> dict[uuid.UUID, datetime]:
    """When each finished trip was closed or cancelled (the list read doesn't carry it)."""
    if not items:
        return {}
    rows = await context.db.execute(select(Trip.id, Trip.closed_at).where(Trip.id.in_([item.id for item in items])))
    return {trip_id: closed_at for trip_id, closed_at in rows.all() if closed_at is not None}


def _in_window(
    item: TripListItemResponse, which: WhichTime | None, start: datetime, end: datetime,
    closed: dict[uuid.UUID, datetime] | None = None,
) -> bool:
    times = [_time_of(item, which, closed)] if which else [_time_of(item, "departure"), _time_of(item, "arrival")]
    return any(moment is not None and start <= moment < end for moment in times)


async def _trips(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, TripsInput)
    if inputs.status_group in NEEDS_A_WINDOW and inputs.when is None:
        return ToolOutcome.failed(f"{inputs.status_group} trips need when (e.g. last_week); history is long.")
    if inputs.which_time == "closed" and inputs.status_group not in NEEDS_A_WINDOW:
        return ToolOutcome.failed("which_time closed is only for the closed and cancelled groups.")
    window: tuple[datetime, datetime] | None = None
    if inputs.when is not None:
        try:
            resolved = resolve(inputs.when, now=context.now)
        except WhenError as exc:
            return ToolOutcome.failed(str(exc))
        if resolved.is_instant:
            return ToolOutcome.failed("For trips, when must be a day or a window, not one moment.")
        window = resolved.as_window()
    filters = await _filters(context, inputs)
    if isinstance(filters, ToolOutcome):
        return filters

    items = await list_trips(context.db, context.organization_id, status_filter=list(STATUS_GROUPS[inputs.status_group]))
    kept = [item for item in items if filters.keeps(item, inputs.which_time)]
    overdue_total = sum(_overdue(i.status, i.planned_arrival_at, i.actual_arrival_at, context.now) for i in kept)
    if window is not None:
        closed = await _closed_at(context, kept) if inputs.which_time == "closed" else None
        kept = [item for item in kept if _in_window(item, inputs.which_time, *window, closed=closed)]
    if inputs.overdue_only:
        kept = [item for item in kept if _overdue(item.status, item.planned_arrival_at, item.actual_arrival_at, context.now)]
    kept.sort(key=lambda item: _time_of(item, inputs.which_time or "departure") or _NEVER)
    return await _trip_list(context, inputs, kept, window, overdue_total)


def _title(inputs: TripsInput) -> str:
    """"Overdue trips", "Active trips due to arrive", "Booked trips departing", "Active trips"."""
    if inputs.overdue_only:
        return "Overdue trips"
    group = inputs.status_group.replace("_", " ").capitalize()
    if inputs.when is not None and inputs.which_time is not None and inputs.which_time != "closed":
        return f"{group} trips {'due to arrive' if inputs.which_time == 'arrival' else 'departing'}"
    return f"{group} trips"


def _with_closed(line: TripLine, row: TripRow, closed: dict[uuid.UUID, datetime] | None) -> TripLine:
    """The closed time on a list matched by it, so "trips closed yesterday" can say when each one closed."""
    moment = (closed or {}).get(row.trip_id)
    return line.model_copy(update={"closed": _shown(moment)}) if moment else line


async def _trip_list(
    context: ToolContext,
    inputs: TripsInput,
    kept: Sequence[TripListItemResponse],
    window: tuple[datetime, datetime] | None,
    overdue_total: int,
) -> ToolOutcome:
    names = await precinct_names(context, {i.origin_precinct_id for i in kept} | {i.destination_precinct_id for i in kept})
    rows = [row_of(item, names, context.now) for item in kept[:MAX_ROWS]]
    # Looked up again for the shown rows only, so the lines can say when each one closed.
    closed = await _closed_at(context, kept[:MAX_ROWS]) if inputs.which_time == "closed" else None
    statuses = Counter(item.status for item in kept)
    counts = {
        "on_the_road": statuses[TripStatus.ACTIVE],
        "booked": statuses[TripStatus.CREATED],
        "on_hold": statuses[TripStatus.EXCEPTION_HOLD],
    }
    result = TripsResult(
        definition=ACTIVE_DEFINITION if inputs.status_group == "active" else None, status_group=inputs.status_group,
        window=when_text(*window) if window else None, which_time=inputs.which_time,
        total=len(kept), overdue_total=overdue_total, shown=len(rows), truncated=len(kept) > len(rows),
        trips=[_with_closed(line_of(row, context), row, closed) for row in rows], **counts,
    )
    card = TripListCard(
        title=_title(inputs), total=len(kept),
        window_start=window[0] if window else None, window_end=window[1] if window else None,
        rows=rows, truncated=len(kept) > len(rows),
        full_list="history" if inputs.status_group in NEEDS_A_WINDOW else "dashboard", **counts,
    )
    return ToolOutcome.done(result, card)


def incident_row(incident: IncidentRead) -> IncidentRow:
    return IncidentRow(
        incident_id=incident.incident_id, reference=incident.reference, incident_type=incident.incident_type,
        status=incident.status, trip_id=incident.trip_id, trip_reference=incident.trip_reference,
        received_at=incident.received_at, investigated_by=incident.assigned_to_name, outcome=incident.outcome,
    )


def incident_line(incident: IncidentRead) -> IncidentLine:
    # Never `summary`: a person typed it (spec §5.2).
    return IncidentLine(
        reference=incident.reference, incident_type=incident.incident_type.value, status=incident.status.value,
        trip_reference=incident.trip_reference, received=format_when(incident.received_at),
        exceptions_total=incident.exceptions_total, parcels_total=incident.parcels_total,
        investigated_by=incident.assigned_to_name, parcels_unresolved=incident.parcels_unresolved,
        outcome=incident.outcome.value if incident.outcome else None,
    )


async def open_incidents(context: ToolContext, trip_id: uuid.UUID | None = None) -> list[IncidentRead]:
    found: list[IncidentRead] = []
    for status in OPEN_INCIDENT_STATUSES:
        found.extend(await list_incidents(
            context.db, organization_id=context.organization_id,
            filters=IncidentListFilters(trip_id=trip_id, status=status),
        ))
    return sorted(found, key=lambda incident: incident.received_at, reverse=True)


class TripStatusInput(ToolInput):
    trip_reference: str | None = Field(
        description="The trip reference as typed: FP-20261020-AB12CD34, or its last 8 characters. Otherwise null.",
    )
    trip_ref: str | None = Field(description="A trip ref from an earlier result. Otherwise null.")
    manifest_number: int | None = Field(description="A Parcel Perfect manifest number, e.g. 81. Otherwise null.")


async def _trip_for_manifest(context: ToolContext, number: int) -> uuid.UUID | ToolOutcome:
    items = await list_trips(context.db, context.organization_id, pp_manifest_number=number)
    if not items:
        return ToolOutcome.failed(f"No trip carries manifest {number}. Tell the dispatcher; don't guess another.")
    # A manifest is on at most one live trip; otherwise the newest (list_trips sorts newest first).
    live = [item for item in items if item.status in OCCUPYING_STATUSES]
    return (live or items)[0].id


def _detail_row(detail: TripDetailResponse, names: dict[uuid.UUID, str], now: datetime) -> TripRow:
    waiting = [e for e in detail.exceptions if e.review_status == ExceptionReviewStatus.NEEDS_REVIEW]
    severities = Counter(e.severity.value for e in waiting)
    return TripRow(
        trip_id=detail.id, trip_reference=detail.trip_reference,
        manifest=detail.pp_manifest.display if detail.pp_manifest else None,
        status=detail.status, trip_type=TripType(detail.trip_type),
        origin=names.get(detail.origin_precinct_id, ""), destination=names.get(detail.destination_precinct_id, ""),
        driver_id=detail.driver.id, driver=detail.driver.full_name,
        horse_id=detail.horse.id, horse=detail.horse.registration, trailers=[t.registration for t in detail.trailers],
        planned_departure_at=detail.planned_departure_at, planned_arrival_at=detail.planned_arrival_at,
        actual_departure_at=detail.actual_departure_at, actual_arrival_at=detail.actual_arrival_at,
        current_phase=detail.current_phase, current_stop=detail.current_stop,
        phase_completed=sum(phase.status in RESOLVED_PHASE_STATUSES for phase in detail.phases),
        phase_total=len(detail.phases),
        needs_review=NeedsReview(**{severity: severities[severity] for severity in _SEVERITY_ORDER}),
        overdue=_overdue(detail.status, detail.planned_arrival_at, detail.actual_arrival_at, now),
    )


INTEGRITY_RULE = (
    "Stored receipts only, as the trip page's Record integrity section counts them. Never say the record is "
    "untampered or verified: the live check against the blockchain is the trip page's Verify button."
)
SECONDS_PER_MINUTE = 60


def _last_of(detail: TripDetailResponse, phase_type: PhaseType) -> PhaseEventRead | None:
    plan = [phase for phase in sorted(detail.phases, key=lambda p: p.sequence_number) if phase.phase_type == phase_type]
    return plan[-1] if plan else None


def delivery_confirmed_at(detail: TripDetailResponse) -> datetime | None:
    """The trip page's rule (`lib/phase/trip-detail.ts` tripConfirmation): the last confirmation step, done or
    done with an exception."""
    confirmation = _last_of(detail, PhaseType.CONFIRMATION)
    if confirmation is None or confirmation.status not in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION):
        return None
    return confirmation.completed_at


def delay_minutes(planned: datetime | None, actual: datetime | None) -> int | None:
    if planned is None or actual is None:
        return None
    return round((actual - planned).total_seconds() / SECONDS_PER_MINUTE)


def delay_text(minutes: int | None) -> str | None:
    if minutes is None:
        return None
    if minutes == 0:
        return "on time"
    return f"{duration_text(abs(minutes))} {'late' if minutes > 0 else 'early'}"


def parcels_booked(detail: TripDetailResponse) -> int | None:
    """The trip page's rule (`bookedParcels`): 0 for an empty leg; unknown if any consignment has no expected count."""
    if detail.trip_type == TripType.EMPTY_LEG:
        return 0
    if not detail.consignments or any(c.parcel_count_expected is None for c in detail.consignments):
        return None
    return sum(c.parcel_count_expected or 0 for c in detail.consignments)


def _integrity(detail: TripDetailResponse) -> RecordIntegrity:
    """The page's tally (`lib/phase/derive.ts` anchorTally) plus whether the journey lock is on the ledger."""
    lock = any(
        receipt.receipt_type == BlockchainReceiptType.JOURNEY_LOCK and receipt.hedera_consensus_timestamp is not None
        for receipt in detail.blockchain_receipts
    )
    return RecordIntegrity(
        journey_lock_anchored=lock,
        phase_receipts_owed=sum(p.anchor_status != AnchorStatus.NOT_REQUIRED for p in detail.phases),
        phase_receipts_anchored=sum(p.anchor_status == AnchorStatus.ANCHORED for p in detail.phases),
        phase_receipts_failed=sum(p.anchor_status == AnchorStatus.FAILED for p in detail.phases),
        rule=INTEGRITY_RULE,
    )


async def _which_trip(context: ToolContext, inputs: TripStatusInput) -> uuid.UUID | ToolOutcome:
    if inputs.manifest_number is not None:
        return await _trip_for_manifest(context, inputs.manifest_number)
    match = await find(context, "trip", name=inputs.trip_reference, ref=inputs.trip_ref)
    if match is None:
        return ToolOutcome.failed("Give trip_reference, trip_ref or manifest_number.")
    return match if isinstance(match, ToolOutcome) else match.id


async def _trip_status(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, TripStatusInput)
    trip_id = await _which_trip(context, inputs)
    if isinstance(trip_id, ToolOutcome):
        return trip_id

    detail = await get_trip_detail(context.db, trip_id, context.organization_id)
    stops = sorted(detail.stops, key=lambda stop: stop.sequence)
    names = await precinct_names(
        context, {stop.precinct_id for stop in stops} | {detail.origin_precinct_id, detail.destination_precinct_id},
    )
    row = _detail_row(detail, names, context.now)
    incidents = await open_incidents(context, trip_id)
    original = detail.original_driver
    handed_over = original.full_name if original is not None and original.id != detail.driver.id else None
    waiting = [e for e in detail.exceptions if e.review_status == ExceptionReviewStatus.NEEDS_REVIEW]
    confirmed = delivery_confirmed_at(detail)
    late_out = delay_minutes(detail.planned_departure_at, detail.actual_departure_at)
    late_in = delay_minutes(detail.planned_arrival_at, detail.actual_arrival_at)
    booked = parcels_booked(detail)
    scanned_out = sum(c.scanned_out_count for c in detail.consignments)
    scanned_in = sum(c.scanned_in_count for c in detail.consignments)
    integrity = _integrity(detail)
    result = TripStatusResult(
        trip=line_of(row, context), stops=[names.get(stop.precinct_id, "") for stop in stops],
        original_driver=handed_over,
        open_exceptions=OpenExceptions(
            critical=row.needs_review.critical, warning=row.needs_review.warning, info=row.needs_review.info,
            types=sorted({e.exception_type.value for e in waiting}),
        ),
        open_incidents=[incident_line(incident) for incident in incidents],
        delivery_confirmed=_shown(confirmed), closed=_shown(detail.closed_at),
        departure_delay=delay_text(late_out), arrival_delay=delay_text(late_in), parcels_booked=booked,
        parcels_scanned_out=scanned_out, parcels_scanned_in=scanned_in, record_integrity=integrity,
    )
    card = TripCard(
        trip=row, stops=result.stops, original_driver=handed_over,
        open_incidents=[incident_row(incident) for incident in incidents],
        delivery_confirmed_at=confirmed, closed_at=detail.closed_at,
        departure_delay_minutes=late_out, arrival_delay_minutes=late_in, parcels_booked=booked,
        parcels_scanned_out=scanned_out, parcels_scanned_in=scanned_in,
        journey_lock_anchored=integrity.journey_lock_anchored, receipts_owed=integrity.phase_receipts_owed,
        receipts_anchored=integrity.phase_receipts_anchored, receipts_failed=integrity.phase_receipts_failed,
    )
    return ToolOutcome.done(result, card)


class NeedsAttentionInput(ToolInput):
    severity_at_least: Literal["critical", "warning", "info"] | None = Field(
        description="Only trips with an exception to review at this severity or worse. Null: any.",
    )


def _attention_rank(row: TripRow) -> tuple[int, int, int]:
    return (row.needs_review.critical, row.needs_review.warning, row.needs_review.info)


QUEUE_DEFINITION = (
    "Every exception waiting for review, on any trip: the same count as the Exceptions page's 'N needing review'. "
    "The trips listed below are only the live ones."
)
FINISHED_STATUSES: tuple[TripStatus, ...] = (TripStatus.CLOSED, TripStatus.CANCELLED)


async def _review_queue(context: ToolContext) -> tuple[ReviewQueue, ReviewQueueCard]:
    """The Exceptions page's own read (`exceptions.queries.list_review_queue`), counted (coverage audit item 2)."""
    queue = await list_review_queue(context.db, organization_id=context.organization_id)
    severities = Counter(item.severity.value for item in queue)
    claimed = sum(item.claimed_by_user_id is not None for item in queue)
    finished = sum(item.trip_status in FINISHED_STATUSES for item in queue)
    counts = {severity: severities[severity] for severity in _SEVERITY_ORDER}
    result = ReviewQueue(
        definition=QUEUE_DEFINITION, total=len(queue), claimed=claimed, unclaimed=len(queue) - claimed,
        on_finished_trips=finished, **counts,
    )
    card = ReviewQueueCard(
        total=len(queue), by_severity=NeedsReview(**counts), claimed=claimed, unclaimed=len(queue) - claimed,
        on_finished_trips=finished,
    )
    return result, card


async def _needs_attention(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, NeedsAttentionInput)
    queue, queue_card = await _review_queue(context)
    floor = _SEVERITY_ORDER.index(inputs.severity_at_least or "info")
    items = await list_trips(context.db, context.organization_id, status_filter=list(OCCUPYING_STATUSES))
    names = await precinct_names(context, {i.origin_precinct_id for i in items} | {i.destination_precinct_id for i in items})
    rows = [row_of(item, names, context.now) for item in items]
    flagged = [
        row for row in rows
        if any(getattr(row.needs_review, severity) for severity in _SEVERITY_ORDER[: floor + 1])
    ]
    flagged.sort(key=_attention_rank, reverse=True)
    shown = flagged[:MAX_ROWS]
    incidents = await open_incidents(context)
    result = AttentionResult(
        review_queue=queue, trips_total=len(flagged), shown=len(shown), truncated=len(flagged) > len(shown),
        trips=[line_of(row, context) for row in shown], open_incidents=[incident_line(i) for i in incidents],
    )
    counts = Counter(row.status for row in flagged)
    trips_card = TripListCard(
        title="Trips with exceptions to review", total=len(flagged),
        on_the_road=counts[TripStatus.ACTIVE], booked=counts[TripStatus.CREATED], on_hold=counts[TripStatus.EXCEPTION_HOLD],
        window_start=None, window_end=None, rows=shown, truncated=len(flagged) > len(shown), full_list="dashboard",
    )
    open_card = IncidentListCard(title="Open incidents", rows=[incident_row(i) for i in incidents])
    return ToolOutcome.done(result, queue_card, trips_card, open_card)


TRIP_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="trips",
        description=(
            "Count and list trips by status, optionally in a window (departing or arriving), at a depot, for a driver "
            "or vehicle, or only overdue ones. One call answers 'what's finishing today': the result also gives "
            "overdue_total and the on-the-road / booked / on-hold split."
        ),
        input_model=TripsInput,
        runner=_trips,
    ),
    AssistantTool(
        name="trip_status",
        description=(
            "One trip's status: route, current driver (after any handover), vehicles, phase, planned and actual times "
            "with delays worked out, delivery confirmed, closed, parcels booked and scanned, exceptions waiting, open "
            "incidents, and the stored blockchain receipts (never a tamper verdict). Find it by reference, ref or "
            "manifest number. Never gives GPS positions: the trip page has the map."
        ),
        input_model=TripStatusInput,
        runner=_trip_status,
    ),
    AssistantTool(
        name="needs_attention",
        description=(
            "The whole review queue (every exception waiting for review, the Exceptions page's count, by severity and "
            "claimed or not), the live trips with exceptions to review (worst first), and every open incident. Use "
            "for 'how many exceptions need review', 'which trips have problems', 'what needs attention'."
        ),
        input_model=NeedsAttentionInput,
        runner=_needs_attention,
    ),
)
