"""Trip exception endpoints, in two scopes: driver-raised (trip-nested) and dispatcher
review (org-scoped, since the queue spans every trip) — hence two routers in one module.

Both dispatcher routes scope on the token's organisation as an authorisation boundary,
not a filter: another operator's exception must be unreachable by guessing a UUID.
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.exceptions import ExceptionAlreadyReviewedError, ResourceNotFoundError
from app.core.limits import EVIDENCE_WRITE, FLEET_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity
from app.db.session import get_db
from app.orchestration.exception_service import (
    get_exception_detail,
    list_exception_history,
    list_review_queue,
    raise_exception,
    review_exception,
)
from app.schemas.pagination import CursorPage
from app.schemas.people import DriverRead, UserRead
from app.schemas.transit import (
    DriverExceptionCreateBody,
    TripExceptionDetail,
    TripExceptionListItem,
    TripExceptionRead,
    TripExceptionReviewRequest,
)

router = APIRouter(prefix="/trips/{trip_id}/exceptions", tags=["exceptions"])

# Org-scoped, not trip-scoped. The dispatcher's exception queue spans every trip in
# the organisation, which a /trips/{trip_id} prefix structurally cannot serve.
dispatcher_router = APIRouter(prefix="/exceptions", tags=["exceptions"])


# Budgeted generously: a panic alert must never be refused for a double-press.
@router.post("", response_model=TripExceptionRead, status_code=http_status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit(EVIDENCE_WRITE))])
async def raise_exception_endpoint(
    trip_id: UUID,
    payload: DriverExceptionCreateBody,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripExceptionRead:
    # Convert via str() so the binary float's error tail doesn't leak into the stored Decimal.
    gps_lat = Decimal(str(payload.gps_lat)) if payload.gps_lat is not None else None
    gps_lng = Decimal(str(payload.gps_lng)) if payload.gps_lng is not None else None
    try:
        return await raise_exception(
            db, trip_id=trip_id, driver_id=current_driver.id,
            exception_type=payload.exception_type, description=payload.description,
            supporting_artifact_id=payload.supporting_artifact_id,
            phase_event_id=payload.phase_event_id,
            gps_lat=gps_lat, gps_lng=gps_lng,
            client_report_id=payload.client_report_id,
            vehicle_type=payload.vehicle_type, trailer_id=payload.trailer_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


# Declared BEFORE /{exception_id}: FastAPI matches routes in declaration order, or
# "review-queue" would be parsed as the exception_id path parameter.
@dispatcher_router.get("/review-queue", response_model=list[TripExceptionListItem])
async def review_queue_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripExceptionListItem]:
    """Every needs_review exception in the dispatcher's organisation, newest first — unpaginated."""
    return await list_review_queue(db, organization_id=current_user.organization_id)


@dispatcher_router.get("/history", response_model=CursorPage[TripExceptionListItem])
async def exception_history_endpoint(
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    q: str | None = Query(default=None, max_length=255),
    review_status: ExceptionReviewStatus | None = None,
    severity: ExceptionSeverity | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> CursorPage[TripExceptionListItem]:
    """Recorded/reviewed exceptions only (never needs_review), newest first, cursor-paginated."""
    try:
        return await list_exception_history(
            db,
            organization_id=current_user.organization_id,
            limit=limit,
            cursor=cursor,
            q=q,
            review_status=review_status,
            severity=severity,
            from_date=from_date,
            to_date=to_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@dispatcher_router.get("/{exception_id}", response_model=TripExceptionDetail)
async def get_exception_detail_endpoint(
    exception_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionDetail:
    """One exception, any review state, any trip lifecycle — a permalink target."""
    try:
        return await get_exception_detail(
            db, exception_id=exception_id, organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# Rate-limited like other dispatcher mutations, not for cost control — it's a
# blast-radius cap on a write that lands on an evidence record.
@dispatcher_router.patch("/{exception_id}/review", response_model=TripExceptionRead,
                         dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def review_exception_endpoint(
    exception_id: UUID,
    payload: TripExceptionReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionRead:
    """Record the dispatcher's immutable review of this exception."""
    try:
        return await review_exception(
            db,
            exception_id=exception_id,
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            review_note=payload.review_note,
            review_outcome=payload.review_outcome,
            contact_method=payload.contact_method,
        )
    except ResourceNotFoundError as exc:
        # 404, not 403, on a wrong-organisation id — a 403 would confirm the row exists.
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ExceptionAlreadyReviewedError as exc:
        # 409, not a 200 carrying the winner's row; detail names no person.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=(
                f"Exception '{exception_id}' was already reviewed by a colleague. "
                "Their review is the record; re-read it before reviewing again."
            ),
        ) from exc
