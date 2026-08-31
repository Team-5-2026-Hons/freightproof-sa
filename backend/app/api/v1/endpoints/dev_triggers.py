"""Dev-only trigger endpoints — simulate the parts of the world we cannot yet reach.

Registered by main.py ONLY when dev_panel_enabled() is true. On an evidence
platform, an endpoint that can fabricate an exception must be unreachable in
production, so two independent conditions gate it and both default to closed.

THE PRINCIPLE THIS FILE EXISTS TO UPHOLD: every trigger drives a MOCK's state and
then calls the SAME orchestration function the real flow calls. No endpoint here
writes to the database directly. A button that INSERTs a row proves only that the
button works; a button that drives the real path proves the product works.

  scan triggers      → MockScanFeed.stage_scans  → scan_service.ingest_scans
  PP triggers        → MockParcelPerfectClient.stage_waybill_override
                                                 → consignment_service.fetch_and_sync_consignment
  exception triggers → exception_service.raise_exception
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

# Returned when a trigger is fired against a non-mock feed. Staging state into a
# mock that is not the live implementation would do nothing at all, and a trigger
# that silently does nothing is worse in a demo than one that fails loudly.
_MOCK_REQUIRED_DETAIL = (
    "This trigger requires the mock implementation — check PP_USE_MOCK and SCAN_FEED_USE_MOCK."
)

def dev_panel_enabled() -> bool:
    """Whether the dev trigger router should be registered at all.

    ONE condition, defaulting to closed. This used to be two — DEV_PANEL_ENABLED *and*
    ENVIRONMENT != "production" — on the reasoning that a single switch is not enough on
    an internet-reachable host. The second gate was removed deliberately, not by
    accident: the deployed demo environment runs with ENVIRONMENT="production" (which is
    also what removes /docs, /redoc and /openapi.json), and the panel is how the
    scan-driven and Parcel-Perfect flows are demonstrated without a real depot feed.
    The alternative was downgrading ENVIRONMENT, which would have re-published the whole
    OpenAPI surface map to get one router back — strictly worse.

    What still stands between these endpoints and the internet, given the gate that went:

      * This flag defaults to False and is a deliberate opt-in, absent from .env.example
        values. An unconfigured deployment has no panel.
      * When it is False the router is not registered AT ALL — the paths 404 rather than
        403, so nothing is merely guarded.
      * Every route in this module carries Depends(get_current_dispatcher). There is no
        anonymous path to any of them.
      * Each trigger additionally refuses unless the relevant integration is the mock
        (_MOCK_REQUIRED_DETAIL), so none of them can touch a real partner system.

    What was genuinely lost: a deployment that sets this flag by mistake in production no
    longer has a second, independent condition to save it. These endpoints fabricate
    scans and exceptions on an evidence platform, so treat the flag as production config
    of the same weight as a credential. Turn it off when the demo window closes.
    """
    return settings.DEV_PANEL_ENABLED


@router.get("/trips", response_model=list[DevTripSummary], summary="Trips and stops for the panel")
async def list_dev_trips(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DevTripSummary]:
    """Trips with their stops, per-stop waybills (with real barcodes), and the
    warehouse-scan gate status at each stop.

    The panel runs on a second device with no trip context of its own, so it needs
    to populate its own pickers. Outer-joined to Driver rather than a separate
    lookup: Trip.driver_id is a required FK, but a degraded label beats a 500 if
    the join ever misses.
    """
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

    # Real barcodes per consignment, sorted — same ordering _resolve_barcodes uses,
    # so a partial scan's "first N" here matches what the panel would actually stage.
    consignment_ids = [c.id for c in consignments]
    parcels = list((await db.execute(
        select(Parcel.consignment_id, Parcel.barcode)
        .where(Parcel.consignment_id.in_(consignment_ids))
        .order_by(Parcel.consignment_id, Parcel.barcode)
    )).all()) if consignment_ids else []
    barcodes_by_consignment: dict[uuid.UUID, list[str]] = {}
    for consignment_id, barcode in parcels:
        barcodes_by_consignment.setdefault(consignment_id, []).append(barcode)

    # Every phase type the scan gate actually reads (imported, not re-declared, so this
    # can never drift from the real gate in phase_gate.py — it was two types, and became
    # three when UNLOADING joined the gate), plus DEPARTURE, which is not gated but is
    # needed below to derive preceding_departure_status. UNLOADING is now in both halves
    # of that union; the repeat is harmless because this list only ever feeds a SQL IN
    # clause, where a duplicate value is a no-op. Extending
    # this one query rather than adding a second round trip keeps this endpoint's
    # batched-query discipline (it already runs once per dispatcher panel load).
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
    # trip_stop_id is unique per row (only trip_creation has NULL, and it's excluded
    # by the phase_type filter above), so trip_stop_id alone is enough of a key.
    phase_status_by_stop: dict[tuple[uuid.UUID, PhaseType], str] = {
        (trip_stop_id, phase_type): str(status)
        for _, trip_stop_id, phase_type, status, _ in phase_events
        if trip_stop_id is not None
    }

    # DEPARTURE events per trip, for resolving preceding_departure_status without a
    # second query. Mirrors phase_service._find_departure_for_leg's rule: the
    # highest-sequence_number DEPARTURE strictly before the stop's own closing event.
    departures_by_trip: dict[uuid.UUID, list[tuple[int, str]]] = {}
    for trip_id_col, _, phase_type, status, sequence_number in phase_events:
        # phase_type is a plain string here (PhaseEvent.phase_type is a String(30)
        # column, not a SQLAlchemy Enum), so this must be `==`, not `is` — the
        # value equals PhaseType.DEPARTURE's str-Enum value but is never the same
        # object as it.
        if phase_type == PhaseType.DEPARTURE:
            departures_by_trip.setdefault(trip_id_col, []).append(
                (sequence_number, str(status))
            )

    # This stop's own closing event (UNLOADING, or CONFIRMATION on the final stop —
    # phase_plan.build_phase_plan emits both back-to-back on a final stop that also
    # drops off, with no DEPARTURE between them, so either sequence number resolves
    # to the same preceding departure). The lower of the two when both exist.
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
            # No unloading/confirmation event at this stop at all — it is the origin.
            return None
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
    """Stage barcodes into the mock feed, then run the real reconciliation.

    Two calls, deliberately: the first is the simulated warehouse doing its job,
    the second is production code that a real WMS poll would call identically.
    """
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

    Precedence: `barcodes_by_reference` (per-waybill selection — a waybill absent
    from the map stages nothing for it, deliberately not falling through to a full
    scan) beats `barcodes` (one literal list for every consignment at the stop,
    which is how an unexpected barcode is injected) beats `parcel_count` (the
    first N expected barcodes, the partial-scan path); omitting all three scans
    everything.
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
    """Close the scan session for every consignment at this stop.

    Drives the mock only. The phase gate reads this state through the same
    ScanFeed a real WMS integration would implement, so nothing downstream knows
    a trigger was involved.
    """
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
    """Stage a waybill override, then run the real consignment sync.

    The sync is fetch_and_sync_consignment — unchanged production code. Note that
    it currently overwrites the reconciliation baseline without raising anything
    (spec §B2c); detecting that drift is Stage 5 and deliberately not built here,
    so this trigger demonstrates the gap rather than a fix.
    """
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
    """Raise through exception_service — the same function the driver's panic page calls.

    The driver id is read from the trip rather than supplied, so the service's own
    "are you the assigned driver" check runs for real instead of being bypassed.
    """
    trip = (await db.execute(select(Trip).where(Trip.id == body.trip_id))).scalar_one_or_none()
    if trip is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Trip {body.trip_id} not found.",
        )

    try:
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
    """Delete every staged mock key. Evidence in PostgreSQL is untouched.

    A POST rather than a DELETE because the dispatcher's typed fetch wrapper has no
    delete verb, and adding one to a shared, separately-tested client for a dev-only
    endpoint is not a trade worth making.
    """
    deleted = await get_mock_state_store().flush()
    logger.info("Dev panel flushed %d mock-state key(s)", deleted)
    return FlushMockStateResponse(keys_deleted=deleted)
