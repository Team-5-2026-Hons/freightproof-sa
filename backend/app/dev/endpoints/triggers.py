"""Dev-only trigger endpoints — simulate the parts of the world we cannot yet reach.

Registered by main.py only when dev_panel_enabled() is true. Every trigger drives a
mock's state and then calls the SAME orchestration function the real flow calls; no
endpoint here writes to the database directly.

  scan triggers      -> MockScanFeed.stage_scans  -> scan_service.ingest_scans
  PP triggers        -> MockParcelPerfectClient.stage_waybill_override
                                                   -> consignment_service.fetch_and_sync_consignment
  exception triggers -> exceptions.creation.raise_exception
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.session import get_db
from app.integrations.mock_state import get_mock_state_store
from app.integrations.parcel_perfect.errors import PPManifestNotFoundError, PPUnsupportedError, PPWaybillNotFoundError
from app.integrations.parcel_perfect.factory import get_pp_client
from app.integrations.parcel_perfect.mock import MockParcelPerfectClient
from app.integrations.scan_feed import MockScanFeed, ScanDirection, get_scan_feed
from app.orchestration.substitutions.access import get_current_custody
from app.orchestration.consignments import scans as scan_service
from app.orchestration.consignments import sync as consignment_service
from app.orchestration.exceptions import creation as exception_creation
from app.orchestration.consignments.manifest_snapshot import manifest_snapshot_sha256
from app.dev.services.panel_trips import list_panel_trips
from app.dev.schemas import (
    CloseScanSessionRequest, CloseScanSessionResponse, ConsignmentScanResultRead,
    DevTripSummary, ExceptionTriggerRequest,
    ExceptionTriggerResponse, FlushMockStateResponse, PpManifestTriggerRequest,
    PpManifestTriggerResponse, PpTriggerRequest, PpTriggerResponse, ScanTriggerRequest,
    ScanTriggerResponse,
)
from app.schemas.people import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dev", tags=["dev-triggers"])

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
    return await list_panel_trips(db, organization_id=current_user.organization_id)


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


@router.post(
    "/pp/manifest", response_model=PpManifestTriggerResponse,
    summary="Simulate a PP manifest header change",
)
async def trigger_pp_manifest_change(
    body: PpManifestTriggerRequest,
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PpManifestTriggerResponse:
    """Stage a header change on the mock manifest (FP-281), e.g. to demo MANIFEST_CHANGED."""
    pp_client = get_pp_client()
    if not isinstance(pp_client, MockParcelPerfectClient):
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL)
    try:
        await pp_client.stage_manifest_override(
            body.manifest_number, closed=body.closed,
            planned_departure_at=body.planned_departure_at,
            expected_arrival_at=body.expected_arrival_at,
        )
        manifest = await pp_client.get_manifest(body.manifest_number)
    except PPManifestNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PPUnsupportedError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=_MOCK_REQUIRED_DETAIL) from exc
    return PpManifestTriggerResponse(
        manifest_number=body.manifest_number, snapshot_sha256=manifest_snapshot_sha256(manifest),
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

    custody = await get_current_custody(db, trip=trip)
    try:
        raised = await exception_creation.raise_exception(
            db, trip_id=body.trip_id, driver_id=custody.driver_id,
            exception_type=body.exception_type, description=body.description,
            supporting_artifact_id=None, custody_sequence=custody.sequence,
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
