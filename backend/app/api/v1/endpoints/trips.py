"""FastAPI router for trip lifecycle endpoints.

POST /trips             — create a new trip (Handshake 0).
GET  /trips             — list trips for the dispatcher's organisation.
GET  /trips/me          — the authenticated driver's own trips (all statuses).
GET  /trips/me/active   — the trip that driver is currently working.
GET  /trips/me/{trip_id} — full detail for one of that driver's own trips.
GET  /trips/{trip_id}   — get full trip detail by ID (dispatcher).
GET  /trips/pp-manifest-preview — preview a PP manifest (FP-281).
POST /trips/from-pp-manifest — create a loaded trip from a PP manifest (FP-281).
"""

import logging
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.exceptions import (
    ConsignmentAlreadyAssignedError,
    HederaServiceError,
    HederaTimeoutError,
    PPManifestAlreadyOnTripError,
    PPManifestChangedError,
    PPManifestUnusableError,
    PPSyncError,
    PPUnavailableError,
    ResourceNotFoundError,
)
from app.core.constants import PG_INTEGER_MAX
from app.core.limits import PP_LOOKUP, TRIP_CREATE
from app.core.pagination import CursorPosition, decode_cursor
from app.core.rate_limit import rate_limit
from app.db.models.enums import DispatcherRole, TripStatus
from app.db.session import get_db
from app.integrations.parcel_perfect import PPManifestNotFoundError, PPUnsupportedError
from app.orchestration.pp_manifest_service import create_trip_from_pp_manifest, preview_pp_manifest
from app.orchestration.resource_service import get_trip_detail, list_trip_history, list_trips
from app.orchestration.trip_service import (
    create_trip,
    get_active_trip_for_driver,
    get_own_trip_detail_for_driver,
    list_trips_for_driver,
)
from app.schemas.people import DriverRead, UserRead
from app.schemas.pagination import CursorPage
from app.schemas.pp_manifest import (
    PPManifestErrorCode,
    PPManifestPreviewResponse,
    PPManifestWarningCode,
    TripFromPPManifestRequest,
)
from app.schemas.trips import (
    DriverTripListItemResponse,
    TripCreateRequest,
    TripDetailResponse,
    TripHistoryListItemResponse,
    TripListItemResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips", tags=["trips"])

# Stable client-facing text; str(PPUnsupportedError) carries an internal engineering note.
_MANIFEST_UNSUPPORTED_DETAIL = "Manifest lookup is not available from the connected parcel system."
_PP_UNAVAILABLE_DETAIL = "The parcel system is unreachable. Try again shortly."
_HEDERA_TIMEOUT_DETAIL = "Blockchain anchoring timed out, so the trip was not created. Please retry."
_HEDERA_UNAVAILABLE_DETAIL = "Blockchain anchoring is unavailable, so the trip was not created. Please retry."
_UNEXPECTED_DETAIL = "An unexpected error occurred. Please try again."


def _trip_http_error(exc: Exception) -> HTTPException | None:
    """One mapping for both creation endpoints and the manifest preview (spec §10.7), so
    the same failure always gets the same status. None = not ours: re-raise."""
    if isinstance(exc, PPManifestNotFoundError):
        return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PPUnsupportedError):
        return HTTPException(status_code=http_status.HTTP_501_NOT_IMPLEMENTED, detail=_MANIFEST_UNSUPPORTED_DETAIL)
    if isinstance(exc, PPUnavailableError):
        return HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=_PP_UNAVAILABLE_DETAIL)
    if isinstance(exc, PPManifestChangedError):
        return HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={
                "code": PPManifestErrorCode.MANIFEST_CHANGED.value,
                "message": str(exc),
                "preview": exc.preview,
            },
        )
    if isinstance(exc, PPManifestAlreadyOnTripError):
        return HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={
                "code": PPManifestWarningCode.MANIFEST_ALREADY_ON_TRIP.value,
                "message": str(exc),
                "trip_id": str(exc.trip_id) if exc.trip_id is not None else None,
                "trip_reference": exc.trip_reference,
            },
        )
    if isinstance(exc, ConsignmentAlreadyAssignedError):
        return HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, PPManifestUnusableError):
        return HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": str(exc)},
        )
    if isinstance(exc, ResourceNotFoundError):
        return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PPSyncError):
        return HTTPException(status_code=422, detail=f"Waybill sync failed: {exc.reason}")
    if isinstance(exc, HederaTimeoutError):
        return HTTPException(status_code=http_status.HTTP_504_GATEWAY_TIMEOUT, detail=_HEDERA_TIMEOUT_DETAIL)
    if isinstance(exc, HederaServiceError):
        logger.error("Hedera anchoring failed during trip creation: %s", exc)
        return HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY, detail=_HEDERA_UNAVAILABLE_DETAIL)
    if isinstance(exc, SQLAlchemyError):
        logger.exception("Database error on a trip endpoint")
        return HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_UNEXPECTED_DETAIL)
    return None


@router.post(
    "",
    response_model=TripDetailResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create a new trip (Handshake 0)",
    # Every call submits a journey-lock hash to Hedera — real network spend, synchronously.
    # This is the most expensive door in the API, so it carries the tightest budget.
    dependencies=[Depends(rate_limit(TRIP_CREATE))],
)
async def create_trip_endpoint(
    payload: TripCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """The explicit path: empty legs, multi-stop trips, seeds and tests (spec §10.3).
    Loaded trips from a PP manifest go through POST /trips/from-pp-manifest. This
    path has no duplicate key; a retried empty leg can be cancelled.
    The H0 PhaseEvent (Trip Creation) is created atomically with the trip row and the
    journey lock is anchored to Hedera HCS before the response."""
    try:
        return await create_trip(db=db, payload=payload, current_user=current_user)
    except Exception as exc:
        http_error = _trip_http_error(exc)
        if http_error is None:
            raise
        raise http_error from exc


@router.post(
    "/from-pp-manifest",
    response_model=TripDetailResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create a loaded trip from a Parcel Perfect manifest",
    # Anchors a journey lock on Hedera, like POST /trips: same tight budget.
    dependencies=[Depends(rate_limit(TRIP_CREATE))],
)
async def create_trip_from_pp_manifest_endpoint(
    payload: TripFromPPManifestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    """One non-cancelled trip per manifest (409 MANIFEST_ALREADY_ON_TRIP). A manifest
    that changed since its preview is refused with the fresh preview (409 MANIFEST_CHANGED)."""
    try:
        return await create_trip_from_pp_manifest(db, payload, current_user)
    except Exception as exc:
        http_error = _trip_http_error(exc)
        if http_error is None:
            raise
        raise http_error from exc


@router.get(
    "",
    response_model=list[TripListItemResponse],
    summary="List trips for the dispatcher's organisation",
)
async def list_trips_endpoint(
    status: Annotated[list[TripStatus] | None, Query()] = None,
    pp_manifest_number: Annotated[int | None, Query(gt=0, le=PG_INTEGER_MAX)] = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripListItemResponse]:
    return await list_trips(
        db=db,
        operator_organization_id=current_user.organization_id,
        status_filter=status,
        pp_manifest_number=pp_manifest_number,
    )


@router.get(
    "/history",
    response_model=CursorPage[TripHistoryListItemResponse],
    summary="Cursor-paginated trip history for the dispatcher's organisation",
)
async def list_trip_history_endpoint(
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    q: str | None = Query(default=None, max_length=255),
    precinct_id: UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> CursorPage[TripHistoryListItemResponse]:
    """Closed and cancelled trips ordered by their terminal timestamp.

    Date bounds are inclusive calendar dates in the configured operations timezone;
    q matches trip reference or driver name, or a PP manifest number exactly.
    """
    cursor_position: CursorPosition | None = None
    if cursor is not None:
        try:
            cursor_position = decode_cursor(cursor)
        except ValueError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    return await list_trip_history(
        db,
        operator_organization_id=current_user.organization_id,
        limit=limit,
        cursor_position=cursor_position,
        q=q,
        precinct_id=precinct_id,
        from_date=from_date,
        to_date=to_date,
    )


# Declared before GET /trips/{trip_id}: FastAPI matches routes in declaration order, so
# this literal path registered after "/{trip_id}" would 422 on UUID parsing.
@router.get(
    "/pp-manifest-preview",
    response_model=PPManifestPreviewResponse,
    summary="Preview a Parcel Perfect manifest before creating its trip",
    # Reaches Parcel Perfect, a partner's quota we neither own nor pay for.
    dependencies=[Depends(rate_limit(PP_LOOKUP))],
)
async def preview_pp_manifest_endpoint(
    manifest_number: Annotated[int, Query(gt=0, le=PG_INTEGER_MAX)],
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPManifestPreviewResponse:
    """Read-only. Warnings say what blocks creation and what the dispatcher must supply."""
    try:
        return await preview_pp_manifest(
            db, manifest_number=manifest_number,
            operator_organization_id=current_user.organization_id,
        )
    except Exception as exc:
        http_error = _trip_http_error(exc)
        if http_error is None:
            raise
        raise http_error from exc


@router.get(
    "/me/active",
    response_model=TripDetailResponse | None,
    summary="Driver's current active trip",
)
async def get_my_active_trip_endpoint(
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse | None:
    return await get_active_trip_for_driver(db, driver_id=current_driver.id)


# Declared before GET /trips/{trip_id}: FastAPI matches routes in declaration order, so
# a literal "/me..." path registered after "/{trip_id}" would be swallowed by it and
# 422 on "me" failing UUID parsing.
@router.get(
    "/me",
    response_model=list[DriverTripListItemResponse],
    summary="Driver's own trips (all statuses)",
)
async def list_my_trips_endpoint(
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> list[DriverTripListItemResponse]:
    """Every trip assigned to the authenticated driver, newest first.

    Returns terminal trips too — the PWA groups the list into Active/Upcoming/Past
    by trip status client-side and needs closed/cancelled rows for the Past tab.
    """
    return await list_trips_for_driver(db, driver_id=current_driver.id)


@router.get(
    "/me/{trip_id}",
    response_model=TripDetailResponse,
    summary="Full detail for one of the driver's own trips",
)
async def get_my_trip_detail_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripDetailResponse:
    """404 when the trip belongs to another driver — deliberately indistinguishable
    from a non-existent trip, so this cannot be used to probe for real trip ids.
    """
    try:
        return await get_own_trip_detail_for_driver(
            db, driver_id=current_driver.id, trip_id=trip_id
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.get(
    "/{trip_id}",
    response_model=TripDetailResponse,
    summary="Get full trip detail by ID",
)
async def get_trip_detail_endpoint(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripDetailResponse:
    try:
        detail = await get_trip_detail(
            db=db,
            trip_id=trip_id,
            operator_organization_id=current_user.organization_id,
            include_reviewer_names=True,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if current_user.role != DispatcherRole.ADMIN_DISPATCHER:
        detail = detail.model_copy(update={"blockchain_receipts": []})
    return detail
