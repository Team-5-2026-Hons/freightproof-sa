"""Pure evidence summaries. Recorded observations are never promoted into parcel GPS."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.db.models.enums import PhaseStatus, PhaseType
from app.db.models.phases import PhaseEvent
from app.orchestration.parcel_trace.queries import JourneyRecords
from app.schemas.parcel_trace import ParcelRecordedLocation, ParcelSealWindow, ParcelTracePhase

RESOLVED_STATUSES = frozenset({PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION, PhaseStatus.OVERRIDDEN})
OBSERVED_STATUSES = frozenset({PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION})


def last_recorded_location(records: JourneyRecords, relevant_ids: set[UUID]) -> ParcelRecordedLocation | None:
    # Ledger order, not maintenance timestamps: a later anchor retry is not a newer observation.
    for event in reversed(records.phases):
        if event.id not in relevant_ids or event.status not in OBSERVED_STATUSES:
            continue
        source, captured = _location_source(event)
        if source is None:
            continue
        # Transit belongs to its DEPARTURE stop in the ledger; a captured road/arrival
        # position must not be labelled as though it were observed at that depot.
        stop = next((s for s in records.stops if s.id == event.trip_stop_id), None) if event.phase_type != PhaseType.IN_TRANSIT else None
        return ParcelRecordedLocation(
            phase_event_id=event.id,
            precinct_name=records.precinct_names.get(stop.precinct_id) if stop else None,
            source=source, captured_at=captured, phase_completed_at=event.completed_at,
            precinct_confirmed=event.pulsit_geofence_confirmed if source == "horse_tracker" else None,
        )
    return None


def _location_source(event: PhaseEvent) -> tuple[Literal["horse_tracker", "driver_phone"] | None, datetime | None]:
    assessment = event.action_location_assessment
    if isinstance(assessment, dict):
        # A persisted assessment owns its capture context; do not splice in legacy columns.
        for source, prefix in (("horse_tracker", "tracker"), ("driver_phone", "driver")):
            if assessment.get(f"{prefix}_lat") is not None and assessment.get(f"{prefix}_lng") is not None:
                value = assessment.get(f"{prefix}_captured_at")
                captured = _parse_time(value)
                return ("horse_tracker" if source == "horse_tracker" else "driver_phone"), captured
        return None, None
    if event.horse_gps_lat is not None and event.horse_gps_lng is not None:
        return "horse_tracker", None
    if event.driver_phone_lat is not None and event.driver_phone_lng is not None:
        return "driver_phone", event.driver_captured_at
    return None, None


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def location_verdict(event: PhaseEvent) -> Literal["confirmed", "mismatch", "unwitnessed", "not_recorded"]:
    if event.status not in OBSERVED_STATUSES:
        return "not_recorded"
    if event.pulsit_geofence_confirmed is True:
        return "confirmed"
    if event.pulsit_geofence_confirmed is False:
        return "mismatch"
    return "unwitnessed"


def seal_windows(phases: list[ParcelTracePhase]) -> list[ParcelSealWindow]:
    windows: list[ParcelSealWindow] = []
    for index, departure in enumerate(phases):
        if departure.phase_type != PhaseType.DEPARTURE or departure.relevance != "consignment":
            continue
        leg: list[ParcelTracePhase] = [departure]
        inspection: ParcelTracePhase | None = None
        for event in phases[index + 1:]:
            if event.relevance != "consignment" or event.phase_type == PhaseType.DEPARTURE:
                break
            leg.append(event)
            if event.phase_type in {PhaseType.ARRIVAL, PhaseType.UNLOADING}:
                inspection = event
                break
        windows.append(ParcelSealWindow(
            departure_phase_id=departure.id,
            inspection_phase_id=inspection.id if inspection else None,
            phase_ids=[event.id for event in leg],
            origin_name=departure.precinct_name,
            destination_name=inspection.precinct_name if inspection else None,
            departure_seal=departure.seal_number,
            arrival_seal=inspection.seal_number if inspection else None,
            status=_seal_status(departure, inspection),
        ))
    return windows


def _seal_status(
    departure: ParcelTracePhase, inspection: ParcelTracePhase | None,
) -> Literal["matched", "mismatch", "pending", "unverified"]:
    if departure.status == PhaseStatus.OVERRIDDEN or (inspection and inspection.status == PhaseStatus.OVERRIDDEN):
        return "unverified"
    if inspection is None:
        return "unverified"
    if inspection.status not in RESOLVED_STATUSES:
        return "pending"
    if departure.status not in OBSERVED_STATUSES or not departure.seal_number:
        return "unverified"
    if inspection.seal_condition in {"damaged", "missing"}:
        return "mismatch"
    if not inspection.seal_number:
        return "unverified"
    if departure.seal_number != inspection.seal_number:
        return "mismatch"
    # Equal numbers do not fill in an unrecorded condition, especially on legacy plans.
    return "matched" if inspection.seal_condition == "intact" else "unverified"
