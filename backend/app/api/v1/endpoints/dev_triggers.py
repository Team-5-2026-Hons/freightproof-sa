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

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.organisations import Precinct
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.session import get_db
from app.integrations.mock_state import get_mock_state_store
from app.integrations.parcel_perfect import (
    MockParcelPerfectClient, PPUnsupportedError, PPWaybillNotFoundError, get_pp_client,
)
from app.integrations.scan_feed import MockScanFeed, ScanDirection, get_scan_feed
from app.orchestration import consignment_service, exception_service, scan_service
from app.schemas.dev import (
    CloseScanSessionRequest, CloseScanSessionResponse, ConsignmentScanResultRead,
    DevTripStop, DevTripSummary, ExceptionTriggerRequest, ExceptionTriggerResponse,
    FlushMockStateResponse, PpTriggerRequest, PpTriggerResponse, ScanTriggerRequest,
    ScanTriggerResponse,
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

_PRODUCTION_ENVIRONMENT = "production"


def dev_panel_enabled() -> bool:
    """Whether the dev trigger router should be registered at all.

    Two independent conditions, both defaulting to closed. On an internet-reachable
    demo host a single switch is not enough: ENVIRONMENT is deployment config that
    is easy to get wrong, and DEV_PANEL_ENABLED is an explicit opt-in that has to
    be typed on purpose. Either one being wrong still leaves the panel absent.
    """
    return settings.DEV_PANEL_ENABLED and settings.ENVIRONMENT != _PRODUCTION_ENVIRONMENT


@router.get("/trips", response_model=list[DevTripSummary], summary="Trips and stops for the panel")
async def list_dev_trips(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[DevTripSummary]:
    """Trips with their stops and per-stop consignment references.

    The panel runs on a second device with no trip context of its own, so it needs
    to populate its own pickers.
    """
    trips = list((await db.execute(
        select(Trip)
        .where(Trip.operator_organization_id == current_user.organization_id)
        .order_by(Trip.created_at.desc())
    )).scalars().all())
    if not trips:
        return []

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
                pickup_consignment_references=[
                    c.parcel_perfect_reference for c in consignments
                    if c.pickup_stop_id == stop.id
                ],
                delivery_consignment_references=[
                    c.parcel_perfect_reference for c in consignments
                    if c.delivery_stop_id == stop.id
                ],
            ))
        summaries.append(DevTripSummary(
            trip_id=trip.id,
            trip_reference=trip.trip_reference,
            status=str(trip.status),
            current_phase=trip.current_phase,
            stops=trip_stops,
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
    """Work out which barcodes the simulated warehouse reports.

    An explicit list wins (that is how an unexpected barcode is injected).
    Otherwise the first `parcel_count` expected barcodes are scanned, which is the
    partial-scan path; omitting both scans everything.
    """
    expected = [row[0] for row in (await db.execute(
        select(Parcel.barcode)
        .where(Parcel.consignment_id == consignment.id)
        .order_by(Parcel.barcode)
    )).all()]

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
