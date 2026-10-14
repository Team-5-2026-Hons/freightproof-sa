"""Derive consignment progress and custody legs from the stored phase plan."""

from typing import Literal
from uuid import UUID

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import TripStop
from app.orchestration.parcel_trace.evidence import RESOLVED_STATUSES, last_recorded_location, location_verdict, seal_windows
from app.orchestration.parcel_trace.queries import JourneyRecords
from app.schemas.parcel_trace import (
    ParcelJourney, ParcelProgress, ParcelScanObservation, ParcelTraceException, ParcelTracePhase,
)


def _cargo_stops(records: JourneyRecords) -> tuple[TripStop | None, TripStop | None]:
    cargo = records.consignment
    if cargo is not None:
        pickup = next((s for s in records.stops if s.id == cargo.pickup_stop_id), None)
        delivery = next((s for s in records.stops if s.id == cargo.delivery_stop_id), None)
        return pickup, delivery
    # FP-281 manifest creation is a two-stop contract. Do not infer boundaries for
    # arbitrary historical multi-stop plans whose consignment links no longer exist.
    if records.trip.pp_manifest_number is not None and len(records.stops) == 2:
        return records.stops[0], records.stops[-1]
    return None, None


def _window(records: JourneyRecords, pickup: TripStop | None, delivery: TripStop | None) -> tuple[int, int] | None:
    if pickup is None or delivery is None or pickup.sequence > delivery.sequence:
        return None
    starts = [p.sequence_number for p in records.phases if p.trip_stop_id == pickup.id and p.phase_type == PhaseType.LOADING]
    ends = [p.sequence_number for p in records.phases if p.trip_stop_id == delivery.id and p.phase_type in {PhaseType.UNLOADING, PhaseType.CONFIRMATION}]
    if not starts or not ends or min(starts) > max(ends):
        return None
    return min(starts), max(ends)


def _project_phase(event: PhaseEvent, records: JourneyRecords, window: tuple[int, int] | None) -> ParcelTracePhase:
    stop = next((s for s in records.stops if s.id == event.trip_stop_id), None)
    return ParcelTracePhase(
        id=event.id, sequence_number=event.sequence_number, phase_type=event.phase_type, status=event.status,
        completed_at=event.completed_at, driver_captured_at=event.driver_captured_at,
        precinct_id=stop.precinct_id if stop else None,
        precinct_name=records.precinct_names.get(stop.precinct_id) if stop else None,
        relevance=_relevance(event, records, window),
        anchor_status=event.anchor_status, seal_number=event.seal_number, seal_condition=event.seal_condition,
        location_verdict=location_verdict(event), override_note=event.dispatcher_override_note,
    )


def _relevance(
    event: PhaseEvent, records: JourneyRecords, window: tuple[int, int] | None,
) -> Literal["consignment", "trip_context", "unknown"]:
    if window is None:
        return "unknown"
    if not window[0] <= event.sequence_number <= window[1]:
        return "trip_context"
    pickup, delivery = _cargo_stops(records)
    # Through-carried cargo inherits the leg evidence, not other consignments'
    # loading/unloading observations at an intermediate stop.
    expected = pickup if event.phase_type == PhaseType.LOADING else delivery if event.phase_type == PhaseType.UNLOADING else None
    if expected is not None and event.trip_stop_id != expected.id:
        return "trip_context"
    return "consignment"


def _progress(records: JourneyRecords, window: tuple[int, int] | None) -> ParcelProgress:
    unresolved = next((p for p in records.phases if p.status not in RESOLVED_STATUSES), None)
    relevant = [p for p in records.phases if window and window[0] <= p.sequence_number <= window[1]]
    current = unresolved or (relevant[-1] if relevant else None)
    result = ParcelProgress(position="unknown", has_overrides=any(p.status == PhaseStatus.OVERRIDDEN for p in relevant))
    if records.trip.status == TripStatus.CANCELLED:
        result.position = "cancelled"
        current = next((p for p in reversed(relevant) if p.status in RESOLVED_STATUSES), None)
    elif window is not None:
        if unresolved is None or unresolved.sequence_number > window[1]:
            result.position = "after_delivery"
            current = relevant[-1] if relevant else None
        elif unresolved.sequence_number < window[0]:
            result.position = "before_pickup"
        else:
            result.position = "within_journey"
    if current is not None:
        result.phase_event_id = current.id
        result.phase_type = current.phase_type
        result.phase_status = current.status
    return result


def project_journey(records: JourneyRecords) -> ParcelJourney:
    pickup, delivery = _cargo_stops(records)
    window = _window(records, pickup, delivery)
    phases = [_project_phase(event, records, window) for event in records.phases]
    relevant_ids = {phase.id for phase in phases if phase.relevance == "consignment"}
    return ParcelJourney(
        trip_id=records.trip.id, trip_reference=records.trip.trip_reference,
        trip_status=records.trip.status, created_at=records.trip.created_at,
        vehicle_registration=records.vehicle_registration,
        membership_source="current_assignment" if records.consignment is not None else "creation_manifest",
        origin_name=records.precinct_names.get(pickup.precinct_id) if pickup else None,
        destination_name=records.precinct_names.get(delivery.precinct_id) if delivery else None,
        progress=_progress(records, window), last_recorded_location=last_recorded_location(records, relevant_ids),
        scans=[ParcelScanObservation(
            parcel_id=p.id, status=p.status, scan_out_at=p.pp_scan_out_at, scan_in_at=p.pp_scan_in_at,
        ) for p in records.parcels],
        phases=phases, seal_windows=seal_windows(phases),
        exceptions=[ParcelTraceException(
            id=e.id, phase_event_id=e.phase_event_id, exception_type=e.exception_type,
            severity=e.severity, description=e.description, recorded_at=e.created_at,
            scope="consignment" if e.consignment_id is not None else "trip_context", review_status=e.review_status,
        ) for e in records.exceptions],
        gaps=_gaps(records, relevant_ids, window),
    )


def _gaps(records: JourneyRecords, relevant_ids: set[UUID], window: tuple[int, int] | None) -> list[str]:
    gaps: list[str] = []
    if not records.phases:
        gaps.append("No phase ledger is recorded for this trip.")
    if window is None:
        gaps.append("The historical pickup/delivery boundaries are unavailable; phases are shown as trip context.")
    if records.consignment is None:
        gaps.append("This barcode appears in the creation manifest. Planned membership does not prove it was loaded.")
    if len(records.parcels) > 1:
        gaps.append("Multiple parcel records share this barcode and waybill; their scan observations are shown separately.")
    if records.parcels and not any(p.pp_scan_in_at for p in records.parcels):
        gaps.append("No destination parcel scan is recorded. A missing scan is an evidence gap, not proof of loss.")
    if any(p.id in relevant_ids and p.status == PhaseStatus.OVERRIDDEN for p in records.phases):
        gaps.append("An overridden phase advanced the journey without the usual completion evidence.")
    return gaps
