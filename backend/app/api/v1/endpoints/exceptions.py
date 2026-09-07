"""Trip exception endpoints, in two scopes.

The driver raises an exception against a trip they are assigned to, so that route is
trip-nested and authenticated as a driver. The dispatcher works a queue across every
trip in their organisation, so the list and the review action are org-scoped and
cannot hang off a /trips/{trip_id} prefix — hence two routers in one module. They share
a service and a schema; splitting the file would separate code that changes together.

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


# Budgeted generously on purpose: a panic alert is the one request on this API that must
# never be refused because the driver pressed the button more than once. EVIDENCE_WRITE is
# high enough that only scripted abuse reaches it.
@router.post("", response_model=TripExceptionRead, status_code=http_status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit(EVIDENCE_WRITE))])
async def raise_exception_endpoint(
    trip_id: UUID,
    payload: DriverExceptionCreateBody,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> TripExceptionRead:
    # The request carries GPS as JSON floats, but the model column is Decimal
    # (fixed precision). Convert via str() so the binary float's error tail
    # doesn't leak into the stored value; convert at this boundary, not in the
    # orchestration layer, which deliberately only accepts Decimal.
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
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


# Declared BEFORE the /{exception_id} GET below: FastAPI matches path operations in
# declaration order, and "review-queue"/"history" would otherwise be parsed as the
# exception_id path parameter (a UUID), 422-ing on every call instead of routing here.
@dispatcher_router.get("/review-queue", response_model=list[TripExceptionListItem])
async def review_queue_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripExceptionListItem]:
    """Every needs_review exception in the dispatcher's organisation, newest first.

    Deliberately unpaginated: this is a bounded human-work queue, not a full history —
    hiding a large critical backlog behind pages would be unsafe.
    """
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
    """Recorded/reviewed exceptions only (never needs_review — that's the review
    queue's own job), newest first, cursor-paginated.

    `from_date`/`to_date` are inclusive South African calendar dates. `q` matches
    against the trip's reference or the exception's own description.
    """
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


# Rate-limited like the other dispatcher mutations. Not a cost control — this endpoint
# spends no money and calls no partner. It is the same blast-radius cap PRECINCT_MUTATION
# carries: a write that lands on an evidence record, where a client stuck in a retry loop
# should be stopped long before it works through every exception in the organisation.
# Reads on this router stay uncapped beyond the global per-IP net (core/limits.py).
@dispatcher_router.patch("/{exception_id}/review", response_model=TripExceptionRead,
                         dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def review_exception_endpoint(
    exception_id: UUID,
    payload: TripExceptionReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionRead:
    """Record the dispatcher's immutable review of this exception.

    The body carries the assessment, outcome and a required-but-nullable contact method.
    The reviewer and timestamp come from the token and server clock — see review_exception.
    """
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
        # 404 rather than 403 on a wrong-organisation id: a 403 would confirm the row
        # exists to a dispatcher with no right to know that.
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ExceptionAlreadyReviewedError as exc:
        # 409, not a 200 carrying the winner's row. This caller's note was discarded, and
        # a success response would report an account as recorded that never was. The
        # detail names no person — it says a colleague reviewed it, not who.
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=(
                f"Exception '{exception_id}' was already reviewed by a colleague. "
                "Their review is the record; re-read it before reviewing again."
            ),
        ) from exc
