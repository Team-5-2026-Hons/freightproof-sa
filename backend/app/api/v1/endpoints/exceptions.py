"""Trip exception endpoints, in two scopes.

The driver raises an exception against a trip they are assigned to, so that route is
trip-nested and authenticated as a driver. The dispatcher works a queue across every
trip in their organisation, so the list and the resolve action are org-scoped and
cannot hang off a /trips/{trip_id} prefix — hence two routers in one module. They share
a service and a schema; splitting the file would separate code that changes together.

Both dispatcher routes scope on the token's organisation as an authorisation boundary,
not a filter: another operator's exception must be unreachable by guessing a UUID.
"""

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.exceptions import ExceptionAlreadyResolvedError, ResourceNotFoundError
from app.core.limits import EVIDENCE_WRITE, FLEET_MUTATION
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.orchestration.exception_service import (
    list_exceptions,
    raise_exception,
    resolve_exception,
)
from app.schemas.people import DriverRead, UserRead
from app.schemas.transit import (
    DriverExceptionCreateBody,
    TripExceptionRead,
    TripExceptionResolveRequest,
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
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@dispatcher_router.get("", response_model=list[TripExceptionRead])
async def list_exceptions_endpoint(
    resolved: bool | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[TripExceptionRead]:
    """Every exception in the dispatcher's organisation, newest first.

    `resolved` is tri-state on purpose: omitted means "all", which is what the detail
    page needs when it looks a single exception up by id without knowing its state.
    """
    return await list_exceptions(
        db, organization_id=current_user.organization_id, resolved=resolved,
    )


# Rate-limited like the other dispatcher mutations. Not a cost control — this endpoint
# spends no money and calls no partner. It is the same blast-radius cap PRECINCT_MUTATION
# carries: a write that lands on an evidence record, where a client stuck in a retry loop
# should be stopped long before it works through every exception in the organisation.
# Reads on this router stay uncapped beyond the global per-IP net (core/limits.py).
@dispatcher_router.patch("/{exception_id}/resolve", response_model=TripExceptionRead,
                         dependencies=[Depends(rate_limit(FLEET_MUTATION))])
async def resolve_exception_endpoint(
    exception_id: UUID,
    payload: TripExceptionResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> TripExceptionRead:
    """Record how this exception was resolved.

    The body carries only the note and the method. The resolver and the timestamp come
    from the token and the server clock — see resolve_exception.
    """
    try:
        return await resolve_exception(
            db,
            exception_id=exception_id,
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            resolver_note=payload.resolver_note,
            resolution_method=payload.resolution_method,
        )
    except ResourceNotFoundError as exc:
        # 404 rather than 403 on a wrong-organisation id: a 403 would confirm the row
        # exists to a dispatcher with no right to know that.
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ExceptionAlreadyResolvedError as exc:
        # 409, not a 200 carrying the winner's row. This caller's note was discarded, and
        # a success response would report an account as recorded that never was. The
        # detail names no person — it says a colleague resolved it, not who.
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc
