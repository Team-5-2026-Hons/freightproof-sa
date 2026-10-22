"""Vehicle tool (assistant spec §5.1, row 5): "is this truck having problems?". Licences and discs expiring
across the fleet are `tools_documents.expiring_documents` (B29).

"Problems" means only what FreightProof records (spec §5 of the planning notes): exceptions waiting
for review that are linked to the vehicle, breakdowns (mechanical exceptions) recorded recently,
open incidents on trips that used it, its licence disc, and whether it is marked active. Maintenance
and service history are not recorded, and the answer says so rather than implying a clean bill.

Exceptions come in two groups, so a trip's evidence problems are never passed off as the truck's:
- **about the vehicle**: the ones naming it (`exceptions.vehicle_id`, set when the driver said which
  vehicle broke down), and for a horse also its trips' breakdowns that name no vehicle, exactly as
  the trailer analytics count them;
- **on its trips**: everything else waiting for review on trips it was used on (a GPS mismatch, a seal
  finding). Real, but about the trip, not the vehicle.

The disc bands are the drivers list's own (`analytics.fleet.constants.EXPIRY_BAND_EDGES_DAYS`: red
within 30 days), so the chat and the fleet pages agree on "expiring soon".
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from pydantic import Field
from sqlalchemy import and_, or_, select

from app.analytics.fleet.constants import EXPIRY_BAND_EDGES_DAYS
from app.analytics.fleet.periods import today_sast
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionType, VehicleType
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.assistant.results import OpenExceptions, VehicleSpecs, VehicleStatusResult, Who
from app.orchestration.assistant.tools_base import (
    AssistantTool,
    ToolContext,
    ToolInput,
    ToolOutcome,
    expect,
    find,
    record_of,
)
from app.orchestration.assistant.tools_crew import booking_line, bookings_for
from app.orchestration.assistant.tools_trips import incident_line, incident_row, open_incidents
from app.orchestration.assistant.when import INSTANT_WIDTH
from app.schemas.assistant import DiscState, NeedsReview, RecordRef, VehicleCard

# The drivers list's red band: a disc this close to expiring needs renewing now.
DISC_WARNING_DAYS = EXPIRY_BAND_EDGES_DAYS[0]
# "Having problems" is about now: a breakdown in the last quarter is relevant, one a year ago isn't.
BREAKDOWN_LOOKBACK_DAYS = 90
ALL_TRIPS_SCOPE = (
    "exceptions_on_all_its_trips counts every trip this vehicle has been on, past and present, not only its current "
    "trip: never call it the current trip's count. A trip's own count is on that trip (trip_status)."
)
NOT_RECORDED = (
    "FreightProof does not record maintenance or service history, only exceptions, incidents and the licence disc."
)
_SEVERITIES = ("critical", "warning", "info")


def disc_state(expiry: date | None, today: date) -> DiscState:
    if expiry is None:
        return "unknown"
    if expiry < today:
        return "expired"
    return "expiring" if expiry <= today + timedelta(days=DISC_WARNING_DAYS) else "ok"


def _disc_text(expiry: date | None, today: date) -> str:
    if expiry is None:
        return "No disc expiry date is recorded."
    days = (expiry - today).days
    shown = f"{expiry:%a} {expiry.day} {expiry:%b %Y}"
    if days < 0:
        return f"Expired on {shown} ({-days} days ago)."
    return f"Expires {shown} ({days} days)." + (" Renew soon." if days <= DISC_WARNING_DAYS else "")


@dataclass(frozen=True)
class _Finding:
    exception_type: ExceptionType
    severity: ExceptionSeverity
    vehicle_id: uuid.UUID | None
    waiting: bool
    created_at: datetime
    trip_horse_id: uuid.UUID


def is_about(finding: _Finding, vehicle_id: uuid.UUID, vehicle_type: VehicleType) -> bool:
    """About this vehicle (module docstring): it names the vehicle, or, for a horse, it is a breakdown
    on the horse's trip that names no vehicle. Decided here, not in SQL, because NOT over a NULL
    vehicle_id would silently drop every exception that names no vehicle."""
    if finding.vehicle_id == vehicle_id:
        return True
    return (
        vehicle_type == VehicleType.HORSE and finding.vehicle_id is None
        and finding.exception_type == ExceptionType.MECHANICAL and finding.trip_horse_id == vehicle_id
    )


def _summary(findings: Sequence[_Finding]) -> OpenExceptions:
    severities = Counter(finding.severity.value for finding in findings)
    counts = {severity: severities[severity] for severity in _SEVERITIES}
    return OpenExceptions(**counts, types=sorted({finding.exception_type.value for finding in findings}))


async def _findings(context: ToolContext, used_on: set[uuid.UUID], since: datetime) -> list[_Finding]:
    """Exceptions on the vehicle's trips that are waiting for review, or are breakdowns since `since`."""
    if not used_on:
        return []
    rows = (await context.db.execute(
        select(
            TripException.exception_type, TripException.severity, TripException.vehicle_id,
            TripException.review_status, TripException.created_at, Trip.horse_id,
        )
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            Trip.operator_organization_id == context.organization_id, TripException.trip_id.in_(used_on),
            or_(
                TripException.review_status == ExceptionReviewStatus.NEEDS_REVIEW,
                and_(TripException.exception_type == ExceptionType.MECHANICAL, TripException.created_at >= since),
            ),
        ),
    )).all()
    # Through the enums: a String column can hand back a plain str or the enum member.
    return [
        _Finding(
            exception_type=ExceptionType(row.exception_type), severity=ExceptionSeverity(row.severity),
            vehicle_id=row.vehicle_id, waiting=ExceptionReviewStatus(row.review_status) == ExceptionReviewStatus.NEEDS_REVIEW,
            created_at=row.created_at, trip_horse_id=row.horse_id,
        )
        for row in rows
    ]


async def _exceptions(
    context: ToolContext, vehicle: Vehicle, used_on: set[uuid.UUID],
) -> tuple[OpenExceptions, OpenExceptions, int]:
    """(about the vehicle, others on its trips, breakdowns about it in the look-back)."""
    since = context.now - timedelta(days=BREAKDOWN_LOOKBACK_DAYS)
    kind = VehicleType(vehicle.vehicle_type)
    findings = await _findings(context, used_on, since)
    about = [finding for finding in findings if is_about(finding, vehicle.id, kind)]
    own = [finding for finding in about if finding.waiting]
    others = [finding for finding in findings if finding.waiting and not is_about(finding, vehicle.id, kind)]
    breakdowns = sum(
        finding.exception_type == ExceptionType.MECHANICAL and finding.created_at >= since for finding in about
    )
    return _summary(own), _summary(others), breakdowns


async def _trips_using(context: ToolContext, vehicle_id: uuid.UUID) -> set[uuid.UUID]:
    pulled = select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
    rows = await context.db.execute(select(Trip.id).where(
        Trip.operator_organization_id == context.organization_id,
        or_(Trip.horse_id == vehicle_id, Trip.id.in_(pulled)),
    ))
    return set(rows.scalars().all())


async def _one_vehicle(context: ToolContext, record: RecordRef) -> ToolOutcome:
    vehicle = (await context.db.execute(select(Vehicle).where(
        Vehicle.id == record.id, Vehicle.organization_id == context.organization_id,
    ))).scalar_one()
    today = today_sast(context.now)
    now_rows = await bookings_for(context, record, context.now, context.now + INSTANT_WIDTH)
    used_on = await _trips_using(context, vehicle.id)
    waiting, on_trips, breakdowns = await _exceptions(context, vehicle, used_on)
    incidents = [incident for incident in await open_incidents(context) if incident.trip_id in used_on]
    specs = VehicleSpecs(
        make=vehicle.make, model=vehicle.model, year=vehicle.year, length_m=vehicle.length_m,
        gross_vehicle_mass_kg=vehicle.gross_vehicle_mass_kg,
    )
    result = VehicleStatusResult(
        vehicle=Who(ref=context.refs.tag(record), label=record.label, kind=record.detail or "vehicle", active=record.is_active),
        specs=specs,
        licence_disc=_disc_text(vehicle.licence_disc_expiry, today),
        on_trip_now=[booking_line(context, row) for row in now_rows],
        exceptions_to_review=waiting, exceptions_on_all_its_trips=on_trips, all_trips_scope=ALL_TRIPS_SCOPE,
        recent_breakdowns=breakdowns, breakdown_window_days=BREAKDOWN_LOOKBACK_DAYS,
        open_incidents=[incident_line(incident) for incident in incidents], not_recorded=NOT_RECORDED,
    )
    card = VehicleCard(
        vehicle=record, **specs.model_dump(), licence_disc_expiry=vehicle.licence_disc_expiry,
        disc_state=disc_state(vehicle.licence_disc_expiry, today), on_trip_now=now_rows,
        exceptions_to_review=NeedsReview(critical=waiting.critical, warning=waiting.warning, info=waiting.info),
        exception_types=waiting.types,
        trip_exceptions_to_review=NeedsReview(critical=on_trips.critical, warning=on_trips.warning, info=on_trips.info),
        recent_breakdowns=breakdowns,
        open_incidents=[incident_row(incident) for incident in incidents],
    )
    return ToolOutcome.done(result, card)


class VehicleStatusInput(ToolInput):
    vehicle_name: str | None = Field(description="Horse or trailer registration as typed.")
    vehicle_ref: str | None = Field(description="Vehicle as a ref.")


async def _vehicle_status(context: ToolContext, raw: ToolInput) -> ToolOutcome:
    inputs = expect(raw, VehicleStatusInput)
    match = await find(context, "vehicle", name=inputs.vehicle_name, ref=inputs.vehicle_ref)
    if match is None:
        return ToolOutcome.failed("Give a vehicle. For licences and discs expiring across the fleet, use expiring_documents.")
    if isinstance(match, ToolOutcome):
        return match
    return await _one_vehicle(context, record_of(match))


FLEET_TOOLS: tuple[AssistantTool, ...] = (
    AssistantTool(
        name="vehicle_status",
        description=(
            "One horse or trailer: on a trip now, exceptions waiting for review about it (and, separately, others on its "
            f"trips, which are about the trip, not the vehicle), breakdowns in the last {BREAKDOWN_LOOKBACK_DAYS} days, "
            "open incidents on its trips, its licence disc, make, model, year, length and mass, and whether it is "
            "active. Use for 'is this truck having "
            "problems', 'is CA 123-456 in use'. Maintenance history is not recorded: say so only if asked about it."
        ),
        input_model=VehicleStatusInput,
        runner=_vehicle_status,
    ),
)

