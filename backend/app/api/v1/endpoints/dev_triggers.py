"""Dev-only trigger endpoints — simulate the parts of the world we cannot yet reach.

Registered by main.py only when dev_panel_enabled() is true. Every trigger drives a
mock's state and then calls the SAME orchestration function the real flow calls; no
endpoint here writes to the database directly.

  scan triggers      -> MockScanFeed.stage_scans  -> scan_service.ingest_scans
  PP triggers        -> MockParcelPerfectClient.stage_waybill_override
                                                   -> consignment_service.fetch_and_sync_consignment
  exception triggers -> exception_service.raise_exception
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import PhaseType
from app.db.models.organisations import Precinct
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.integrations.mock_state import get_mock_state_store
from app.integrations.parcel_perfect import (
    MockParcelPerfectClient, PPUnsupportedError, PPWaybillNotFoundError, get_pp_client,
)
from app.integrations.scan_feed import MockScanFeed, ScanDirection, get_scan_feed
from app.orchestration import consignment_service, exception_service, scan_service
from app.orchestration.phase_gate import GATED_PHASES
from app.schemas.dev import (
    CloseScanSessionRequest, CloseScanSessionResponse, ConsignmentScanResultRead,
    DevConsignment, DevTripStop, DevTripSummary, ExceptionTriggerRequest,
    ExceptionTriggerResponse, FlushMockStateResponse, PpTriggerRequest, PpTriggerResponse,
    ScanTriggerRequest, ScanTriggerResponse,
)
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dev", tags=["dev-triggers"])

# A trigger that silently does nothing against a non-mock feed is worse than failing loudly.
_MOCK_REQUIRED_DETAIL = (
    "This trigger requires the mock implementation — check PP_USE_MOCK and SCAN_FEED_USE_MOCK."
)

def dev_panel_enabled() -> bool:
    """Whether the dev trigger router should be registered at all.

    One condition, defaulting closed (DEV_PANEL_ENABLED). A second gate,
    ENVIRONMENT != "production", was deliberately removed: the deployed demo host runs
    with ENVIRONMENT="production" (that's what hides /docs et al.), and this panel is
    how the scan/PP flows are demonstrated without a real depot feed.

    What still stands: the router isn't registered at all when False (404, not 403);
    every route requires Depends(get_current_dispatcher); and each trigger additionally
    refuses unless the relevant integration is the mock. Treat this flag as production
    config of the same weight as a credential — turn it off when the demo window closes.
    """
    return settings.DEV_PANEL_ENABLED


@router.get("/trips", response_model=list[DevTripSummary], summary="Trips and stops for the panel")
async def list_dev_trips(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DevTripSummary]:
    """Trips with their stops, per-stop waybills (with real barcodes), and the
    warehouse-scan gate status at each stop, for the panel's own pickers."""
    trips_with_driver = list((await db.execute(
        select(Trip, Driver.full_name)
        .outerjoin(Driver, Driver.id == Trip.driver_id)
        .where(Trip.operator_organization_id == current_user.organization_id)
        .order_by(Trip.created_at.desc())
    )).all())
    if not trips_with_driver:
        return []

    trips = [row[0] for row in trips_with_driver]
    driver_name_by_trip: dict[uuid.UUID, Optional[str]] = {
        row[0].id: row[1] for row in trips_with_driver
    }

    trip_ids = [t.id for t in trips]
    stops = list((await db.execute(
        select(TripStop, Precinct.name)
        .join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id.in_(trip_ids))
        .order_by(TripStop.sequence)
    )).all())
    consignments = list((await db.execute(
        select(Consignment).where(Consignment.trip_id.in_(trip_ids))
    )).scalars().all())

    # Sorted the same way _resolve_barcodes orders them, so "first N" matches what
    # the panel would actually stage.
    consignment_ids = [c.id for c in consignments]
    parcels = list((await db.execute(
        select(Parcel.consignment_id, Parcel.barcode)
        .where(Parcel.consignment_id.in_(consignment_ids))
        .order_by(Parcel.consignment_id, Parcel.barcode)
    )).all()) if consignment_ids else []
    barcodes_by_consignment: dict[uuid.UUID, list[str]] = {}
    for consignment_id, barcode in parcels:
        barcodes_by_consignment.setdefault(consignment_id, []).append(barcode)

    # Imported, not re-declared, so this can never drift from phase_gate.py. Plus
    # DEPARTURE (not gated) to derive preceding_departure_status below; extending this
    # one query rather than adding a second keeps this endpoint's batched-query discipline.
    gated_phase_types = list(GATED_PHASES.keys())
    phase_event_types = [*gated_phase_types, PhaseType.UNLOADING, PhaseType.DEPARTURE]
    phase_events = list((await db.execute(
        select(
            PhaseEvent.trip_id, PhaseEvent.trip_stop_id,
            PhaseEvent.phase_type, PhaseEvent.status, PhaseEvent.sequence_number,
        )
        .where(
            PhaseEvent.trip_id.in_(trip_ids),
            PhaseEvent.phase_type.in_(phase_event_types),
        )
    )).all())
    # trip_stop_id alone is a safe key: only trip_creation is NULL, excluded by the filter above.
    phase_status_by_stop: dict[tuple[uuid.UUID, PhaseType], str] = {
        (trip_stop_id, phase_type): str(status)
        for _, trip_stop_id, phase_type, status, _ in phase_events
        if trip_stop_id is not None
    }

    # DEPARTURE events per trip, mirroring phase_service._find_departure_for_leg's rule:
    # the highest-sequence_number DEPARTURE strictly before the stop's own closing event.
    departures_by_trip: dict[uuid.UUID, list[tuple[int, str]]] = {}
    for trip_id_col, _, phase_type, status, sequence_number in phase_events:
        # `==`, not `is`: phase_type is a plain string column, never the same object as the enum.
        if phase_type == PhaseType.DEPARTURE:
            departures_by_trip.setdefault(trip_id_col, []).append(
                (sequence_number, str(status))
            )

    # This stop's own closing event (UNLOADING, or CONFIRMATION on a final stop that
    # also drops off); the lower sequence number when both exist.
    closing_sequence_by_stop: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    for trip_id_col, trip_stop_id, phase_type, _, sequence_number in phase_events:
        if trip_stop_id is None or phase_type not in (PhaseType.UNLOADING, PhaseType.CONFIRMATION):
            continue
        key = (trip_id_col, trip_stop_id)
        if key not in closing_sequence_by_stop or sequence_number < closing_sequence_by_stop[key]:
            closing_sequence_by_stop[key] = sequence_number

    def _preceding_departure_status(trip_id_: uuid.UUID, trip_stop_id: uuid.UUID) -> Optional[str]:
        closing_sequence = closing_sequence_by_stop.get((trip_id_, trip_stop_id))
        if closing_sequence is None:
            return None  # no unloading/confirmation at this stop — it's the origin
        preceding = [
            (sequence, status) for sequence, status in departures_by_trip.get(trip_id_, [])
            if sequence < closing_sequence
        ]
        if not preceding:
            return None
        return max(preceding, key=lambda item: item[0])[1]

    def _dev_consignment(c: Consignment) -> DevConsignment:
        return DevConsignment(
            consignment_id=c.id,
            parcel_perfect_reference=c.parcel_perfect_reference,
            barcodes=barcodes_by_consignment.get(c.id, []),
        )

    summaries: list[DevTripSummary] = []
    for trip in trips:
        trip_stops: list[DevTripStop] = []
        for stop, precinct_name in stops:
            if stop.trip_id != trip.id:
                continue
            trip_stops.append(DevTripStop(
                trip_stop_id=stop.id,
                sequence=stop.sequence,
                precinct_name=precinct_name,
                pickup_consignments=[
                    _dev_consignment(c) for c in consignments if c.pickup_stop_id == stop.id
                ],
                delivery_consignments=[
                    _dev_consignment(c) for c in consignments if c.delivery_stop_id == stop.id
                ],
                loading_phase_status=phase_status_by_stop.get((stop.id, PhaseType.LOADING)),
                confirmation_phase_status=phase_status_by_stop.get(
                    (stop.id, PhaseType.CONFIRMATION)
                ),
                preceding_departure_status=_preceding_departure_status(trip.id, stop.id),
            ))
        summaries.append(DevTripSummary(
            trip_id=trip.id,
            trip_reference=trip.trip_reference,
            status=str(trip.status),
            current_phase=trip.current_phase,
            stops=trip_stops,
            driver_full_name=driver_name_by_trip.get(trip.id),
            created_at=trip.created_at,
        ))
    return summaries


@router.post("/scans", response_model=ScanTriggerResponse, summary="Simulate a warehouse scan")
async def trigger_scan(
    body: ScanTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ScanTriggerResponse:
    """Stage barcodes into the mock feed, then run the real reconciliation."""
    feed = get_scan_feed()
    if not isinstance(feed, MockScanFeed):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    try:
        consignments = await scan_service.load_consignments_at_stop(
            db, trip_id=body.trip_id, trip_stop_id=body.trip_stop_id, direction=body.direction,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if not consignments:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=(
                f"No consignment is {'picked up' if body.direction is ScanDirection.OUT else 'delivered'} "
                f"at stop {body.trip_stop_id} on this trip."
            ),
        )

    for consignment in consignments:
        barcodes = await _resolve_barcodes(db, consignment=consignment, body=body)
        await feed.stage_scans(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(body.trip_stop_id),
            direction=body.direction,
            barcodes=barcodes,
        )

    try:
        result = await scan_service.ingest_scans(
            db, trip_id=body.trip_id, trip_stop_id=body.trip_stop_id, direction=body.direction,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await db.commit()
    return ScanTriggerResponse(
        trip_id=result.trip_id,
        trip_stop_id=result.trip_stop_id,
        direction=result.direction,
        consignments=[
            ConsignmentScanResultRead(
                consignment_id=c.consignment_id,
                parcel_perfect_reference=c.parcel_perfect_reference,
                expected_count=c.expected_count,
                observed_count=c.observed_count,
                matched_barcodes=c.matched_barcodes,
                missing_barcodes=c.missing_barcodes,
                unexpected_barcodes=c.unexpected_barcodes,
                exception_ids=c.exception_ids,
            )
            for c in result.consignments
        ],
    )


async def _resolve_barcodes(
    db: AsyncSession, *, consignment: Consignment, body: ScanTriggerRequest,
) -> list[str]:
    """Work out which barcodes the simulated warehouse reports for one consignment.

    Precedence: `barcodes_by_reference` (per-waybill, absent = nothing staged) beats
    `barcodes` (literal list, can inject an unexpected barcode) beats `parcel_count`
    (first N, partial scan); omitting all three scans everything.
    """
    expected = [row[0] for row in (await db.execute(
        select(Parcel.barcode)
        .where(Parcel.consignment_id == consignment.id)
        .order_by(Parcel.barcode)
    )).all()]

    if body.barcodes_by_reference is not None:
        return body.barcodes_by_reference.get(consignment.parcel_perfect_reference, [])
    if body.barcodes is not None:
        return body.barcodes
    if body.parcel_count is not None:
        return expected[: body.parcel_count]
    return expected


@router.post(
    "/scans/close-session",
    response_model=CloseScanSessionResponse,
    summary="Simulate the warehouse finishing its scan at a stop",
)
async def close_scan_session(
    payload: CloseScanSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> CloseScanSessionResponse:
    """Close the scan session for every consignment at this stop (drives the mock only)."""
    feed = get_scan_feed()
    if not isinstance(feed, MockScanFeed):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    try:
        consignments = await scan_service.load_consignments_at_stop(
            db, trip_id=payload.trip_id, trip_stop_id=payload.trip_stop_id,
            direction=payload.direction,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc),
        ) from exc

    for consignment in consignments:
        await feed.close_session(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(payload.trip_stop_id),
            direction=payload.direction,
        )

    return CloseScanSessionResponse(
        trip_id=payload.trip_id,
        trip_stop_id=payload.trip_stop_id,
        direction=payload.direction,
        sessions_closed=len(consignments),
    )


@router.post("/pp/waybill", response_model=PpTriggerResponse, summary="Simulate a PP waybill change")
async def trigger_pp_change(
    body: PpTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PpTriggerResponse:
    """Stage a waybill override, then run the real consignment sync (fetch_and_sync_consignment)."""
    pp_client = get_pp_client()
    if not isinstance(pp_client, MockParcelPerfectClient):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        )

    consignment = (await db.execute(
        select(Consignment).where(
            Consignment.trip_id == body.trip_id,
            Consignment.parcel_perfect_reference == body.parcel_perfect_reference,
        )
    )).scalar_one_or_none()
    if consignment is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Consignment {body.parcel_perfect_reference!r} is not on trip {body.trip_id}.",
        )

    try:
        await pp_client.stage_waybill_override(
            body.parcel_perfect_reference,
            manifest=body.manifest,
            poddate=body.poddate,
            failtype=body.failtype,
            parcel_count=body.parcel_count,
        )
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PPUnsupportedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL,
        ) from exc

    # Overwrites the reconciliation baseline without raising (spec §B2c); detecting that
    # drift is Stage 5, deliberately not built here.
    sync_result = await consignment_service.fetch_and_sync_consignment(
        db, body.parcel_perfect_reference, trip_id=body.trip_id,
    )
    await db.commit()

    details = (sync_result.consignment.pp_raw_json or {}).get("details", {})
    return PpTriggerResponse(
        consignment_id=sync_result.consignment.id,
        parcel_perfect_reference=sync_result.consignment.parcel_perfect_reference,
        parcel_count_expected=sync_result.consignment.parcel_count_expected,
        pp_manifest_number=sync_result.consignment.pp_manifest_number,
        poddate=details.get("poddate", ""),
        failtype=details.get("failtype"),
        warning=sync_result.warning,
    )


@router.post("/exceptions", response_model=ExceptionTriggerResponse, summary="Raise an exception")
async def trigger_exception(
    body: ExceptionTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ExceptionTriggerResponse:
    """Raise through exception_service, the same function the driver's panic page calls."""
    trip = (await db.execute(select(Trip).where(Trip.id == body.trip_id))).scalar_one_or_none()
    if trip is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {body.trip_id} not found.",
        )

    try:
        # driver_id read from the trip, not the body, so the service's own
        # assigned-driver check runs for real instead of being bypassed.
        raised = await exception_service.raise_exception(
            db, trip_id=body.trip_id, driver_id=trip.driver_id,
            exception_type=body.exception_type, description=body.description,
            supporting_artifact_id=None,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await db.commit()
    return ExceptionTriggerResponse(
        exception_id=raised.id,
        trip_id=body.trip_id,
        exception_type=body.exception_type,
        severity=str(raised.severity),
        description=raised.description,
    )


@router.post("/mock-state/flush", response_model=FlushMockStateResponse,
             summary="Clear staged mock state")
async def flush_mock_state(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> FlushMockStateResponse:
    """Delete every staged mock key. Evidence in PostgreSQL is untouched."""
    deleted = await get_mock_state_store().flush()
    logger.info("Dev panel flushed %d mock-state key(s)", deleted)
    return FlushMockStateResponse(keys_deleted=deleted)
